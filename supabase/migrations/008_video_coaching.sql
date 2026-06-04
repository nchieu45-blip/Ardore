-- coaching_offers: video coaching settings per creator (one row per creator)
CREATE TABLE IF NOT EXISTS coaching_offers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id       uuid        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  is_enabled       boolean     NOT NULL DEFAULT false,
  price_cents      integer     NOT NULL DEFAULT 8000,
  duration_minutes integer     NOT NULL DEFAULT 60,
  description      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id)
);

-- availability_slots: weekly recurring time windows per creator
CREATE TABLE IF NOT EXISTS availability_slots (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id   uuid        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  day_of_week  integer     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- bookings: individual booked video sessions
CREATE TABLE IF NOT EXISTS bookings (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id               uuid        NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  buyer_id                 uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  scheduled_at             timestamptz NOT NULL,
  duration_minutes         integer     NOT NULL DEFAULT 60,
  price_cents              integer     NOT NULL DEFAULT 0,
  status                   text        NOT NULL DEFAULT 'confirmed'
                             CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  daily_room_name          text,
  daily_room_url           text,
  stripe_payment_intent_id text,
  buyer_email              text        NOT NULL,
  buyer_name               text        NOT NULL,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coaching_offers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings           ENABLE ROW LEVEL SECURITY;

-- coaching_offers: public read, creator write
CREATE POLICY "coaching_offers_select" ON coaching_offers FOR SELECT USING (true);
CREATE POLICY "coaching_offers_insert" ON coaching_offers FOR INSERT
  WITH CHECK (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));
CREATE POLICY "coaching_offers_update" ON coaching_offers FOR UPDATE
  USING (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));
CREATE POLICY "coaching_offers_delete" ON coaching_offers FOR DELETE
  USING (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));

-- availability_slots: public read, creator write
CREATE POLICY "availability_slots_select" ON availability_slots FOR SELECT USING (true);
CREATE POLICY "availability_slots_insert" ON availability_slots FOR INSERT
  WITH CHECK (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));
CREATE POLICY "availability_slots_delete" ON availability_slots FOR DELETE
  USING (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));

-- bookings: creator sees their bookings, buyer sees their bookings, anyone can insert
CREATE POLICY "bookings_creator_select" ON bookings FOR SELECT
  USING (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));
CREATE POLICY "bookings_buyer_select" ON bookings FOR SELECT
  USING (buyer_id = auth.uid());
CREATE POLICY "bookings_insert" ON bookings FOR INSERT WITH CHECK (true);
CREATE POLICY "bookings_creator_update" ON bookings FOR UPDATE
  USING (creator_id IN (SELECT id FROM creator_profiles WHERE user_id = auth.uid()));
CREATE POLICY "bookings_buyer_cancel" ON bookings FOR UPDATE
  USING (buyer_id = auth.uid() AND status = 'confirmed');
