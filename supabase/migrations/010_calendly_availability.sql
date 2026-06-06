-- Add Calendly-style booking settings to coaching_offers
ALTER TABLE coaching_offers
  ADD COLUMN IF NOT EXISTS buffer_minutes    integer NOT NULL DEFAULT 0
                           CHECK (buffer_minutes IN (0, 15, 30)),
  ADD COLUMN IF NOT EXISTS min_notice_hours  integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS max_horizon_days  integer NOT NULL DEFAULT 60;

-- Date-specific overrides: add availability or block dates
CREATE TABLE IF NOT EXISTS date_overrides (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  date        date        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('available', 'unavailable')),
  start_time  time,
  end_time    time,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE date_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read date overrides"
  ON date_overrides FOR SELECT
  USING (true);

CREATE POLICY "Creators can insert their date overrides"
  ON date_overrides FOR INSERT
  WITH CHECK (creator_id IN (
    SELECT id FROM creator_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Creators can update their date overrides"
  ON date_overrides FOR UPDATE
  USING (creator_id IN (
    SELECT id FROM creator_profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "Creators can delete their date overrides"
  ON date_overrides FOR DELETE
  USING (creator_id IN (
    SELECT id FROM creator_profiles WHERE user_id = auth.uid()
  ));
