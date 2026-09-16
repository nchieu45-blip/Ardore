-- Booking OS phase 2: Stripe-backed payment state for standalone coaching.
-- Existing standalone rows remain available for historical continuity, but are
-- explicitly not represented as Stripe-paid production revenue.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS payment_status text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_livemode boolean,
  ADD COLUMN IF NOT EXISTS amount_refunded_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS discount_id uuid REFERENCES public.discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_redeemed_at timestamptz;

UPDATE public.bookings
SET payment_status = CASE
  WHEN is_subscription_session OR price_cents = 0 THEN 'not_required'
  ELSE 'unpaid'
END
WHERE payment_status IS NULL;

ALTER TABLE public.bookings
  ALTER COLUMN payment_status SET DEFAULT 'unpaid',
  ALTER COLUMN payment_status SET NOT NULL,
  ADD CONSTRAINT bookings_status_check CHECK (status IN (
    'pending_payment', 'confirmed', 'cancelled', 'completed',
    'payment_failed', 'expired', 'refunded', 'reversed'
  )),
  ADD CONSTRAINT bookings_payment_status_check CHECK (payment_status IN (
    'not_required', 'unpaid', 'pending', 'paid', 'partially_refunded',
    'refunded', 'disputed', 'chargeback', 'reversed', 'failed', 'expired'
  )),
  ADD CONSTRAINT bookings_amount_refunded_check CHECK (
    amount_refunded_cents >= 0 AND amount_refunded_cents <= price_cents
  ),
  ADD CONSTRAINT bookings_pending_reservation_check CHECK (
    status <> 'pending_payment' OR reservation_expires_at IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_checkout_session_uidx
  ON public.bookings (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_payment_intent_uidx
  ON public.bookings (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Pending checkout sessions reserve a slot. Terminal payment states release it.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_overlapping_active_sessions;

SET LOCAL search_path = public, extensions, pg_catalog;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_overlapping_active_sessions
  EXCLUDE USING gist (
    creator_id WITH =,
    tstzrange(blocked_start_at, blocked_end_at, '[)') WITH &&
  )
  WHERE (status IN ('pending_payment', 'confirmed'));

-- A completed/paid booking (or an included subscription session) is the only
-- session eligible for a verified review. RLS remains the authorization boundary.
DROP POLICY IF EXISTS "session_reviews_insert_buyer" ON public.session_reviews;
CREATE POLICY "session_reviews_insert_buyer" ON public.session_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    buyer_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.bookings booking
      WHERE booking.id = booking_id
        AND booking.buyer_id = auth.uid()
        AND booking.status IN ('confirmed', 'completed')
        AND (
          booking.payment_status = 'not_required'
          OR (
            booking.payment_status = 'paid'
            AND booking.stripe_livemode = true
          )
        )
        AND booking.scheduled_at + make_interval(mins => booking.duration_minutes) <= now()
    )
  );
