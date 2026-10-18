# Account deletion safety

## Release gate

This change is not deployed. Before an explicitly approved release, separately
approve and apply `20261018120029_guard_account_storage_deletion.sql` through the
normal reviewed Supabase migration process. Verify the service-only preflight and
private profile-delete trigger before releasing application code. Do not enable
the GitHub migration workflow. Without the preflight RPC, deletion fails closed.
The migration changes functions/permissions and adds a trigger; it does not erase
or rewrite existing customer rows or files. Never edit previously applied SQL.

## Behavior

- The authenticated caller can delete only their own account, after an exact
  trusted Origin, JSON request and `LÖSCHEN` confirmation. No browser-supplied
  user, creator or provider IDs are accepted. Responses are private/no-store.
- Any booking, purchase, class booking, payment order/settlement, coaching payment
  attempt or discount redemption involving the account requires support review.
  This intentionally conservative policy also covers completed/failed history.
- Stored files require support review. A service-only RPC checks both current
  `owner_id`, legacy `owner` and service-uploaded verification files under the
  existing coach UUID prefix; a private trigger checks again during the Auth
  deletion cascade. No automatic bucket/file cleanup or ownership reassignment.
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

Local security advisors found three pre-existing SECURITY DEFINER view findings:
`public_profiles`, `public_session_reviews`, `public_product_reviews`. The new
guard functions have fixed empty search paths and no anon/authenticated execute
permission. The existing view findings need separate review; this work does not
claim that the database security audit is fully clean.

## Remaining limitations

Stripe and database deletion are not one distributed transaction. Snapshot
rechecks are not a global lock against concurrent checkouts, uploads or provider
dashboard edits. A fully serialized deletion/checkout lifecycle and durable email
outbox are separate work; do not claim those guarantees here. Financial-history
and stored-file deletion/anonymization require a reviewed support/retention
process, not bypassing guards. Auth deletion does not universally invalidate
already issued JWTs; sensitive routes must continue using server-validated users.
No live delivery test, manual browser/device QA or production mutation was run.
The local toolchain is Node 24; GitHub CI is the Node 22 compatibility check.
