import { parentPort, workerData } from 'node:worker_threads';
import { fileTypeFromBuffer } from 'file-type';

// Bounded worker: malformed archives cannot occupy the API event loop.
try {
  const bytes = new Uint8Array(workerData.bytes);
  const extension = workerData.filename.toLowerCase().split('.').pop();
  const declared = (workerData.mime || '').split(';')[0].trim().toLowerCase();
  const binary = {
    pdf: ['pdf', 'application/pdf'],
    jpg: ['jpg,jpeg', 'image/jpeg'],
    png: ['png', 'image/png'],
    gif: ['gif', 'image/gif'],
    webp: ['webp', 'image/webp'],
    bmp: ['bmp', 'image/bmp'],
    tif: ['tif,tiff', 'image/tiff'],
    ico: ['ico', 'image/x-icon'],
    avif: ['avif', 'image/avif'],
    zip: ['zip', 'application/zip'],
    docx: [
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    xlsx: [
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    pptx: [
      'pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
    odt: ['odt', 'application/vnd.oasis.opendocument.text'],
    ods: ['ods', 'application/vnd.oasis.opendocument.spreadsheet'],
    odp: ['odp', 'application/vnd.oasis.opendocument.presentation'],
    rtf: ['rtf', 'application/rtf'],
    opus: ['opus,ogg,oga', 'audio/ogg'],
    ogg: ['ogg,oga', 'audio/ogg'],
    oga: ['oga,ogg', 'audio/ogg'],
    ogv: ['ogv,ogg', 'video/ogg'],
    mp3: ['mp3', 'audio/mpeg'],
    m4a: ['m4a', 'audio/mp4'],
    aac: ['aac', 'audio/aac'],
    amr: ['amr', 'audio/amr'],
    wav: ['wav', 'audio/wav'],
    flac: ['flac', 'audio/flac'],
    mp4: ['mp4', 'video/mp4'],
    m4v: ['m4v,mp4', 'video/mp4'],
    mov: ['mov', 'video/quicktime'],
    webm: ['webm', declared === 'audio/webm' ? 'audio/webm' : 'video/webm'],
    mkv: ['mkv', 'video/matroska'],
    avi: ['avi', 'video/vnd.avi'],
    '3gp': ['3gp', 'video/3gpp'],
    mpg: ['mpg,mpeg', 'video/mpeg'],
  };
  const detected = await fileTypeFromBuffer(bytes);
  let mime;
  if (detected?.ext === 'cfb' && ['doc', 'xls', 'ppt'].includes(extension)) {
    mime = {
      doc: 'application/msword',
      xls: 'application/vnd.ms-excel',
      ppt: 'application/vnd.ms-powerpoint',
    }[extension];
  } else if (detected) {
    const allowed = binary[detected.ext];
    if (!allowed || !allowed[0].split(',').includes(extension))
      throw new Error('type_mismatch');
    mime = allowed[1];
  } else {
    if (!['txt', 'log', 'csv', 'md', 'json', 'xml'].includes(extension))
      throw new Error('type_not_allowed');
    const utf16 =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? 'utf-16be'
          : 'utf-8';
    const text = new TextDecoder(utf16, { fatal: true }).decode(bytes);
    for (const char of text) {
      const code = char.charCodeAt(0);
      if (code === 0 || (code < 32 && ![9, 10, 12, 13].includes(code)))
        throw new Error('binary_content');
    }
    const root = text.replace(/^\s*<\?xml[^>]*\?>/i, '').trimStart();
    if (
      /^(?:<!doctype\s+html|<(?:html|svg|script|iframe|body|head|object|embed)(?:\s|>))/i.test(
        root,
      )
    )
      throw new Error('active_content');
    if (extension === 'xml' && /<!\s*(?:doctype|entity)\b/i.test(text))
      throw new Error('xml_entities');
    if (extension === 'json') JSON.parse(text);
    mime =
      extension === 'xml'
        ? 'application/xml'
        : extension === 'csv'
          ? 'text/csv'
          : 'text/plain';
  }
  const aliases = {
    'image/pjpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/vnd.microsoft.icon': 'image/x-icon',
    'text/xml': 'application/xml',
    'application/x-zip-compressed': 'application/zip',
    'text/markdown': 'text/plain',
    'application/json': 'text/plain',
    'text/rtf': 'application/rtf',
    'audio/opus': 'audio/ogg',
    'audio/x-m4a': 'audio/mp4',
    'audio/x-wav': 'audio/wav',
    'video/x-m4v': 'video/mp4',
    'video/x-msvideo': 'video/vnd.avi',
    'video/x-matroska': 'video/matroska',
  };
  if (
    declared &&
    declared !== 'application/octet-stream' &&
    (aliases[declared] || declared) !== mime
  )
    throw new Error('declared_type_mismatch');
  parentPort.postMessage({ mime });
} catch {
  parentPort.postMessage({ error: 'invalid_file_content' });
}
