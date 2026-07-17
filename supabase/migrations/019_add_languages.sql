-- Migration 019: Spoken languages on coach profiles
-- Run in Supabase SQL Editor (Project → SQL Editor → New query)

ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS languages TEXT[] NOT NULL DEFAULT '{}';

-- Language codes match src/lib/languages.ts (ISO 639-1, e.g. 'de', 'en', 'tr').

-- No RLS changes: creator_profiles_select_all (FOR SELECT USING (true)) and
-- creator_profiles_update_own (FOR UPDATE USING (auth.uid() = user_id)) are
-- row-level, not column-level, so they already cover reads/writes of this
-- new column without modification.

-- Demo coaches: give them a realistic default (they're fictional German
-- coaches, so "speaks German" isn't a fabricated trust claim like a fake
-- social link would be).
UPDATE creator_profiles SET languages = ARRAY['de'] WHERE is_demo = true;
