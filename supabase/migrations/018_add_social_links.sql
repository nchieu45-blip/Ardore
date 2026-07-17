-- Migration 018: Social media links on coach profiles
-- Run in Supabase SQL Editor (Project → SQL Editor → New query)

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS social_links JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Expected shape (all keys optional):
-- { "instagram": "handle", "tiktok": "handle", "youtube": "url-or-handle", "website": "https://..." }

-- No RLS changes: creator_profiles_select_all (FOR SELECT USING (true)) and
-- creator_profiles_update_own (FOR UPDATE USING (auth.uid() = user_id)) are
-- row-level, not column-level, so they already cover reads/writes of this
-- new column without modification.
