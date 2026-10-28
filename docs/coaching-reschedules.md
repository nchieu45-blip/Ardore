# Coaching reschedules

Confirmed 1:1 bookings enqueue separate customer and coach messages in the same transaction as the time change. A schedule revision distinguishes repeated changes (including A → B → A) from a retry of the same update. The existing customer/coach authorization, cancellation cutoff and slot validation remain in force.

Coaches can move one dated group occurrence from its session page. The modal uses Europe/Berlin and names both the old and new time. Other dates in a recurring course remain unchanged. Every confirmed attendee and the coach receive independent durable messages.

## Stable booking and payment identity

The original occurrence key remains immutable. `group_occurrence_schedules` maps that identity to its effective time. Payment orders, agreed prices, reservations and booking references stay unchanged. Existing session links still resolve to the current time; video room creation, join authorization, reminders, cancellation messages, buyer lists, booking options and marketplace cards use the effective schedule.

The server authenticates the coach and accepts a request UUID plus the expected current time. Exact retries return the original result; stale updates or a reused UUID with different parameters are rejected. The database serializes conflicting coach calendar changes, including concurrent group enrollment and 1:1 writes. Moves are refused during open payments/refund review, active reminder dispatch, the video joining window, or conflicting appointments. New dates must be within 90 days. Ambiguous/nonexistent Berlin clock times are rejected.

## Delivery and retries

A durable outbox stores one recipient per event/revision. Claims use leases. A failed recipient does not prevent another from receiving their message. The accepted request payload and provider idempotency key remain frozen across retries, including an uncertain database completion after provider acceptance. Existing cron processing retries pending/failed notices. Events outside the provider deduplication safety window are held for reconciliation rather than blindly resent; this is not an unlimited exactly-once guarantee.

Group reminders also carry the schedule revision. A guarded claim checks the effective start under the same class lock, preventing a stale reminder from being claimed for a newer schedule. Already processing reminders block a move until their lease completes/expires.

## Validation

- Local regression: 961 tests passed; typecheck and production build passed; lint has zero errors and four existing warnings.
- Isolated GoTrue/PostgreSQL integration: real routes, transactions, permissions, paid ledger preservation, weekly exceptions, stale/repeated/concurrent requests, reminder revisions, calendar races, independent recipient failures and frozen retries passed. No Stripe or Daily calls were made.
- Eight real Resend test-sink messages were accepted, with stable provider identity on a repeated send. Dashboard delivery verification remains pending because the native browser was locked. Provider rejection and uncertain database completion were deliberately simulated.
- Desktop and 390px mobile interaction checks used the actual component with a clearly marked synthetic local endpoint: conflict/uncertain errors, preserved input, error focus, Escape/focus return, disabled pending controls and double-click suppression passed. Three submissions produced exactly three requests (409, 503, success). No horizontal overflow.

Reproducible unit checks:

```sh
node --test scripts/test-app-url.mjs scripts/verify-*.mjs
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

Opt-in integration uses a disposable, migrated database with a dedicated GoTrue/PostgREST gateway on localhost:55131. Create actors through the GoTrue Admin API, never SQL inserts into auth.users. `scripts/test-isolated-coaching-reschedules.mjs --credentials /absolute/local-credentials.json` checks the dedicated database-name prefix and refuses Stripe/Daily keys. Optional `--resend-env` performs real delivery to run-specific Resend test sinks only and requires explicit authorization. Do not use the repository production `.env.local` for fixtures.

## Release sequence

Migration `20261028144343_coaching_reschedule_emails.sql` and the matching application must ship together. Pause 1:1 rescheduling during migration and rollout of all instances: the old application sends directly and its worker cannot process the new event kind. Apply the migration before enabling the new application, then resume and check the outbox/cron. Test a current session link and confirm all views show the same effective time.

This PR prepares the migration only. Production migration, merge and deployment require the owner's separate release authorization.
