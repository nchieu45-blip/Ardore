BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

SELECT col_not_null('public', 'purchases', 'payment_status', 'purchase status is required');
SELECT col_is_null('public', 'purchases', 'stripe_livemode', 'legacy Stripe environment may remain unknown');
SELECT col_not_null('public', 'purchases', 'amount_refunded', 'refunded amount is required');
SELECT has_column('public', 'purchases', 'stripe_checkout_session_id', 'checkout session is recorded');
SELECT has_index('public', 'purchases', 'purchases_checkout_product_idx', 'checkout/product idempotency index exists');
SELECT has_index('public', 'purchases', 'purchases_valid_product_idx', 'valid sales index exists');
SELECT has_table('public', 'stripe_webhook_events', 'processed Stripe events are recorded');
SELECT has_column('public', 'subscriptions', 'stripe_livemode', 'Stripe subscription mode is explicitly tracked');
SELECT ok(NOT has_table_privilege('anon', 'public.stripe_webhook_events', 'SELECT'), 'anon cannot inspect webhook events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.stripe_webhook_events', 'SELECT'), 'users cannot inspect webhook events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'INSERT'), 'users still cannot forge purchases');
SELECT ok(NOT has_table_privilege('authenticated', 'public.purchases', 'UPDATE'), 'users still cannot alter payment state');
SELECT policies_are('public', 'purchases', ARRAY['purchases_select_own'], 'purchase RLS remains own-read only');
SELECT ok(
  (SELECT with_check ILIKE '%payment_status%paid%' AND with_check ILIKE '%stripe_livemode%true%'
   FROM pg_policies WHERE schemaname='public' AND tablename='reviews' AND policyname='reviews_insert_purchaser'),
  'review entitlement requires a valid live purchase'
);
SELECT ok(
  (SELECT with_check ILIKE '%payment_status%paid%' AND with_check ILIKE '%stripe_livemode%true%'
   FROM pg_policies WHERE schemaname='public' AND tablename='reviews' AND policyname='reviews_update_own'),
  'review updates retain valid-purchase entitlement'
);
SELECT ok(
  pg_get_viewdef('public.public_product_reviews'::regclass) ILIKE '%payment_status%paid%'
  AND pg_get_viewdef('public.public_product_reviews'::regclass) ILIKE '%stripe_livemode%true%',
  'invalid purchases do not contribute public verified reviews'
);
SELECT ok(
  (SELECT qual ILIKE '%payment_status%paid%' AND qual ILIKE '%stripe_livemode%true%'
   FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='products_download_entitled'),
  'private-file entitlement requires a valid live purchase'
);
SELECT function_returns('public', 'get_public_product_sales_counts', ARRAY['uuid[]'], 'setof record', 'sales RPC signature remains aggregate-only');
SELECT ok(
  pg_get_functiondef('public.get_public_product_sales_counts(uuid[])'::regprocedure) ILIKE '%payment_status%paid%'
  AND pg_get_functiondef('public.get_public_product_sales_counts(uuid[])'::regprocedure) ILIKE '%stripe_livemode%true%',
  'sales RPC counts only valid live purchases'
);
SELECT ok(
  has_function_privilege('anon', 'public.get_public_product_sales_counts(uuid[])', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.get_public_product_sales_counts(uuid[])', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc procedure
    CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) permission
    WHERE procedure.oid = 'public.get_public_product_sales_counts(uuid[])'::regprocedure
      AND permission.grantee = 0
      AND permission.privilege_type = 'EXECUTE'
  ),
  'aggregate RPC permissions remain constrained'
);

SELECT * FROM finish();
ROLLBACK;
