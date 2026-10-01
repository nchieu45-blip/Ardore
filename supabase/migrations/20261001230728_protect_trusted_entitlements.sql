-- Protect trusted authority/entitlement records while preserving every coach
-- commercial field. No row data, coach prices or offer configuration is changed.

-- RLS governs ownership; column privileges separately govern authority. Remove
-- table and any prior column grants so a permissive grant cannot bypass this list.
REVOKE INSERT, UPDATE ON public.creator_profiles FROM PUBLIC, anon, authenticated;
DO $columns$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
  FROM pg_attribute WHERE attrelid = 'public.creator_profiles'::regclass
    AND attnum > 0 AND NOT attisdropped;
  EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.creator_profiles FROM PUBLIC, anon, authenticated', cols, cols);
END
$columns$;
GRANT INSERT (
  user_id, display_name, slug, bio, category, avatar_url, banner_url,
  created_at, categories, services, qualifications, social_links, languages
) ON public.creator_profiles TO authenticated;
GRANT UPDATE (
  display_name, slug, bio, category, avatar_url, banner_url,
  created_at, categories, services, qualifications, social_links, languages
) ON public.creator_profiles TO authenticated;
GRANT INSERT, UPDATE ON public.creator_profiles TO service_role;
ALTER POLICY creator_profiles_insert_own ON public.creator_profiles TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);
ALTER POLICY creator_profiles_update_own ON public.creator_profiles TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Subscriptions are issued by validated server free-tier checkout or signed
-- Stripe events. Subscription TIERS retain all existing coach write privileges.
-- Existing buyers must still read their purchased tier after a coach disables
-- new sales. This is read-only and does not alter any coach configuration rights.
ALTER POLICY tiers_select_active ON public.subscription_tiers
  USING (
    is_active = true
    OR (SELECT auth.uid()) = (SELECT creator.user_id FROM public.creator_profiles creator WHERE creator.id = creator_id)
    OR EXISTS (
      SELECT 1 FROM public.subscriptions subscription
      WHERE subscription.tier_id = subscription_tiers.id
        AND subscription.buyer_id = (SELECT auth.uid())
    )
  );
-- Bookings/purchases likewise remain server-managed; close group-class bypass.
DO $entitlements$
DECLARE tbl text; cols text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['subscriptions', 'video_class_bookings', 'verification_requests', 'purchases', 'bookings'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM PUBLIC, anon, authenticated', tbl);
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
    FROM pg_attribute WHERE attrelid = format('public.%I', tbl)::regclass
      AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE INSERT (%s), UPDATE (%s) ON public.%I FROM PUBLIC, anon, authenticated', cols, cols, tbl);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON public.%I TO service_role', tbl);
  END LOOP;
END
$entitlements$;
DROP POLICY IF EXISTS subscriptions_insert_buyer ON public.subscriptions;
DROP POLICY IF EXISTS subscriptions_update_own ON public.subscriptions;
DROP POLICY IF EXISTS vreq_insert_own ON public.verification_requests;
DROP POLICY IF EXISTS "Users manage own bookings" ON public.video_class_bookings;
DROP POLICY IF EXISTS video_class_bookings_select_own ON public.video_class_bookings;
CREATE POLICY video_class_bookings_select_own ON public.video_class_bookings
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Exact purchased-file entitlement must belong to that product's coach. A coach
-- cannot reference another coach's private object through their own file_url.
DROP POLICY IF EXISTS products_download_entitled ON storage.objects;
CREATE POLICY products_download_entitled ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'products'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT creator.id::text FROM public.creator_profiles creator
        WHERE creator.user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1 FROM public.purchases purchase
        JOIN public.products product ON product.id = purchase.product_id
        WHERE purchase.buyer_id = (SELECT auth.uid())
          AND purchase.payment_status = 'paid'
          AND purchase.stripe_livemode = true
          AND product.creator_id::text = (storage.foldername(name))[1]
          AND product.file_url IS NOT NULL
          AND right(split_part(product.file_url, '?', 1), length(name) + 1) = '/' || name
      )
    )
  );

-- Browser roles never need whole-table destruction. These revocations do not
-- affect owner-scoped INSERT/UPDATE/DELETE of products, prices or availability.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
