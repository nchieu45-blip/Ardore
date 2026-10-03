# Coach settlement implementation

New Ardore payments use platform charges followed by explicit Stripe Connect
transfers. Historical destination charges keep their original checkout, transfer
and refund architecture. No historical Stripe payment is migrated or reassigned.
Stripe remains in TEST mode. Coach prices and the 10% platform fee are unchanged.

## Payment and settlement ownership

- Booking attempts freeze the booking agreement, coach, connected account,
  customer payment and charge architecture. Product orders freeze exact item
  amounts and withdrawal consent. Subscription orders freeze their original
  coach/account/tier; each paid invoice has its own settlement.
- The charge is freshly verified and durably recorded before fulfillment or
  transfer. Paid booking fulfillment still uses the existing lifecycle and slot
  protections. Product and subscription fulfillment is atomic and service-only.
- One checkout has one coach. Mixed-coach carts are refused. Paid group offers
  remain blocked because their paid fulfillment path is incomplete.
- Gross and fee are stored in integer cents. The fee is 10%, rounded to the
  nearest cent; the coach receives the exact remaining cents. Processing costs
  do not reduce a customer's eligible full refund.

## Private ledger and recovery

`payment_orders`, `payment_settlements` and `payment_settlement_actions` are
private service-only tables. Immutable identity/amount snapshots and unique
payment-intent, charge, invoice-cycle and transfer constraints prevent duplicate
settlements or redirection of historical earnings.

Settlement states distinguish awaiting fulfillment, pending, held, transferring,
settled, reversing, refund pending, refunded and failed. Fulfillment is tracked
separately. Provider actions use a parent lease, frozen parameters and permanent
idempotency keys. Provider response loss is reconciled by exact source charge,
coach/account, amount, group and private action metadata before retry.

A mutation with an unresolved result is never repeated outside Stripe's
idempotency retention window. It remains held for reconciliation rather than
risking duplicate money movement. A known rejected/never-posted transfer can be
retried after a fresh provider search and eligibility check.

The owner-only settlement API and payout settings page show sanitized balances
and allow explicit retries. Client-supplied coach, account, amount or status
cannot authorize a transfer. A Stripe-balance transfer is clearly distinguished
from a subsequent bank payout.

## Eligibility

Paid checkout requires fresh provider readiness. Immediately before every new
transfer, Ardore rechecks the protected account association, Accounts v1/v2
ownership and mode, submitted details, enabled charges and payouts, active card
and transfer capabilities, and provider restrictions. A restricted, disabled,
missing or reassigned account holds settlement on the original account. Funds
are never rerouted to a replacement account.

## Refunds, disputes and event ordering

Separate-charge refunds durably reserve the refund before reconciling transfer
reversals. Reversals never exceed the associated transfer. Full eligible booking
refunds still return the full captured customer amount. Historical destination
refunds retain `reverse_transfer` and application-fee refund behavior.

Duplicate/late provider events retrieve current provider state. Refund and
reversal totals and their IDs are monotonic, including delayed read responses.
An older product projection cannot lower the recorded refund or revoke a newer
purchase. Partial provider refunds do not silently lose unfulfilled purchases
or subscription cycles. If a partial refund changes a frozen but unresolved
transfer attempt's amount, the settlement is held for explicit reconciliation.
No automatic partial-refund business policy is introduced.

Fresh dispute ownership/status determines access and transfer eligibility;
`Charge.disputed` alone is only a historical marker. Unresolved/lost disputes
cannot initiate a transfer; a won dispute can resume fulfillment once. A newly
paid cycle whose offer disappeared, or a duplicate unfulfillable purchase,
uses a full technical reconciliation refund.

## Deployment and verification

Three additive Supabase migrations establish the ledger, subscription recovery
safeguards and monotonic observations. Client table and RPC access is revoked;
162 read-only catalog checks and 48 real anonymous/authenticated denial probes pass.

The complete automated suite passes 398 regressions. Lint has zero errors (five
pre-existing warnings), and TypeScript and production build pass. Regression,
permission, Connect and payment-lifecycle tests exercise
fresh eligibility, historical compatibility, fee arithmetic, concurrent replay,
lost transfer/reversal responses, refunds, partial-refund ordering, recurring
cycles and dispute recovery. The opt-in synthetic harness creates only owned
GoTrue accounts and Stripe TEST fixtures, tests real transfers/refunds/invoices,
and removes functional fixtures afterward.

Real Stripe TEST validation passed 16 financial groups, including historical
destination-charge refunds and an actually payout-disabled account. Five final
groups also passed through the deployed authenticated Hostinger application and
genuine signed provider webhooks: product purchase, booking, full cancellation
refund/reversal, owner settlement recovery and the initial subscription invoice.
No production customer/coaching data was used. Mutable fixtures were removed;
pre-cleanup checks found no unexpected third-party interactions.

Minimal private retired TEST object IDs allow already queued signed TEST
webhooks to be acknowledged after fixture removal. They cannot bypass live
webhooks and retain no credentials or customer data. Immutable Stripe TEST
provider history remains auditable.

The separate Hostinger recovery-cron 403 issue and its configuration are
unchanged. Daily stays disabled. No legal/AGB copy is changed.

## Provider references

- [Separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Destination charges](https://docs.stripe.com/connect/destination-charges)
- [Account capabilities](https://docs.stripe.com/connect/account-capabilities)
- [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Connect testing](https://docs.stripe.com/connect/testing)
- [Dispute object](https://docs.stripe.com/api/disputes/object)
