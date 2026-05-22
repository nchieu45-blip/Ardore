-- ============================================================
-- Ardore - Supabase Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'creator')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on sign up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'buyer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Creator Profiles
CREATE TABLE IF NOT EXISTS creator_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  bio TEXT,
  category TEXT,
  avatar_url TEXT,
  banner_url TEXT,
  stripe_account_id TEXT,
  stripe_account_active BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscription Tiers
CREATE TABLE IF NOT EXISTS subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_monthly NUMERIC(10,2) NOT NULL,
  stripe_price_id TEXT,
  features JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('pdf', 'video', 'course')),
  price NUMERIC(10,2) NOT NULL,
  file_url TEXT,
  thumbnail_url TEXT,
  stripe_price_id TEXT,
  is_published BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchases (one-time)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  amount_paid NUMERIC(10,2) NOT NULL,
  stripe_payment_intent_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(buyer_id, product_id)
);

-- Subscriptions (monthly)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES subscription_tiers(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
  current_period_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages (chat - subscribers only)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  creator_id UUID NOT NULL REFERENCES creator_profiles(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE creator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update own
CREATE POLICY "profiles_select_all" ON profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Creator profiles: anyone can read
CREATE POLICY "creator_profiles_select_all" ON creator_profiles FOR SELECT USING (true);
CREATE POLICY "creator_profiles_insert_own" ON creator_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "creator_profiles_update_own" ON creator_profiles FOR UPDATE USING (auth.uid() = user_id);

-- Subscription tiers: anyone can read active, creators manage own
CREATE POLICY "tiers_select_active" ON subscription_tiers FOR SELECT USING (is_active = true OR auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));
CREATE POLICY "tiers_manage_own" ON subscription_tiers FOR ALL USING (auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));

-- Products: published are public, creators manage own
CREATE POLICY "products_select_published" ON products FOR SELECT USING (is_published = true OR auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));
CREATE POLICY "products_manage_own" ON products FOR ALL USING (auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));

-- Purchases: buyers see own
CREATE POLICY "purchases_select_own" ON purchases FOR SELECT USING (auth.uid() = buyer_id);
CREATE POLICY "purchases_insert_own" ON purchases FOR INSERT WITH CHECK (auth.uid() = buyer_id);

-- Subscriptions: buyers see own, creators see theirs
CREATE POLICY "subscriptions_select_buyer" ON subscriptions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));
CREATE POLICY "subscriptions_insert_buyer" ON subscriptions FOR INSERT WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "subscriptions_update_own" ON subscriptions FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id));

-- Messages: only between active subscriber and creator
CREATE POLICY "messages_select" ON messages FOR SELECT USING (
  auth.uid() = sender_id
  OR auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id)
  OR EXISTS (
    SELECT 1 FROM subscriptions
    WHERE buyer_id = auth.uid()
    AND creator_id = messages.creator_id
    AND status = 'active'
  )
);

CREATE POLICY "messages_insert" ON messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND (
    auth.uid() = (SELECT user_id FROM creator_profiles WHERE id = creator_id)
    OR EXISTS (
      SELECT 1 FROM subscriptions
      WHERE buyer_id = auth.uid()
      AND creator_id = messages.creator_id
      AND status = 'active'
    )
  )
);

-- ============================================================
-- Storage buckets
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', false) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', true) ON CONFLICT DO NOTHING;

-- Storage policies
CREATE POLICY "products_upload_creator" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'products' AND auth.role() = 'authenticated');

CREATE POLICY "products_download_purchased" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'products' AND (
      -- Creator can always access own files
      (storage.foldername(name))[1] = (
        SELECT id::text FROM creator_profiles WHERE user_id = auth.uid()
      )
      -- Buyers with purchase
      OR EXISTS (
        SELECT 1 FROM purchases p
        JOIN products pr ON pr.id = p.product_id
        JOIN creator_profiles cp ON cp.id = pr.creator_id
        WHERE p.buyer_id = auth.uid()
        AND cp.id::text = (storage.foldername(name))[1]
      )
    )
  );

CREATE POLICY "avatars_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_upload_own" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.role() = 'authenticated');

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
