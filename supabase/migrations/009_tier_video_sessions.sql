-- Add video session benefit fields to subscription tiers
ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS included_video_sessions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS video_session_period    text    CHECK (video_session_period IN ('week', 'month'));

-- Track which subscription a booking was charged against (null = standalone paid booking)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS subscription_id         uuid    REFERENCES subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_subscription_session boolean NOT NULL DEFAULT false;
