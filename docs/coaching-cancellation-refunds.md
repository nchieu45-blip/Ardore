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
events reconcile provider state without creating refunds. For `automatic_async`
Connect captures, missing transfer or expected application fee keeps an already
authorised cancellation `pending` (`payment_capture_pending`), with no refund
POST until both associated objects exist. Signed `charge.updated`,
`transfer.created` and `application_fee.created` events can resume only that
durable cancelled-booking claim and reuse its idempotency key. They cannot create
a cancellation claim or replace a failed provider refund. Provider observation
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

Current deployed TEST checkouts have no coach transfer. The destination-transfer
rehearsal uses a separate synthetic Accounts-v2 account in Stripe's TEST sandbox,
then closes only that account. Sandbox Connect activation does not activate live
Connect, modify credentials, or link a real Ardore coach account. The application
refund APIs remain interoperable with the synthetic Accounts-v2 recipient.
Stripe's official successful-verification and German test-bank fixtures are used.
If Stripe keeps transfer capability pending despite supplied requirements, the
verifier reports `pending_provider_verification`, continues other checks and
exits with status 2 after cleanup. This is not a successful transfer rehearsal.

Stripe's asynchronous test-card transition can be delayed beyond the bounded
observation window. The verifier then reports `pending_provider_simulation`,
never a passed bank-failure test. A provider-failed refund that the application
has not reconciled remains a hard test failure. API-failure and refund.failed
handling also have deterministic regression coverage.
