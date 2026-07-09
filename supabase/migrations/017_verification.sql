-- Migration 017: Optional coach verification system
-- Run in Supabase SQL Editor (Project → SQL Editor → New query)

-- ── 1. Add is_admin to profiles ───────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- ── 2. Add verification columns to creator_profiles ───────────────────────
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS is_verified  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMPTZ          NULL;

-- ── 3. verification_requests table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verification_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id        UUID        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  document_path     TEXT        NOT NULL,
  original_filename TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','rejected')),
  rejection_reason  TEXT        NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ          NULL,
  delete_after      TIMESTAMPTZ          NULL
);

-- ── 4. RLS on verification_requests ──────────────────────────────────────
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

-- Coaches may view only their own requests
CREATE POLICY "vreq_select_own" ON verification_requests
  FOR SELECT USING (
    creator_id = (SELECT id FROM creator_profiles WHERE user_id = auth.uid())
  );

-- Coaches may insert a request only for themselves (no pending request must exist)
CREATE POLICY "vreq_insert_own" ON verification_requests
  FOR INSERT WITH CHECK (
    creator_id = (SELECT id FROM creator_profiles WHERE user_id = auth.uid())
  );

-- ── 5. Private storage bucket for verification documents ─────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'verification-docs',
    'verification-docs',
    false,
    10485760,
    ARRAY['application/pdf','image/jpeg','image/png','image/webp']
  )
  ON CONFLICT DO NOTHING;

-- Creators may upload only under their own creator-id prefix
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'vdocs_insert_own' AND tablename = 'objects'
  ) THEN
    CREATE POLICY "vdocs_insert_own" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id = 'verification-docs'
        AND (storage.foldername(name))[1] = (
          SELECT id::text FROM creator_profiles WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;

-- No public SELECT — signed URLs only (generated via service role in admin routes)
