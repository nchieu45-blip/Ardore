CREATE TABLE IF NOT EXISTS chat_last_read (
  creator_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  buyer_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (creator_id, buyer_id)
);

ALTER TABLE chat_last_read ENABLE ROW LEVEL SECURITY;

-- Creator can read and upsert their own rows
CREATE POLICY "chat_last_read_select_own" ON chat_last_read
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM creator_profiles
      WHERE creator_profiles.id = chat_last_read.creator_id
        AND creator_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "chat_last_read_upsert_own" ON chat_last_read
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM creator_profiles
      WHERE creator_profiles.id = chat_last_read.creator_id
        AND creator_profiles.user_id = auth.uid()
    )
  );

CREATE POLICY "chat_last_read_update_own" ON chat_last_read
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM creator_profiles
      WHERE creator_profiles.id = chat_last_read.creator_id
        AND creator_profiles.user_id = auth.uid()
    )
  );
