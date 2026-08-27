-- Preserve media/structured content while messages wait for contact linking.
-- Raw UAZAPI payloads historically included the instance token; remove it.

alter table apticket.whatsapp_pending_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table apticket.whatsapp_pending_messages
  drop constraint if exists whatsapp_pending_messages_attachments_array;
alter table apticket.whatsapp_pending_messages
  add constraint whatsapp_pending_messages_attachments_array
  check (jsonb_typeof(attachments) = 'array');

-- Recover media already waiting in the queue using the current UAZAPI v2
-- shape: message.content.URL + mimetype/fileLength.
update apticket.whatsapp_pending_messages
set attachments = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'path', '',
    'url', payload #>> '{message,content,URL}',
    'name', concat(
      'whatsapp-',
      coalesce(nullif(payload #>> '{message,messageid}', ''), id::text),
      case
        when payload #>> '{message,content,mimetype}' = 'image/jpeg' then '.jpg'
        when payload #>> '{message,content,mimetype}' = 'image/png' then '.png'
        when payload #>> '{message,content,mimetype}' = 'image/webp' then '.webp'
        when payload #>> '{message,content,mimetype}' = 'video/mp4' then '.mp4'
        when payload #>> '{message,content,mimetype}' like 'audio/%' then '.ogg'
        when payload #>> '{message,content,mimetype}' = 'application/pdf' then '.pdf'
        else ''
      end
    ),
    'size', case
      when payload #>> '{message,content,fileLength}' ~ '^[0-9]+$'
        then (payload #>> '{message,content,fileLength}')::bigint
      else 0
    end,
    'type', coalesce(nullif(payload #>> '{message,content,mimetype}', ''), 'application/octet-stream'),
    'kind', case when payload #>> '{message,mediaType}' = 'sticker' then 'sticker' end
  ))
)
where attachments = '[]'::jsonb
  and nullif(payload #>> '{message,content,URL}', '') is not null;

-- Remove credentials and bulky cryptographic/thumbnail material from rows
-- already persisted. New payloads are sanitized before INSERT by the API.
update apticket.whatsapp_pending_messages
set payload = (payload - array['token', 'secret', 'authorization', 'BaseUrl'])
  || case
    when jsonb_typeof(payload -> 'message') = 'object' then
      jsonb_build_object(
        'message',
        (payload -> 'message')
        || case
          when jsonb_typeof(payload #> '{message,content}') = 'object' then
            jsonb_build_object(
              'content',
              (payload #> '{message,content}')
              - array['mediaKey', 'fileSHA256', 'fileEncSHA256', 'JPEGThumbnail']
            )
          else '{}'::jsonb
        end
      )
    else '{}'::jsonb
  end
where payload ?| array['token', 'secret', 'authorization', 'BaseUrl']
   or (payload #> '{message,content}') ?| array['mediaKey', 'fileSHA256', 'fileEncSHA256', 'JPEGThumbnail'];
