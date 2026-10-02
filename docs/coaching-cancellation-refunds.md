# Coaching cancellations and full refunds

The booking agreement is immutable: new bookings snapshot the coach's cutoff
(default 24 hours). The booking form displays it and sends a comparison guard;
the server rejects an intervening change instead of silently changing the
agreement. The database checks the offer while holding a share lock. Later coach
price, duration, description, availability and cutoff edits remain permitted.

Customers may cancel up to their booking's cutoff and receive every actually
captured cent, including fees. Later cancellation stays refused. Coaches can
cancel or abort a confirmed session whose service has not been fully delivered and refund the whole
customer payment regardless of the customer cutoff. Completed sessions cannot
enter this cancellation path. Mere passage of the scheduled end time is not
proof of delivery. Included/zero-price bookings have no Stripe refund.

Historical rows lacking an agreed cutoff remain NULL rather than receiving a
fabricated current policy. Customer cancellation/rescheduling requires support
for those rows; coach cancellation can still refund a valid captured payment.

`cancel_coaching_booking` checks participant identity, deadline, status and
completion under a row lock, then atomically cancels the booking and creates the
single `booking_refunds` claim. Browser roles cannot call the mutation RPCs or
write bookings/refunds. Participants may select only booking ID, state and amount
from the ledger; fee accounting stays private. Account deletion refuses before
any side effects when financial booking records exist.

The helper verifies Stripe payment/charge ownership metadata, currency, captured
amount and test/live mode. It freezes the remaining captured amount before the
refund POST, uses a persistent booking idempotency key, and also discovers an
existing refund by metadata/ID when Stripe's key cache has expired. It never
creates a replacement for a failed provider refund ID. Unknown transfer/payment
architectures or unreconciled existing refunds fail closed for support review.

Live checkouts currently use destination charges, with a 10% application fee.
Test checkouts remain platform-only. Destination refunds use Stripe's atomic
`reverse_transfer` and `refund_application_fee`, validate booking-associated
transfer/fee ownership and caps, and record reversal/fee refund IDs. Stripe's
actual processing fee ledger is recorded as platform cost for customer
cancellations or coach cost for coach cancellations; unavailable accounting stays
explicitly pending and does not reduce customer refunds.

Booking status remains `cancelled`; payment status becomes `refunded` only after
Stripe confirms success. Pending and failed refunds remain visible separately.
Fresh `charge.refunded`, `refund.created`, `refund.updated` and `refund.failed`
events reconcile provider state without creating refunds. Provider observation
timestamps protect against stale concurrent responses; an API outage cannot
replace a confirmed refund with an old paid state. Stripe webhook event IDs also
protect duplicate deliveries.

## Verification

Run lint, `npx tsc --noEmit --incremental false`, build, and the CI regression
command. Catalog permission tests are in
`supabase/tests/coaching_refunds_permissions_test.sql` and
`supabase/tests/trusted_entitlements_test.sql`.

The opt-in `scripts/test-synthetic-coaching-refunds.mjs
--run-production-synthetic` verifies the deployed application using synthetic
Supabase users and Stripe TEST payments. It requires local service credentials,
keeps credentials/cookies in memory, and deletes only IDs it created. It covers
cutoff changes, pricing edits, ownership, late/free/completed cancellation,
customer/coach refunds, repeated calls, API failure, real asynchronous bank
refund failure with no automatic replacement, dashboard status, actual destination transfer
and fee reversal, and provider webhook acceptance. Stripe payment/refund history
is immutable; those test entries are marked cleaned while mutable test users,
bookings, refund rows, checkout reservations and Connect accounts are removed.

The current Stripe account has not activated Connect. Actual destination-transfer
rehearsal therefore requires Connect setup before live launch. Current deployed
TEST checkouts have no coach transfer; destination reversal behavior is covered
by regression tests. The synthetic verifier reports this explicitly and continues
with actual refund webhook acceptance/replay instead of enabling account features.
