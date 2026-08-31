-- Attachments for the "Fila de E-mail" queue, mirroring messages.attachments'
-- [{path,name,size,type}] shape (see ticket-detail.ts rendering).

ALTER TABLE public.email_pending_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- The ticket-attachments / kb-attachments buckets were referenced by RLS
-- policies (earlier migrations) but the bucket rows themselves were never
-- created - uploads to either were silently failing. Backfilling them here.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('ticket-attachments', 'ticket-attachments', false, 10485760),
  ('kb-attachments', 'kb-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;
