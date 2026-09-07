-- Migration 023: Make one-time purchase validity reflect Stripe payment state.

ALTER TABLE public.purchases
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'
    CHECK (payment_status IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'chargeback', 'reversed')),
  ADD COLUMN stripe_livemode BOOLEAN,
  ADD COLUMN stripe_checkout_session_id TEXT,
  ADD COLUMN amount_refunded NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_refunded >= 0),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Subscription lifecycle already uses Stripe statuses; add the missing mode
-- marker so test/live subscription data can be audited and separated later.
-- Free subscriptions remain NULL because they do not originate in Stripe.
ALTER TABLE public.subscriptions
  ADD COLUMN stripe_livemode BOOLEAN;

-- Existing records predate environment tracking and remain explicitly unknown.
-- They are preserved, but do not qualify for entitlement or public sales totals
-- until reconciled against Stripe and marked with stripe_livemode = true.
CREATE UNIQUE INDEX purchases_checkout_product_idx
  ON public.purchases (stripe_checkout_session_id, product_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE INDEX purchases_valid_product_idx
  ON public.purchases (product_id)
  WHERE payment_status = 'paid' AND stripe_livemode = true;
CREATE INDEX purchases_payment_intent_idx
  ON public.purchases (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE TABLE public.stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_webhook_events FROM PUBLIC, anon, authenticated;

-- Verified reviews require a currently valid live purchase.
DROP POLICY IF EXISTS "reviews_insert_purchaser" ON public.reviews;
CREATE POLICY "reviews_insert_purchaser" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = buyer_id
    AND EXISTS (
      SELECT 1
      FROM public.purchases purchase
      WHERE purchase.buyer_id = (SELECT auth.uid())
        AND purchase.product_id = reviews.product_id
        AND purchase.payment_status = 'paid'
        AND purchase.stripe_livemode = true
    )
  );

DROP POLICY IF EXISTS "reviews_update_own" ON public.reviews;
CREATE POLICY "reviews_update_own" ON public.reviews
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = buyer_id)
  WITH CHECK (
    (SELECT auth.uid()) = buyer_id
    AND EXISTS (
      SELECT 1 FROM public.purchases purchase
      WHERE purchase.buyer_id = (SELECT auth.uid())
        AND purchase.product_id = reviews.product_id
        AND purchase.payment_status = 'paid'
        AND purchase.stripe_livemode = true
    )
  );

CREATE OR REPLACE VIEW public.public_product_reviews
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
  review.id,
  review.product_id,
  review.rating,
  review.content,
  review.created_at,
  review.buyer_id = (SELECT auth.uid()) AS is_own,
  profile.full_name AS reviewer_name,
  profile.avatar_url AS reviewer_avatar_url
FROM public.reviews review
JOIN public.purchases purchase
  ON purchase.buyer_id = review.buyer_id
 AND purchase.product_id = review.product_id
 AND purchase.payment_status = 'paid'
 AND purchase.stripe_livemode = true
LEFT JOIN public.profiles profile ON profile.id = review.buyer_id;

REVOKE ALL ON public.public_product_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_product_reviews TO anon, authenticated;

-- Paid product objects use the same validity definition. Creator ownership is
-- unchanged; only buyer entitlement is narrowed.
DROP POLICY IF EXISTS "products_download_entitled" ON storage.objects;
CREATE POLICY "products_download_entitled" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'products'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT creator.id::text
        FROM public.creator_profiles creator
        WHERE creator.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM public.purchases purchase
        JOIN public.products product ON product.id = purchase.product_id
        WHERE purchase.buyer_id = (SELECT auth.uid())
          AND purchase.payment_status = 'paid'
          AND purchase.stripe_livemode = true
          AND product.file_url IS NOT NULL
          AND right(split_part(product.file_url, '?', 1), length(name) + 1) = '/' || name
      )
    )
  );

-- Public discovery receives aggregate-only counts of valid live purchases.
CREATE OR REPLACE FUNCTION public.get_public_product_sales_counts(
  requested_product_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (product_id UUID, sales_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT product.id, COUNT(purchase.id)::BIGINT
  FROM public.products product
  LEFT JOIN public.purchases purchase
    ON purchase.product_id = product.id
   AND purchase.payment_status = 'paid'
   AND purchase.stripe_livemode = true
  WHERE product.is_published = true
    AND (requested_product_ids IS NULL OR product.id = ANY(requested_product_ids))
  GROUP BY product.id;
$$;

REVOKE ALL ON FUNCTION public.get_public_product_sales_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_product_sales_counts(UUID[]) TO anon, authenticated;
