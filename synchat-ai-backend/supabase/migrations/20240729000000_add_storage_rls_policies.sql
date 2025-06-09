-- Grant authenticated users access to manage their own files in the 'knowledge_files' bucket.

-- Policy for viewing/downloading own files
CREATE POLICY "Allow authenticated read access to own folder"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'knowledge_files' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- Policy for uploading files into own folder
CREATE POLICY "Allow authenticated insert to own folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'knowledge_files' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- Policy for updating/overwriting own files
CREATE POLICY "Allow authenticated update of own folder"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'knowledge_files' AND (storage.foldername(name))[1] = (auth.uid())::text);

-- Policy for deleting own files
CREATE POLICY "Allow authenticated delete of own folder"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'knowledge_files' AND (storage.foldername(name))[1] = (auth.uid())::text);
