CREATE POLICY "Agents read tenant ticket attachments" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "Agents insert tenant ticket attachments" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "Agents update tenant ticket attachments" ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text)
WITH CHECK (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "Agents delete tenant ticket attachments" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "kb_attachments_read" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'kb-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "kb_attachments_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'kb-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

CREATE POLICY "kb_attachments_delete" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'kb-attachments' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);