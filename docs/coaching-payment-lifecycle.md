# Coaching checkout lifecycle

A booking owns immutable commercial terms and zero or more private payment
attempts. Coach prices, duration and cancellation settings remain fully editable
for future bookings. A retry always uses the original booking's agreed terms.

Initial requests carry a stable buyer-scoped UUID. The database serializes
attempt creation and assigns a persistent Stripe idempotency key. An open
Checkout is resumed, including after a declined card. Processing payments retain
the reservation and cannot start another charge. A fresh provider-confirmed
closed failed/expired Checkout can be replaced without creating another booking.
Lost creation responses are recovered through the same idempotency key or a
strictly owned, discovery-only provider lookup. Unknown outcomes keep their hold.

Webhooks retrieve current Checkout, PaymentIntent and captured Charge state and
validate exact attempt identity, owner, amount, currency and mode. Only a captured
paid Checkout can confirm a booking. The existing Postgres exclusion constraint
atomically protects the slot even for late payments and parallel attempts.

A late payment restores a future available slot. If the slot is occupied, the
appointment elapsed, the booking cannot be fulfilled, or another payment already
fulfilled it, an immutable payment-specific system refund claim reconciles the
full actual customer payment. The existing refund engine preserves Connect
transfer/application-fee reversal, frozen amounts and provider idempotency.
The losing payment never overwrites a winning booking or its cancellation ledger.
Customer pages show technical refund progress without exposing private ledgers.

Event claims use a leased worker token. Completed duplicate events return success;
concurrent unfinished events request a retry. A failed or crashed worker's claim
can be recovered without relying on event delivery order.

`/api/cron/coaching-payments` requires the configured cron credential. GitHub calls
it every ten minutes to check expired holds against current Stripe state and retry
owned outstanding reconciliation claims. Availability reads also check a bounded
set of expired holds. Provider errors/unknown creation outcomes preserve holds and
report an explicit failure rather than advertising an unsafe free slot.

The additive migration does not backfill or rewrite existing bookings. Historical
Checkout identities are registered lazily after validating the exact stored
Session. Once registered, old attempts remain identifiable after a retry.

Regression tests cover provider identity and ordering, retries, leases, technical
refunds and failure handling. SQL behavior tests create only rollback-owned public
fixtures and require dedicated GoTrue Admin-created test users; Auth rows must
never be written with SQL. `test-synthetic-coaching-payment-lifecycle.mjs` is an
explicitly opted-in production verification using only TEST Stripe credentials,
synthetic email sinks and IDs created by that execution. Its Checkout confirmation
uses Stripe CLI's official test-fixture protocol and real provider-signed webhooks.
All mutable fixtures are cleaned; Stripe retains immutable TEST payment history.
