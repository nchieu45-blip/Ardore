ALTER TABLE products
  ADD COLUMN IF NOT EXISTS equipment  text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS level      text,
  ADD COLUMN IF NOT EXISTS duration   text;
