-- Links mmg.whatsapp.net expiram. A API copia a mídia recebida para este
-- bucket; 25 MB cobre vídeos curtos e documentos acima do limite antigo.
UPDATE storage.buckets
SET file_size_limit = 26214400
WHERE id = 'ticket-attachments';
