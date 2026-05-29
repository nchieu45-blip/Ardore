ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS services text[] NOT NULL DEFAULT '{}';
