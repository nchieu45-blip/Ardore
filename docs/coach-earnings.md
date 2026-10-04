# Coach earnings presentation

Overview and earnings page share an owner-derived, read-only settlement report.
Successful product payments, booking payments and individual subscription cycles
are `payment_settlements` rows; failed/unpaid checkout orders and mutable tier
prices never enter financial totals. All rows are paged, not the payout preview's
latest 50. A data-source failure suppresses the entire report rather than showing
partial or misleading zero totals. TEST and LIVE remain separate; TEST is labeled.

Amounts are whole EUR cents. Original captured gross is shown separately. Revenue
after refunds is gross minus confirmed cumulative customer refunds. Coach net
uses the existing settlement formula `net - floor(net * refund / gross)`; fee
after refunds is retained gross minus that net. No fees or payment data are changed.
Transferred is confirmed transfer amount minus confirmed cumulative reversals.
Pending is max(net minus transferred, zero). Reversal still required is the
opposite positive difference, so `net = transferred + pending - reversalPending`.
Requested but unconfirmed refunds are shown separately, not subtracted as paid.
Reversals adjust transferred balances, never subtract the same refund from net twice.

All-time means all successful recorded ledger transactions. Month and seven-day
charts use their ledger recording date in Europe/Berlin. Refunds correct the
original transaction, not a fictitious negative sale in the refund month. No MRR
projection is presented as realized revenue. Stripe balance transfers are not
bank payouts; provider processing fees and tax calculation are outside this view.

Historical destination payments without a settlement record remain untouched.
Their known product/booking customer amounts after refunds are shown separately,
with coverage warnings. The combined known gross subtotal includes ledger plus
known historical product and booking amounts; detailed fee/net/transfer metrics
remain explicitly ledger-scoped. Past fees, transfers or subscription invoice
history cannot be derived from today's prices and are never fabricated. Only current
trusted payment statuses count in that historical subtotal; disputes/reversals
are flagged separately. No historical Stripe payments are migrated or modified.

Privileged ledger/history reads happen only after matching the authenticated user
to the coach. Every financial query is coach-scoped and mode-scoped; the browser
receives financial presentation values, not payment/provider/customer identifiers.
Existing private ledger permissions and RLS are unchanged. No schema migration.
