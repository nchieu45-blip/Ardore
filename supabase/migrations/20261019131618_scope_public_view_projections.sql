-- Preserve the public view contracts without granting access to raw buyer IDs,
-- private profile columns or payment records. No customer rows are rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- These deliberately privileged, argument-free projections are the security
-- boundary, not generic table readers. Profile access derives from auth.uid(),
-- immutable chat membership and the same entitlement rules as the application.
-- Public review projections explicitly require published targets. Caller roles
-- receive only the existing presentation fields, never private source columns.
CREATE FUNCTION private.visible_chat_profiles()
RETURNS TABLE(id uuid, full_name text, avatar_url text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT profile.id, profile.full_name, profile.avatar_url, profile.role
  FROM public.profiles AS profile
  WHERE (SELECT auth.uid()) IS NOT NULL AND (
    profile.id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.chat_conversation_participants AS caller
      JOIN public.chat_conversation_participants AS peer
        ON peer.conversation_id = caller.conversation_id
      WHERE caller.user_id = (SELECT auth.uid()) AND peer.user_id = profile.id
    )
    OR EXISTS (
      SELECT 1 FROM public.subscriptions AS subscription
      JOIN public.creator_profiles AS coach ON coach.id = subscription.creator_id
      JOIN public.subscription_tiers AS tier ON tier.id = subscription.tier_id
        AND tier.creator_id = subscription.creator_id
      WHERE coach.user_id = (SELECT auth.uid()) AND subscription.buyer_id = profile.id
        AND subscription.status = 'active' AND subscription.current_period_end > now()
        AND (subscription.stripe_livemode = true OR (
          subscription.stripe_livemode IS NULL
          AND starts_with(subscription.stripe_subscription_id, 'free_')
        ))
    )
  );
$$;
REVOKE ALL ON FUNCTION private.visible_chat_profiles() FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.visible_chat_profiles() TO authenticated, service_role;

CREATE FUNCTION private.published_product_reviews()
RETURNS TABLE(id uuid, product_id uuid, rating integer, content text, created_at timestamptz,
  is_own boolean, reviewer_name text, reviewer_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT review.id, review.product_id, review.rating, review.content, review.created_at,
    review.buyer_id = (SELECT auth.uid()), profile.full_name, profile.avatar_url
  FROM public.reviews AS review
  JOIN public.products AS product ON product.id = review.product_id AND product.is_published
  JOIN public.creator_profiles AS coach ON coach.id = product.creator_id AND coach.is_published
  LEFT JOIN public.profiles AS profile ON profile.id = review.buyer_id
  WHERE EXISTS (
    SELECT 1 FROM public.purchases AS purchase
    WHERE purchase.buyer_id = review.buyer_id AND purchase.product_id = review.product_id
      AND purchase.payment_status = 'paid' AND purchase.stripe_livemode = true
  );
$$;
CREATE FUNCTION private.published_session_reviews()
RETURNS TABLE(id uuid, creator_id uuid, rating integer, content text, created_at timestamptz,
  reviewer_name text, reviewer_avatar_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT review.id, review.creator_id, review.rating, review.content, review.created_at,
    profile.full_name, profile.avatar_url
  FROM public.session_reviews AS review
  JOIN public.creator_profiles AS coach ON coach.id = review.creator_id AND coach.is_published
  LEFT JOIN public.profiles AS profile ON profile.id = review.buyer_id;
$$;
REVOKE ALL ON FUNCTION private.published_product_reviews(), private.published_session_reviews()
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.published_product_reviews(), private.published_session_reviews()
  TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true, security_invoker = true) AS
  SELECT id, full_name, avatar_url, role FROM private.visible_chat_profiles();
CREATE OR REPLACE VIEW public.public_product_reviews
WITH (security_barrier = true, security_invoker = true) AS
  SELECT id, product_id, rating, content, created_at, is_own, reviewer_name, reviewer_avatar_url
  FROM private.published_product_reviews();
CREATE OR REPLACE VIEW public.public_session_reviews
WITH (security_barrier = true, security_invoker = true) AS
  SELECT id, creator_id, rating, content, created_at, reviewer_name, reviewer_avatar_url
  FROM private.published_session_reviews();

REVOKE ALL ON public.public_profiles, public.public_product_reviews, public.public_session_reviews
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO authenticated;
GRANT SELECT ON public.public_product_reviews, public.public_session_reviews TO anon, authenticated;
COMMIT;
