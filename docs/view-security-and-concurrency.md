# View boundaries and deletion concurrency — release blocked

Prepared on `codex/safe-account-deletion`, extending draft PR #7. Nothing in
this work authorizes production migration, merge or deployment.

## Prepared changes

`20261019131618_scope_public_view_projections.sql` preserves the three public
view names, columns and types. The views are explicitly `security_invoker=true`.
Their private, fixed-search-path, argument-free projection functions are the
deliberate privileged boundary; this is not a claim that underlying own-row RLS
alone can implement a public review projection.

- `public_profiles`: own identity, current correctly bound live/free subscribers
  of the authenticated coach, and existing conversation peers only. Historical
  conversation identities remain readable after entitlement ends. Test-mode,
  expired and wrong-coach tier rows do not create a new visibility relationship.
- `public_product_reviews`: only published products of published coaches, with
  an existing paid live purchase. `EXISTS` prevents purchase join multiplication.
  Review ownership, display name/avatar and public rating/content are preserved;
  no buyer UUID, email, booking ID or billing record is projected.
- `public_session_reviews`: only published coaches; the existing public review
  fields remain unchanged. No new refund/moderation semantics are invented.
- No browser read/write grants on the private base tables are broadened.
  Profile helper execution is denied to anon; public review helpers intentionally
  allow anon to receive only the same bounded public projection.

Both **pending, unreleased** migrations use transaction-local `lock_timeout=5s`
and `statement_timeout=30s`. The earlier storage migration has not been applied
to production; only this unreleased file was adjusted. Applied historical
migrations were not edited. Neither migration rewrites customer rows.

## Local verification

Use the existing dedicated `colima-ardore-test` / `supabase_db_ardore-local-test`
container, loopback API 127.0.0.1:54331 and isolated app configuration. Never
substitute production or run SQL auth-user fixture inserts.

```sh
node scripts/test-local-view-security.mjs --local \
  --fixture-env /absolute/path/to/ardore-local-test/app/.env.local \
  --parallel --report /absolute/path/outside/repository/security-report.json
```

The runner refuses other API/app URLs and a different container/network. All Auth
fixtures use GoTrue Admin API. It creates only fictional local identities,
reviews, subscriptions, an uploaded fixture and a zero-value local frozen order.
No Stripe API, payment, real email, cloud project or production credentials are
used. Temporary local synchronization hooks and generated fixtures are removed
after testing; earlier local fixtures remain intact. The report has mode 0600.
Do not include this opted-in destructive fixture runner in ordinary CI.

Results: **25 checks, 23 passed, 2 failed**. Passing checks cover own/peer and
subscriber access, unrelated/anonymous denial, missing identity, expired/test/
wrong-tier exclusions, private product/coach exclusion, paid/live review checks,
review ownership, column minimization, actual 55P03 DDL lock-timeout rollback,
actual 57014 cancellation of a statement after the configured 30 seconds,
already-committed upload rejection and duplicate deletion. Local security
advisors report no remaining findings after the view migration. This is local
evidence only, not a production-wide security certification.

## Two confirmed release blockers — not fixed or hidden

1. **Upload after the guard:** a real local Auth Admin delete is paused after
   the real profile-delete guard has evaluated but before commit. A service-role
   verification upload then commits. Releasing deletion removes Auth/profile/
   coach but leaves the file behind. The guard cannot serialize a writer that
   does not participate in a common lock/deletion state.
2. **Checkout order after preflight:** at the same final boundary a local
   zero-value `payment_orders` row commits for the deleting buyer. Deletion can
   finish and leave an order with a nonexistent buyer because that reference has
   no FK. This is a database concurrency reproduction, not a real Stripe Checkout
   or provider integration test.

The runner deliberately returns nonzero for these failed safety assertions. A
green offline/CI suite does **not** override these failures. Both failures also
occur without changing the prepared view migration; they are pre-existing gaps
in the account-deletion lifecycle, not repaired by DDL timeouts or view RLS.

## Required next implementation before release

Design a common deletion state/write barrier that all relevant producers honor:
browser Storage uploads, server verification uploads, checkout order creation,
booking/subscription creation and relevant asynchronous fulfillment. Check
in-flight provider work and historical finance retention, and give interrupted
requests an explicit safe retry/support result. A lock taken only by deletion or
one more preflight SELECT is insufficient. Avoid unreviewed changes to managed
Storage/Auth internals or replacing stable financial records with cascades.

Offline regression checks: **912 passed**. TypeScript and production build passed;
ESLint has no errors and four existing React Hook Form compatibility warnings.
These checks do not turn the two real local concurrency failures into successes.

That is a separate lifecycle change with its own new migration and application
integration, not an extra permission grant in the three views. Keep PR #7 draft.
After that change, rerun the same failing assertions without relaxing them,
broader local integration tests, lint/types/build and CI. Only then request
separate production migration approval, verify actual production permissions
read-only after the approved migration, and obtain explicit release approval.
