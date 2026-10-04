# Discount lifecycle

Coaches keep ownership of commercial prices, discount values, scope and optional
limits. The server alone manages redemption counts and fulfillment.

A private redemption ledger reserves capacity for 45 minutes without incrementing
the successful-use counter. Database row locks serialize global and optional
per-customer limits. Expired holds are excluded from availability; canceled
sessions release their holds. Failed/open checkout may retain its temporary hold
until cancellation/expiry but never permanently consumes quota. Resumed bookings
retain their original commercial discount snapshot.

Successful fulfillment consumes the reservation inside the same transaction as
the product entitlement, confirmed booking or first paid subscription cycle.
Repeated observations are idempotent. A late payment with unavailable capacity
rolls back fulfillment and uses the existing full-refund/reconciliation path.
Refunds do not restore previously consumed quota, preserving existing behavior.

Amounts use whole cents. Fixed discounts are capped at the payable amount. A
positive total below EUR 0.50 is rejected with a German explanation. A zero-total
product uses the existing no-payment-required Checkout fulfillment (no charge or
PaymentIntent); zero-total bookings and subscriptions bypass Stripe entirely.
None creates settlement or a coach transfer. Paid settlement retains the 10%
platform fee calculated on the actual discounted customer payment.

The existing subscription schema/checkout price represents an ongoing discounted
monthly price for the lifetime of that subscription, not a first-cycle promotion
or configured duration. One redemption is consumed per new subscription, not per
recurring invoice. A 100% monthly promotion uses the existing free-subscription
entitlement model. Coach setup and buyer subscription UI explain this behavior.

The ledger intentionally has RLS enabled with no client policies and no client
privileges. Its mutation RPCs are service-role-only. Discount triggers block
client-controlled counter and ownership changes while preserving coach edits.

Verification:

- `node --test scripts/verify-*.mjs`
- `node scripts/verify-settlement-permissions.mjs --migration=supabase/migrations/20261004170236_discount_redemption_lifecycle.sql --sql`
- `node scripts/test-synthetic-settlement.mjs --run-production-synthetic --discount-database-only`
- `node scripts/test-synthetic-settlement.mjs --run-production-synthetic --discount-lifecycle-only`

Synthetic provider checks require TEST credentials and deployed matching code.
The script owns every fixture explicitly, checks for outside interactions before
cleanup, refunds captured TEST payments, reverses TEST transfers and deletes only
its own mutable records. Stripe's immutable TEST history remains with retirement
markers so delayed provider webhooks cannot recreate cleaned fixture records.
