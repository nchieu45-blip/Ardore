-- Migration: Add 'image' product type and thumbnails storage bucket
-- Run this in your Supabase SQL Editor against an existing database

-- 1. Extend the products type CHECK constraint to allow 'image'
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_type_check;
ALTER TABLE products ADD CONSTRAINT products_type_check
  CHECK (type IN ('pdf', 'video', 'course', 'image'));

-- 2. Create a public thumbnails storage bucket
INSERT INTO storage.buckets (id, name, public)
  VALUES ('thumbnails', 'thumbnails', true)
  ON CONFLICT DO NOTHING;

-- 3. Storage policies for thumbnails
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'thumbnails_public' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "thumbnails_public" ON storage.objects
      FOR SELECT USING (bucket_id = 'thumbnails');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'thumbnails_upload_creator' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "thumbnails_upload_creator" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'thumbnails' AND auth.role() = 'authenticated');
  END IF;
END $$;
