-- Notification inbox for in-app alerts
CREATE TABLE IF NOT EXISTS notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text        NOT NULL CHECK (type IN (
               'new_booking', 'booking_confirmed', 'new_subscriber',
               'new_message', 'session_reminder', 'new_review'
             )),
  title      text        NOT NULL,
  message    text        NOT NULL,
  link       text,
  read       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast queries: user's feed (newest first) and unread count
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, read)
  WHERE read = false;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications
CREATE POLICY "own_notifications_select" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Users can mark their own notifications as read (only toggling `read`)
CREATE POLICY "own_notifications_update" ON notifications
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable Supabase Realtime so the bell component receives live INSERTs
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
