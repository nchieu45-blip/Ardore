# Account deletion safety

## Release gate

**Hostinger-Ausführungsplan, 2026-10-28:** Der konkrete, gestufte Ablauf und die
verifizierte Produktionsverbindung des PR-Previews stehen in
[`account-deletion-hostinger-rollout.md`](account-deletion-hostinger-rollout.md).
Er verwendet nur nachgewiesene Bedienelemente, benennt einen lokal getesteten
Rückfall und hält den fehlenden Nachweis der Stilllegung alter Requests als
Stopppunkt ausdrücklich offen. Keine Produktionsfreigabe ist daraus abzuleiten.

**Local repair update — 2026-10-27:** The branch incorporates current main
`9ccb3bc`, including its group-booking implementation and restricted-key mode
handling. Retention checks now cover every group reservation (paid or free,
including subscription benefits) and host-initialized occurrences without
participants. The pending write-barrier migration also guards both group tables
and rechecks them at the final Auth/profile cascade boundary. This is an amendment
to the still-unapplied production migration, not an edit to applied group history.
Existing payment/group migrations on main remain byte-for-byte unchanged.

Current local evidence: 1,024 offline regressions and 57 real local Supabase
checks pass. The latter cover paid/free group history, both race directions,
deleting-host admission, uploads/orders, worker fencing, simulated Stripe read/
cancel/ambiguous-timeout failures with real local account preservation, and four
parallel app retries with one successful deletion and no repeated cancellation.
All exact temporary fixtures were removed; the three original fictional Auth
users were preserved. Stripe faults use an in-memory provider; no Stripe API,
payment, email or production operation was executed. Lint (four existing
warnings), non-emitting TypeScript and the test-config Webpack build pass on
local Node 24. Subsequently, GitHub CI passed on Node 22.23.4 for `eccb417`:
https://github.com/nchieu45-blip/Ardore/actions/runs/40545067492 (1,019 CI tests).

The checkout's existing environment file was not used or changed: build sources
were copied without environment files into a separate local build folder and
used only the established loopback Supabase/test configuration. The owner later
approved the feature-branch push and Hostinger PR preview, and `eccb417` was
pushed. PR #7 remains draft and unmerged; production main is still `9ccb3bc`.
The production transition/fallback gates below remain open; local correctness
does not prove that old Hostinger handlers have retired.

**REVIEW REQUIRED:** The two previously reproduced parallel failures are fixed
locally by `20261023090520_account_deletion_write_barrier.sql`. The expanded
45-check local suite passes, including the original service-role upload and
buyer-less checkout-order races. This is not production migration/release
approval. See `view-security-and-concurrency.md` for historical and current evidence.

This change is not deployed to production. **Do not apply these migrations while any old
deletion handler can still receive or finish requests.** The old `main` handler
deletes application rows in separate requests before deleting Auth; a later
trigger rejection cannot undo those earlier deletes. The mandatory sequence is
**server-side hold -> drain old handlers -> deploy safe code -> migrate -> verify
-> explicitly reopen**. See the runbook below; never substitute a migrations-first
rollout. The new handler fails closed at `begin_account_deletion` when its RPC is
missing, before retention snapshots, Stripe calls or deletion. That is an
additional safeguard, not a substitute for draining old processes.

These are future approval-dependent steps, not actions performed by this PR.
Hostinger auto-deploys `main`, so merge approval must explicitly include the code
deployment. Production migration approval is separate. Keep the GitHub migration
job non-executable and never dispatch it for this rollout. The three pending
migrations are additive, with bounded lock/statement waits; they do not erase or
rewrite customer rows/files. Never edit previously applied migrations.

## Approved-release runbook (not executed)

1. **Prepare and obtain approvals.** Record the reviewed application SHA, the
   three migration filenames/checksums, current migration history, and a verified
   backup/recovery point and recovery owner. Confirm the pending set is exactly
   the reviewed set; stop on schema/history drift. Check current CI and isolated
   test evidence. Obtain explicit approval for the temporary deletion hold,
   code merge/Hostinger deployment, the exact migrations, and eventual reopening.
   Do not infer any of these approvals from a green CI or this document.
   Confirm the GitHub migration job is non-executable before merge: keep
   `SUPABASE_MIGRATIONS_ENABLED` absent/false and do not manually dispatch it.
   A `production` environment name alone is not an approval gate.
2. **Block admission before deployment or migration.** A hosting/operator-level
   rule must reject `POST /api/account/delete` before application/Auth execution
   for every externally reachable origin, alias, direct hosting URL and old
   deployment that can access the same production services. Cover equivalent
   route forms/routing normalization; a hidden button, DNS change, one-domain
   block, or browser-only flag is not sufficient. Use a stable maintenance
   response distinguishable from application 401/503 responses. Verify rule
   scope/configuration and credential-free probes against each inventoried
   origin. Never probe with a real user's cookies/token: the old handler ignores
   confirmation bodies and could delete that account if the hold is missing.
   **No such Hostinger rule or control is assumed to exist.** If the operator
   cannot demonstrate it, stop; separately prepare/review an enforceable hold
   mechanism and obtain approval. Do not continue with migrations first.
3. **Drain and retire the old path.** Keep admission blocked. Obtain hosting
   evidence that pre-hold deletion requests have ended and every old worker,
   route target and alternative deployment is stopped or remains inaccessible.
   A ready homepage/new build is not drain evidence. Do not guess a sleep period,
   kill an in-flight destructive request, or cancel requests to force a pass:
   earlier separate writes may have committed. If drain cannot be proved, or an
   interrupted/failed old deletion is discovered, stop for incident review and
   read-only reconciliation before any migration or reopening.
4. **Deploy the safe application first, while held.** After the separate release
   approval, merge/deploy the reviewed SHA through the established main/Hostinger
   path. Verify deployment SHA/status and that only the new handler (or the
   independent hold) is reachable on every production-connected origin. Old
   processes must stay retired. Missing lifecycle RPCs cause the new handler to
   return 503 without Stripe or deletion; this boundary is covered by offline
   tests, not by a destructive production smoke test. If deployment or coverage
   verification fails, keep the hold and stop; do not apply migrations.
5. **Apply only the separately approved pending SQL, in order**, through the
   connected Supabase migration plugin, preserving exact reviewed contents:
   `20261018120029_guard_account_storage_deletion.sql`, then
   `20261019131618_scope_public_view_projections.sql`, then
   `20261023090520_account_deletion_write_barrier.sql`. Check history after each
   successful transaction and stop on the first failure. Never replay already
   applied history, reset/seed, or use GitHub/CLI db push as a shortcut. If a
   timeout occurs, inspect history/catalog state read-only before deciding which
   migration remains pending; never assume all three rolled back together.
6. **Verify without changing customer data.** Keep the hold. Read migration
   history, view definitions/contracts, service-only RPC ACLs, private table RLS,
   the profile-delete/record-write/Storage-write triggers, advisor results and
   schema-cache visibility. Compare with the reviewed SQL. Check deployment
   health and non-mutating public pages. Use isolated local/Sandbox fixtures for
   deletion, upload, checkout and failure/retry tests; do not call production
   deletion/booking/payment endpoints to test success. Never obtain/print keys
   or remove barriers to make verification pass.
7. **Reopen deliberately.** Only after all evidence and the explicit reopening
   approval, remove the admission hold. Reconfirm that no old revision/alias can
   resume traffic and that migration automation remains non-executable. Monitor
   sanitized error rates and support reports; on unexpected behavior, reapply
   the hold first and follow the fallback below. Do not test with customer writes.

### Fallback and rollback (at every stage)

- **Safe default: hold stays closed.** A failed build/deployment/migration/check
  never authorizes removing the hold or reactivating the old deletion handler.
  Leave the last safe handler or the independent maintenance response in place.
  Other application traffic may continue only if independently healthy.
- **Before or during safe-code deployment:** if Hostinger automatically restores
  a previous release, the independent hold must still cover every origin. Treat
  any restored old worker as unsafe, drain it again, and stop migration work.
  A full rollback to pre-PR code is forbidden unless a separately reviewed,
  demonstrably enforced deletion hold remains in front of that code.
- **After any migration:** keep successfully applied migrations and their history.
  Each file has its own transaction; a failed later file does not undo earlier
  files. Verify exact state read-only, then prepare a reviewed forward fix or
  apply only a still-pending, separately approved file. Do not drop protections,
  disable triggers/RLS, restore broad view access, erase tombstones, or edit
  applied migration history. Reverting a Git commit is not a database rollback.
- **Ambiguous deletion/provider work:** preserve barriers, account/recovery
  records and financial history. A five-minute worker lease is not permission to
  reopen writes; do not clear an Auth-started barrier manually. Reconcile through
  the reviewed support/retry process. No automatic refund or reversal of Stripe
  cancellations. Database recovery/restoring a backup requires a separately
  approved incident plan, not a reset or a routine rollout rollback.
- **Resumption:** requires corrected code/SQL reviewed and tested, fresh evidence
  of old-worker retirement and remaining migration state, and explicit approval
  for each remaining production action and reopening. Until then, stay held.

### Plan verification — 2026-10-25

This runbook replaces the unsafe migrations-before-code instructions. Checkpoints
2–4 must be evidenced before checkpoint 5; failure at any checkpoint preserves
the hold and the prohibition on the old handler. The historical 45-check local
suite and prior build evidence below remain dated evidence, not a rehearsal of
Hostinger operations. The hosting hold capability, drain evidence and backup/
recovery point must still be established during a separately approved release.
No hold, deployment, migration or production test was executed to write this plan.

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
records block deletion. Legacy/external provider work and a durable email outbox
still require separate reconciliation/retention review. Financial-history
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
