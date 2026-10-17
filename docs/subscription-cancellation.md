# Buyer subscription cancellation

## Agreed behavior

- Paid subscriptions: schedule cancellation at the current billing-period end.
  Do not refund, cancel immediately, change prices, or modify existing invoices.
  Outstanding invoices are not waived by cancellation.
- App-only `free_` subscriptions (including `free_discount_`) with NULL Stripe
  mode: end immediately after explicit confirmation. Their nominal 100-year
  expiry is not a paid period; no Stripe request is made.
- Cancellation does not cancel existing coaching bookings or issue refunds.
  The separate booking cancellation policy remains unchanged.

## Authority and state

`GET /api/subscriptions/[id]/cancel` inspects state without mutations. The client
requests it only when a buyer opens the cancellation control, not once for every
subscription on page load. `POST` accepts only `{}` after confirmation.

Both methods authenticate with `getUser`, then select the local subscription
through the user's RLS client with explicit ID and buyer filters. Paid provider
IDs and test/live mode must match the trusted local row. Exact server-issued
buyer, coach and tier metadata must match as an additional check. Current-model
subscriptions must also match their private immutable `payment_orders` record;
legacy subscriptions without an order require the exact historical linkage.
No published-coach, payout-readiness or currently-active-tier requirement may
prevent an existing subscriber from canceling.

Paid POST sets only `cancel_at_period_end: true`, then reads and validates the
current Stripe state again. Repeating this boolean update is safe; it does not
create a replacement subscription or a new financial transaction. It deliberately
does not reuse a permanent per-subscription idempotency key: such a key could
replay an old response after an external dashboard reactivation. A timeout is
unconfirmed, not successful; the UI offers a fresh GET before another explicit
attempt. A GET that has not yet observed cancellation cannot prove an in-flight
POST will not finish later.

Stripe remains the source of truth for cancellation scheduling. No migration or
copied cancellation columns are needed. The endpoint never writes paid status or
`current_period_end`: existing signed lifecycle webhooks finalize status, and
only the existing paid-invoice fulfillment may advance access. Displayed access
is bounded by Ardore's existing live, active, unexpired entitlement check and the
provider's effective end. `canceled_at` is not used as an access end date.

Free cancellation uses a privileged, ownership-scoped compare-and-set update
including the old provider ID, NULL mode, status and period. A concurrent change
causes a recheck, never a blind overwrite. Browser subscription write privileges
are not changed. No cancellation emails or background jobs are introduced.

POST requires JSON and an exact request/configured application Origin to defend
cookie-authenticated requests against CSRF (the configured origin also supports
Hostinger reverse proxies). Both methods return `Cache-Control: private,
no-store`; the client also uses `cache: 'no-store'`. Credentials, provider
metadata and raw Stripe/database errors are not returned or logged.

## Deliberate limitations

- Unscheduled managed schedules, cancellation dates beyond the current period,
  ambiguous multi-item periods, missing historical
  linkage, mode mismatch or unavailable provider state fail closed with a support
  or retry message. No cancellation is fabricated.
- The list uses the neutral label “Aktueller Zeitraum bis”; scheduled status is
  shown after a fresh inspection. It is not a Stripe-independent offline billing
  history or a bulk synchronization system.
- This is authenticated subscription management, not a claim of complete legal
  launch compliance. A public cancellation flow, durable confirmation delivery,
  contract copy and tax obligations still require separate legal/product review.
  Stripe Tax configuration is unchanged; recurring sales need their applicable
  tax/registration setup checked separately before launch.

## Verification and release boundary

Run the repository's lint, non-emitting TypeScript, mocked regression tests and
production build. `verify-subscription-cancellation.mjs` covers the route and
provider/database boundaries; `verify-subscription-cancellation-ui.mjs` covers
the client interaction states. These tests do not load credentials, contact
Stripe/Supabase, or mutate production.

A separately approved isolated Stripe sandbox exercise is still needed before
claiming end-to-end provider verification. Do not use a real subscription or
production synthetic fixtures as a substitute. Releasing requires explicit
approval for the PR merge and resulting Hostinger auto-deployment. There is no
production migration to apply and no need to enable GitHub Supabase migrations.

References: [Stripe cancellation](https://docs.stripe.com/billing/subscriptions/cancel),
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
