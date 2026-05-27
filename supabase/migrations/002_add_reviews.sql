-- Migration: Add reviews and ratings system
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  buyer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  content TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, buyer_id)
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- Everyone can read all reviews
CREATE POLICY "reviews_select_all" ON reviews FOR SELECT USING (true);

-- Only authenticated buyers who have purchased the product may insert
CREATE POLICY "reviews_insert_purchaser" ON reviews FOR INSERT WITH CHECK (
  auth.uid() = buyer_id
  AND EXISTS (
    SELECT 1 FROM purchases
    WHERE purchases.buyer_id = auth.uid()
    AND purchases.product_id = reviews.product_id
  )
);

-- Reviewer may update their own review
CREATE POLICY "reviews_update_own" ON reviews FOR UPDATE USING (auth.uid() = buyer_id);

-- Reviewer may delete their own review
CREATE POLICY "reviews_delete_own" ON reviews FOR DELETE USING (auth.uid() = buyer_id);
