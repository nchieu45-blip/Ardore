begin;
select plan(12);

select has_column('public', 'bookings', 'payment_status', 'booking payment state exists');
select has_column('public', 'bookings', 'stripe_checkout_session_id', 'checkout identity exists');
select has_column('public', 'bookings', 'stripe_livemode', 'Stripe mode is tracked');
select has_column('public', 'bookings', 'reservation_expires_at', 'reservation expiry exists');
select has_column('public', 'bookings', 'amount_refunded_cents', 'refund amount exists');

select col_is_not_null('public', 'bookings', 'payment_status', 'payment state cannot be null');
select col_default_is('public', 'bookings', 'payment_status', '''unpaid''::text', 'new legacy writes default to unpaid');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bookings_stripe_checkout_session_uidx'),
  'checkout sessions are unique'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bookings_stripe_payment_intent_uidx'),
  'payment intents are unique'
);
select ok(
  pg_get_constraintdef(oid) like '%pending_payment%confirmed%',
  'only pending and confirmed bookings block overlaps'
) from pg_constraint where conname = 'bookings_no_overlapping_active_sessions';
select ok(
  pg_get_constraintdef(oid) like '%reservation_expires_at IS NOT NULL%',
  'pending bookings require an expiry'
) from pg_constraint where conname = 'bookings_pending_reservation_check';
select ok(
  coalesce((
    select with_check like '%payment_status%not_required%'
      and with_check like '%payment_status%paid%'
      and with_check like '%stripe_livemode%true%'
    from pg_policies
    where schemaname = 'public'
      and tablename = 'session_reviews'
      and policyname = 'session_reviews_insert_buyer'
  ), false),
  'verified session reviews require live paid or legitimate not-required bookings'
);

select * from finish();
rollback;
