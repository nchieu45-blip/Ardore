# Account deletion safety

## Current release preparation — 2026-10-29

PR #7 incorporates main `ceea6d43f5aa2a85e9a5fcfeb2f3a201184e26a1`.
The three original pending repairs and all 50 applied SQL files are unchanged.
Two new, separately approved migrations install a CLOSED database release gate
first and activate the new deletion protocol last. The application checks the
service-only readiness RPC before any barrier, provider call or deletion.
All current service clients carry a v2 marker; only the deletion client also
carries the deletion-protocol marker. These are version markers, not credentials.

The authoritative execution order, SQL hashes, test command, approval boundaries,
short maintenance impact and safe fallback are in
[the Hostinger rollout plan](account-deletion-hostinger-rollout.md).
It replaces older plans dependent on Hostinger providing an all-origin drain
or two deployments proving that old work disappeared.

**No production GO yet.** Production SQL and provider-key changes still require
specific approval. Database guard triggers block legacy REST teardowns and
unarmed Auth deletion. Legacy service reads are fenced, including restarted
old software with new keys. Retiring every old production Stripe/Resend key
also fences old processes that already cached provider references. Work already
accepted externally must be reconciled; it is not undone by a database pause.
New durable mail claims pause during this separately approved handover; prior
claims may complete/fail. Unknown cross-key mail delivery status must not be
blindly replayed. Final activation needs a separate approval after reconciliation.

The opt-in `test-isolated-account-deletion-release.mjs` runner rehearses this
order in its OWN disposable local Supabase schema/services with fictional users,
actual historical handlers and the complete 68-case group/Stripe-fault/mail/
Storage/order/concurrency suite. Provider calls and credential retirement are
simulated. No production data/keys used. Exact final test counts and Node-22-CI
belong to the final PR revision, not the historical evidence below.

Final local checks for this preparation: 1,073 offline tests, 33 release-gate
checks and all 68 Supabase integration checks passed. The runner removed its own
containers/database/temporary local credentials. TypeScript and the Webpack
production build passed (75 static pages); ESLint has zero errors and four
pre-existing React Hook Form warnings. Builds use a separate copy without env
files and explicit CI placeholders. Node-22 CI is checked after feature push.

Fallback retains all applied guards/history, old keys stay revoked, deletion is
paused through a separately approved forward control update before code fallback.
Never disable triggers/RLS, remove uncertain Auth-started barriers, run raw SQL
writes on `auth.users`, replay applied SQL or restore over newer customer data.
Previously prepared unmarked hold/recovery SHAs are not current normal-service
fallback candidates. Keep previews OFF and the GitHub Supabase migration switch
absent/false. Do not dispatch its workflow.

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
