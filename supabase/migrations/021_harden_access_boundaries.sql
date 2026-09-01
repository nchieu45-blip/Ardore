-- Migration 021: Harden purchase, review, booking, profile, and storage boundaries.
-- Trusted server-side clients use the service_role and continue to bypass RLS.

-- Purchases are payment records. Browser roles may read only their own records and
-- must never create or mutate them directly.
DROP POLICY IF EXISTS "purchases_insert_own" ON public.purchases;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.purchases FROM anon, authenticated;

-- Keep the existing own-row read policy explicit and unchanged in scope.
DROP POLICY IF EXISTS "purchases_select_own" ON public.purchases;
CREATE POLICY "purchases_select_own" ON public.purchases
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = buyer_id);

-- Profiles mix public presentation data with private/security-sensitive fields
-- (email, is_admin). Only the owner may read the base row. Public consumers use
-- the deliberately narrow view below.
DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

REVOKE SELECT ON public.profiles FROM anon;
REVOKE INSERT, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.profiles TO authenticated;

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, full_name, avatar_url, role
FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_profiles TO authenticated;

-- Raw reviews contain the buyer UUID. Public consumers receive only display-safe
-- review fields through public_product_reviews. Owners retain access to their row.
DROP POLICY IF EXISTS "reviews_select_all" ON public.reviews;
DROP POLICY IF EXISTS "reviews_select_own" ON public.reviews;
CREATE POLICY "reviews_select_own" ON public.reviews
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = buyer_id);

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
    )
  );

DROP POLICY IF EXISTS "reviews_update_own" ON public.reviews;
CREATE POLICY "reviews_update_own" ON public.reviews
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = buyer_id)
  WITH CHECK ((SELECT auth.uid()) = buyer_id);

DROP POLICY IF EXISTS "reviews_delete_own" ON public.reviews;
CREATE POLICY "reviews_delete_own" ON public.reviews
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = buyer_id);

REVOKE ALL ON public.reviews FROM anon;
REVOKE TRUNCATE ON public.reviews FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;

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
LEFT JOIN public.profiles profile ON profile.id = review.buyer_id;

REVOKE ALL ON public.public_product_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_product_reviews TO anon, authenticated;

-- Session reviews use the same buyer-ID-free public projection.
DROP POLICY IF EXISTS "session_reviews_select_all" ON public.session_reviews;
DROP POLICY IF EXISTS "session_reviews_select_own" ON public.session_reviews;
CREATE POLICY "session_reviews_select_own" ON public.session_reviews
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = buyer_id);
REVOKE ALL ON public.session_reviews FROM anon;
REVOKE TRUNCATE ON public.session_reviews FROM authenticated;
GRANT SELECT ON public.session_reviews TO authenticated;

CREATE OR REPLACE VIEW public.public_session_reviews
WITH (security_barrier = true, security_invoker = false)
AS
SELECT review.id, review.creator_id, review.rating,
       review.content, review.created_at,
       profile.full_name AS reviewer_name,
       profile.avatar_url AS reviewer_avatar_url
FROM public.session_reviews review
LEFT JOIN public.profiles profile ON profile.id = review.buyer_id;

REVOKE ALL ON public.public_session_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.public_session_reviews TO anon, authenticated;

-- Booking mutations must pass through validated server routes. Browser roles keep
-- only the existing participant-scoped SELECT policies.
DROP POLICY IF EXISTS "bookings_insert" ON public.bookings;
DROP POLICY IF EXISTS "bookings_creator_update" ON public.bookings;
DROP POLICY IF EXISTS "bookings_buyer_cancel" ON public.bookings;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.bookings FROM anon, authenticated;

-- Private product files: creators are limited to their own folder; buyers must
-- own the exact product whose file_url ends in the requested object path.
DROP POLICY IF EXISTS "products_upload_creator" ON storage.objects;
DROP POLICY IF EXISTS "products_download_purchased" ON storage.objects;
DROP POLICY IF EXISTS "products_update_creator" ON storage.objects;
DROP POLICY IF EXISTS "products_delete_creator" ON storage.objects;
DROP POLICY IF EXISTS "products: authenticated upload own folder" ON storage.objects;
DROP POLICY IF EXISTS "products: authenticated read own folder" ON storage.objects;
DROP POLICY IF EXISTS "products: authenticated delete own folder" ON storage.objects;

CREATE POLICY "products_upload_creator" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text
      FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );

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
          AND product.file_url IS NOT NULL
          AND right(split_part(product.file_url, '?', 1), length(name) + 1) = '/' || name
      )
    )
  );

CREATE POLICY "products_update_creator" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "products_delete_creator" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'products'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );

-- Public buckets remain publicly readable, but writes are owner-folder scoped.
DROP POLICY IF EXISTS "avatars_upload_own" ON storage.objects;
CREATE POLICY "avatars_upload_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

DROP POLICY IF EXISTS "thumbnails_upload_creator" ON storage.objects;
DROP POLICY IF EXISTS "thumbnails: authenticated upload own folder" ON storage.objects;
DROP POLICY IF EXISTS "thumbnails: authenticated delete own folder" ON storage.objects;
CREATE POLICY "thumbnails_upload_creator" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "profile_images_insert_creator" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_update_creator" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_delete_creator" ON storage.objects;
DROP POLICY IF EXISTS "profile_images_select_public" ON storage.objects;
-- Remove permissive Dashboard-created policies found in the deployed project.
DROP POLICY IF EXISTS "Users can upload profile images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their profile images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their profile images" ON storage.objects;
DROP POLICY IF EXISTS "profile-images: authenticated upload own folder" ON storage.objects;
DROP POLICY IF EXISTS "profile-images: authenticated update own folder" ON storage.objects;
DROP POLICY IF EXISTS "profile-images: authenticated delete own folder" ON storage.objects;
CREATE POLICY "profile_images_select_public" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'profile-images');
CREATE POLICY "profile_images_insert_creator" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "profile_images_update_creator" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY "profile_images_delete_creator" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-images'
    AND (storage.foldername(name))[1] IN (
      SELECT creator.id::text FROM public.creator_profiles creator
      WHERE creator.user_id = (SELECT auth.uid())
    )
  );

-- Migration 020's aggregate RPC remains the only public sales-count surface.
REVOKE ALL ON FUNCTION public.get_public_product_sales_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_product_sales_counts(UUID[]) TO anon, authenticated;
