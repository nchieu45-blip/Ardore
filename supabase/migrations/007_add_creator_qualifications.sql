ALTER TABLE creator_profiles
ADD COLUMN IF NOT EXISTS qualifications text[] DEFAULT '{}';
