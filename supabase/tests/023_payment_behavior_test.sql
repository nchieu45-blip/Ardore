BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

CREATE TEMP TABLE payment_test_context AS
SELECT purchase.buyer_id, product.creator_id
FROM public.purchases purchase
JOIN public.products product ON product.id = purchase.product_id
LIMIT 1;

DO $fixtures$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM payment_test_context) THEN
    RAISE EXCEPTION 'Payment behavior tests require one existing buyer/product relationship';
  END IF;
END
$fixtures$;

CREATE TEMP TABLE payment_test_products (id UUID PRIMARY KEY, expected_count BIGINT, label TEXT);
INSERT INTO payment_test_products VALUES
  (gen_random_uuid(), 1, 'paid_live'),
  (gen_random_uuid(), 0, 'refunded_live'),
  (gen_random_uuid(), 0, 'paid_test');

INSERT INTO public.products (id, creator_id, title, type, price, is_published)
SELECT fixture.id, context.creator_id, 'Transactional payment test', 'pdf', 10, true
FROM payment_test_products fixture CROSS JOIN payment_test_context context;

INSERT INTO public.purchases (
  buyer_id, product_id, amount_paid, stripe_payment_intent_id,
  stripe_checkout_session_id, stripe_livemode, payment_status, amount_refunded
)
SELECT context.buyer_id, fixture.id, 10,
       'pi_transactional_' || fixture.label, 'cs_transactional_' || fixture.label,
       fixture.label <> 'paid_test',
       CASE WHEN fixture.label = 'refunded_live' THEN 'refunded' ELSE 'paid' END,
       CASE WHEN fixture.label = 'refunded_live' THEN 10 ELSE 0 END
FROM payment_test_products fixture CROSS JOIN payment_test_context context;

INSERT INTO public.reviews (buyer_id, product_id, rating, content)
SELECT context.buyer_id, fixture.id, 5, 'Transactional payment test'
FROM payment_test_products fixture CROSS JOIN payment_test_context context;

SELECT plan(8);
SELECT is(
  (SELECT sales_count FROM public.get_public_product_sales_counts(
    ARRAY[(SELECT id FROM payment_test_products WHERE label='paid_live')]
  )), 1::BIGINT, 'paid live purchase counts as one sale'
);
SELECT is(
  (SELECT sales_count FROM public.get_public_product_sales_counts(
    ARRAY[(SELECT id FROM payment_test_products WHERE label='refunded_live')]
  )), 0::BIGINT, 'refunded purchase is excluded from sales'
);
SELECT is(
  (SELECT sales_count FROM public.get_public_product_sales_counts(
    ARRAY[(SELECT id FROM payment_test_products WHERE label='paid_test')]
  )), 0::BIGINT, 'test-mode purchase is excluded from sales'
);
SELECT is(
  (SELECT count(*) FROM public.public_product_reviews
   WHERE product_id IN (SELECT id FROM payment_test_products)),
  1::BIGINT, 'only a valid live purchase contributes a public verified review'
);
SELECT is(
  (SELECT count(*) FROM public.purchases
   WHERE product_id IN (SELECT id FROM payment_test_products) AND payment_status='paid' AND stripe_livemode=true),
  1::BIGINT, 'only one fixture grants entitlement'
);
SELECT throws_like(
  $$INSERT INTO public.purchases (buyer_id, product_id, amount_paid, stripe_livemode, payment_status)
    SELECT context.buyer_id, fixture.id, 10, true, 'paid'
    FROM payment_test_context context CROSS JOIN payment_test_products fixture
    WHERE fixture.label='paid_live'$$,
  '%duplicate key%', 'duplicate buyer/product purchase is rejected'
);
INSERT INTO public.stripe_webhook_events (event_id, event_type, livemode)
VALUES ('evt_transactional_duplicate', 'checkout.session.completed', true);
SELECT throws_like(
  $$INSERT INTO public.stripe_webhook_events (event_id, event_type, livemode)
    VALUES ('evt_transactional_duplicate', 'checkout.session.completed', true)$$,
  '%duplicate key%', 'duplicate webhook event is rejected'
);
SELECT throws_like(
  $$UPDATE public.purchases SET payment_status='untrusted'
    WHERE product_id=(SELECT id FROM payment_test_products WHERE label='paid_live')$$,
  '%violates check constraint%', 'unknown purchase status is rejected'
);

SELECT * FROM finish();
ROLLBACK;
