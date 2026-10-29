# Account deletion safety

## Current validation — 2026-10-28/29

The repair on `codex/safe-account-deletion` now incorporates main
`c3fed1ebbd799f9aa3723004d071e8224c97cdf6`, including PRs #11 and #12:
durable cancellation/refund emails, group rescheduling and effective-time
reminders. Applied main migrations and the three pending repair SQL files
remain byte-for-byte unchanged.

- 1,069 offline regressions passed locally.
- 68 real isolated Supabase checks passed with actual local GoTrue, PostgreSQL,
  Storage and application deletion orchestration. This includes both directions
  of group-booking/upload/order races; retained paid/free group history; reminder
  claims and group moves concurrent with deletion; the real email worker with
  simulated send/DB-completion faults and identical retries; simulated Stripe
  read/cancel/ambiguous-timeout faults; and four concurrent app retries with one
  successful deletion and no repeated cancellation.
- The independent local reminder SQL suite passed, including two contending
  connections. Its own disposable database was removed.
- ESLint passed with four existing warnings; non-emitting TypeScript and the
  Webpack production build passed (75 static pages). Local Node is 24.15.0;
  exact-head Node-22 GitHub CI is still a separate release check.
- Source was copied without environment files into an isolated build folder.
  Only the established loopback test configuration was used. The six newly
  integrated main schema files were applied ONLY to the local test database.
  The original three fictional Auth users and four subscriptions remain; all
  newly owned fixtures, mail rows, reschedule rows, pause hooks and barriers
  were removed. No real Stripe call, email or production mutation occurred.

Earlier verification sections below are historical evidence with their original
scope/counts. Their old application SHAs and release order are not current
deployment instructions. Refer to PR checks for the final exact head and Node-22
result; an earlier green CI does not validate later commits.

## Release decision and authoritative runbook

The operational sequence, pinned hold/recovery candidates, exact SQL checksums,
approvals and stop conditions are maintained in
[the Hostinger rollout plan](account-deletion-hostinger-rollout.md).
It is the single authoritative operational sequence; do not combine it with
older instructions that deployed the repair before SQL under an assumed
independent hosting hold.

The owner conditionally authorizes deployment if all checks and safety evidence
pass. **Production release remains NO-GO:** retirement of old destructive
handlers/in-flight requests and a hosting fallback that cannot reopen the legacy
path are not established. Green CI, a new build, a 503 response, two builds,
timeouts, a restart or the verified backup do not prove these conditions.
Hostinger has not confirmed an independent all-origin admission/drain control.
Do not treat its absence as owner acceptance of an undefined risk.

For the concrete staged plan: publish only the independent hard-hold baseline
after its release gate; verify coverage/old-path retirement and fallback; keep
that hard-hold application active during the three separately approved
migrations; verify the resulting schema; then release the re-integrated,
tested repair with explicit reopening coverage. The repair's missing-RPC 503
is additional defense, not a substitute for retiring legacy executions.
The repair currently opens deletion when deployed with its RPCs installed;
there is no additional delayed reopen switch.

Never run the SQL while an old destructive handler can still receive or finish
requests. That old handler deletes application rows in separate calls before
Auth deletion; a later trigger rejection cannot undo earlier committed writes.
Keep `SUPABASE_MIGRATIONS_ENABLED` absent/false at repository/environment levels
and never dispatch the migration workflow for this release.
Production SQL requires separate approval for the three exact migration files;
conditional application deployment approval does not authorize SQL.

Fallback means a newly reviewed application release with deletion hard-held and
applied SQL/history retained. Never restore an old active deletion handler,
force-reset main, remove uncertain Auth-started barriers, disable triggers/RLS,
replay applied migrations or restore the backup over later customer transactions.
See the authoritative runbook for stage-specific stop and recovery actions.

## Behavior

- The authenticated caller can delete only their own account, after an exact
  trusted Origin, JSON request and `LÖSCHEN` confirmation. No browser-supplied
  user, creator or provider IDs are accepted. Responses are private/no-store.
- Any booking, purchase, class booking, payment order/settlement, coaching payment
  attempt, group reservation, host-initialized group occurrence or discount
  redemption involving the account requires support review.
  This intentionally conservative policy also covers completed/failed history.
- Stored files require support review. A service-only RPC checks both current
  `owner_id`, legacy `owner` and all existing Ardore bucket folder conventions,
  including service-uploaded verification files; a private trigger checks again during the Auth
  deletion cascade. No automatic bucket/file cleanup or ownership reassignment.
- Before reading retention/subscription snapshots, the server claims a durable
  write barrier. New records and Storage inserts/ownership changes use the same
  short ordered transaction advisory locks as the final profile deletion guard.
  This includes service-role Storage uploads, not merely browser RLS checks.
- Only the service role can start/mark/release deletion. A five-minute worker
  lease prevents duplicate workers; lease expiry never reopens writes. Stale
  attempt tokens cannot release a newer attempt or authorize an Auth call.
  A confirmed pre-Auth failure can release its matching barrier. Once an Auth
  request may have started, the barrier survives errors and process restarts.
  Retry after the worker lease expires can finish deletion; never clear that
  uncertain state by an automatic timer or manual SQL as a workaround.
- Read errors, unknown counts, truncated snapshots, duplicate provider bindings,
  mismatched ownership/mode, missing Stripe resources and unavailable credentials
  all stop deletion. Every subscription status is inspected, not only `active`.
- All paid subscription bindings are verified before any cancellation. Account
  deletion retains the existing **immediate** cancellation semantics, with
  `invoice_now: false, prorate: false`; it is distinct from the normal voluntary
  period-end cancellation flow. No refund or Stripe Tax configuration is changed.
- Every paid subscription must be confirmed terminal at Stripe. An error or
  ambiguous timeout preserves local account/recovery data. A partial provider
  cancellation cannot be rolled back; the message explains that some subscriptions
  may already have ended. Retry reads terminal state instead of canceling twice.
- After a second retention/binding check, one Auth Admin API hard-delete invokes
  the existing FK cascades. No preliminary manual application-table deletes.
  An explicit `user_not_found` read confirms completion; GoTrue can legitimately
  return an empty deletion response. Only then may creator notices be sent.

## Verification on 2026-10-18

The local-only `verify-account-deletion*.mjs` tests cover server failure boundaries
and React interactions, including synchronous double-submit prevention, retained
login on failure and retry. Run with the existing complete `verify-*.mjs` suite.

An external isolated harness in `ardore-local-test/test-account-deletion.mjs`
ran 22 integration assertions against loopback Supabase/GoTrue/Storage, the real
local Next route and the exact **Ardore Local** Stripe sandbox. Fixtures use
fictional `example.invalid` identities and a payment-free trial. It verified:

- Real Stripe missing-resource failure through the actual Next route, preserving
  Auth/profile/subscriptions and leaving the valid test subscription running.
- Real Stripe DELETE 404 at an explicitly substituted provider transport boundary
  after a genuine ownership read, preserving all local recovery records. This is
  fault injection, not an actual Stripe outage or a production end-to-end test.
- Successful verified test cancellation and Auth/profile/subscription cascades;
  stale login cookies rejected; financial history blocked; creator/tier cascades.
- Storage preflight blocks deletion; direct Auth Admin deletion is also rejected
  by the new trigger and rolls back, preserving profile/account/file. Retry after
  explicitly removing only the local fixture file succeeds.
- Previous local cancellation fixtures were preserved; no refunds or real email
  delivery; no production credentials, data, settings or migrations were used.

A further eight local assertions verified service-uploaded verification files
without a user owner: the coach UUID path blocks preflight and direct Auth
deletion, account/profile/file survive, and removal of only the fictional file
allows a successful retry. These are local-only checks, not production evidence.
The complete suite on the updated main base passed 906 tests (84 directly cover
account deletion). TypeScript and the production build passed; ESLint had no
errors and four pre-existing React Hook Form compatibility warnings.

The initial local security advisors found three pre-existing SECURITY DEFINER view findings:
`public_profiles`, `public_session_reviews`, `public_product_reviews`. The new
guard functions have fixed empty search paths and no anon/authenticated execute
permission. A subsequent pending view migration now fixes the three view
boundaries locally; this is not yet a production change. At that historical
stage concurrency remained blocked; the 2026-10-23 section records its later fix.

## Remaining limitations

Stripe and database deletion are not one distributed transaction. The shared
barrier now serializes the supported account writes and final deletion; it does
not serialize external provider-dashboard edits. Modern checkout persists a
guarded frozen order before creating a Stripe session, so in-flight checkout
records block deletion. Legacy/external provider work and the subscription
cancellation notices sent after coach deletion still require separate recovery/
delivery review; the new coaching-booking outbox is covered by the tests above. Financial-history
and stored-file deletion/anonymization require a reviewed support/retention
process, not bypassing guards. Auth deletion does not universally invalidate
already issued JWTs; sensitive routes must continue using server-validated users.
No live delivery test, manual browser/device QA or production mutation was run.
The local toolchain is Node 24; GitHub CI is the Node 22 compatibility check.

## Verification on 2026-10-23

- 45 real local integration checks pass; both original race assertions remain.
  The harness now starts the writer while deletion is paused, verifies it waits
  on the shared account lock, then releases deletion before awaiting the writer.
  Awaiting a correctly blocked writer first would deadlock the harness itself.
- Writer-first uncommitted order preserves the buyer after commit; delete-first
  service upload/order are rejected without dangling metadata/order references.
  Browser and service Storage writes, deleting-coach orders, subscription inserts,
  duplicate workers, expired leases and stale attempt tokens are covered.
- The actual application orchestration ran against real local GoTrue/Postgres:
  empty-account deletion, retained-history failure with pre-Auth release, explicit
  local Auth-transport fault, retained durable barrier and safe retry all pass.
- 924 offline regressions, TypeScript and production build pass; lint has zero
  errors/four existing warnings. Local security advisors report no findings.
  No Stripe requests/payments, external emails or production service calls were
  made by this suite. Fixtures were removed; prior three Auth users/four fixture
  subscriptions remain intact. No earlier applied migration was edited.
- This local Storage version sanitizes rejected trigger writes as DatabaseError
  HTTP 500. Clients must treat the upload as failed; API error wording is not a
  security guarantee. Tests verify lock arrival, actual object/account state and
  allowed uploads after safe barrier release, not leaked internal SQL error text.

The supported validation-trigger mechanism is documented in Supabase's
[managed-schema restrictions](https://supabase.com/changelog/34270-restricting-access-on-auth-storage-and-realtime-schemas-on-april-21-2025).
File operations remain exclusively through the [Storage API](https://supabase.com/docs/guides/storage/schema/design).
