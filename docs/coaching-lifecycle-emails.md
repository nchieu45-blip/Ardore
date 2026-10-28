# Cancellation and refund emails

Every future 1:1 or group booking cancellation queues a transactional notice for
both the customer and the coach, including the cancelling party. Refund receipts
are separate: only a new provider-confirmed `amount_refunded_cents`, accompanied
by `refunded` or `partially_refunded` payment status, queues a receipt. Pending or
failed refund requests do not confirm a refund. Partial refunds show the new
increment and the cumulative total. Coach copy describes the customer refund;
it does not claim that a transfer reversal or payout has completed.

Database triggers capture the event in the same transaction as the booking
update. This includes API cancellation, signed-webhook reconciliation and payment
recovery. Existing historical cancellations/refunds are not backfilled. Legacy
group registrations without a trustworthy occurrence timestamp are excluded.
The existing cancellation authorization and financial reconciliation remain the
authority; no browser can enqueue or claim a delivery. Optional reminder or
marketing preferences do not suppress these transactional notices.

The old direct 1:1 cancellation email dispatch is replaced by the queue; existing
in-app notifications remain. Cancellation routes attempt scoped delivery after
the response. The authenticated session-reminders cron drains all pending events
independently of either reminder worker (currently scheduled every ten minutes).
Refund observations arriving through webhooks/recovery therefore reach the queue
without coupling financial success to external email delivery.

## Duplicate protection and operations

- Unique identity: booking kind + booking ID + event + cumulative refund amount
  (zero for cancellation) + recipient. Repeated status writes and webhooks cannot
  create another copy. A later distinct partial refund creates a new event.
- Row-locked five-minute claims serialize parallel workers. Completion/release
  requires the exact lease token and an unexpired lease.
- The first claimed request is frozen, including recipient, subject, HTML and
  plain text. Retries use `coaching-update/<delivery UUID>` as the Resend
  idempotency key. This also covers provider acceptance followed by a failed DB
  completion. Sent payload and event personal details are cleared.
- Resend's idempotency window is finite. Ambiguous deliveries become `held` after
  23 hours rather than risk another send after the 24-hour provider window.
  Cron reports held/failing deliveries as HTTP 503. An operator must check the
  provider's event/message log before resolving a held record. Do not delete,
  reset, or re-key ambiguous records to force another email.
- This is duplicate-safe retry behavior, not an unconditional exactly-once
  delivery guarantee. Provider outages, invalid/missing addresses and unresolved
  held messages require operational attention.

## Verification

`node --test scripts/verify-coaching-emails.mjs` tests all eight variants, precise
amount/copy, HTML escaping, Berlin time, account links, parallel workers, frozen
retries after provider or completion failures, recipient isolation and pagination.
Existing cancellation, authorization, refund and cron regressions remain in the
full `verify-*.mjs` suite.

`node scripts/test-isolated-coaching-emails.mjs --credentials /absolute/local-credentials.json`
is explicit opt-in and accepts only HTTP loopback with an own
`ardore_lifecycle_test_*` database declaration. Provision a disposable schema with
the migrations, GoTrue Admin API and REST first; credentials JSON has `url`,
`anon`, `service`, `database`. The script creates only synthetic users/bookings.
Never provide a production proxy or production credentials. No Stripe/Daily key
may be present. Financial confirmations are simulated at the local reconciliation
DB boundary; this is not a real payment/refund test.

Optional `--resend-env /absolute/private.env --output /absolute/artifacts` enables
real sends solely to this run's `delivered+ardore-lifecycle-...@resend.dev` test
sinks. It verifies that a retried accepted request returns the same message ID.
Check the exact recipients and subjects in the authenticated Resend dashboard to
verify `Delivered`, then remove the disposable database/containers and temporary
credentials. Never insert or modify `auth.users` with raw SQL.

## Release

Apply `20261028081242_coaching_lifecycle_emails.sql` before releasing the matching
application. Migration and production deployment each require owner approval.
Do not roll out the new application without its queue table/functions/triggers.
Coordinate the cutover with booking mutations paused: an old application instance
can still send its former direct cancellation notice while the new trigger
queues the same event. Resume mutations only when all instances run this version.

Release history is recorded by the three migrations `20261028081234` (temporary
transition gate), `20261028081242` (outbox) and `20261028081704` (remove gate).
The gate rejects cancellation/refund status changes so clients can retry; it
does not wait on long-lived table locks. It was tested in a rolled-back local
SQL transaction. During the initial release, the already validated application
was deployed before removing the gate; the final main deployment runs the same
application code. Fresh database installs can apply all three in sequence.
