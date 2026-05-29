-- Add multi-category support to creator profiles
ALTER TABLE creator_profiles
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}';

-- Seed from existing single category
UPDATE creator_profiles
  SET categories = ARRAY[category]
  WHERE category IS NOT NULL
    AND category <> ''
    AND array_length(categories, 1) IS NULL;
