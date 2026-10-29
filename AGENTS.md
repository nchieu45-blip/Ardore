<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project rules

NEVER insert or modify rows in auth.users via raw SQL — always use the GoTrue Admin API (/auth/v1/admin/users). Raw SQL inserts corrupt GoTrue and break all authentication. This has broken production auth twice.

## Autonomous development and release approval

These instructions apply throughout this repository, including Codex Cloud tasks
started from an iPhone. Preserve the Next.js guidance and Auth safety rule above.
Read any more specific `AGENTS.md` before working in its directory; keep release
and production approval requirements in effect throughout the project.

### Work independently within the requested scope

- Inspect repository status, relevant source, documentation, tests, and applicable
  agent instructions before implementing a task. Use `README.md`, `SETUP.md`, and
  the relevant `docs/` guides to understand existing behavior.
- Independently analyze, implement, test, fix, and review requested features and
  bug fixes. Resolve routine implementation choices without asking for approval
  at every step. Ask only when essential information is missing or an action
  needs approval under the safeguards below.
- Follow the existing architecture and coding conventions: Next.js App Router
  pages and API routes in `src/app`, shared behavior in `src/lib`, reusable UI in
  `src/components`, types in `src/types`, and migrations/tests in `supabase`.
- Preserve existing functionality, authorization boundaries, and project safety
  rules. Avoid unrelated changes, dependency churn, or broad refactoring.
- Never weaken checks, remove assertions, or hide failures to obtain a passing
  result. Fix issues caused by the requested change and rerun affected checks.
  Report unrelated existing failures; do not expand scope to fix them without
  authorization. For instruction-only setup tasks, change no application behavior.

### Standing approval for staged releases — 2026-10-29

The owner has authorized Codex to publish completed, validated changes in the
requested scope without asking for release approval again on every change.
Apply this during an active authorized task; this file does not create an
unattended deployment service or authorize unrelated work.

- Release independently complete application or documentation changes in small
  steps. Keep unfinished work and changes with unresolved safety or operational
  blockers on their feature branches; passing tests do not override blockers.
- Before release, review the complete PR diff and run every relevant check below,
  including required isolated integration tests. One successful test is not
  sufficient. Confirm the exact revision has successful Node-22 CI, main has not
  invalidated the results, and dependencies, rollout and fallback are ready.
- Then commit/push the feature branch, create/update its PR, wait for CI, merge
  through the normal protected PR path, and verify main CI and the automatic
  Hostinger deployment. Confirm the deployed SHA and non-mutating production
  health. No further application-release confirmation is needed when these
  conditions hold. Never bypass branch protection or reviewer requirements.
- This standing approval does not authorize production migrations, production
  data mutations/tests, secrets or infrastructure changes, real payments,
  refunds, payouts, email delivery tests or destructive recovery. Those actions
  still need the separate specific approvals described below. If required for a
  release and not approved, keep that release blocked and explain the one
  concrete missing action.
- Keep production-connected PR previews disabled and the GitHub Supabase
  migration switch absent/false. Never enable blind auto-merge or migration
  automation to implement this policy. In particular, PR #7 remains blocked
  until its documented old-handler retirement/fallback gates and separately
  approved migration prerequisites are met.
- If a deployment fails, report the failure and use only a previously reviewed
  safe fallback within existing approval. Never restore unsafe legacy code or
  roll back production data automatically.

### Branches, commits, and pull requests

- Always work on a separate feature branch, never directly on `main`. Check the
  current branch and working tree first; preserve user changes. Create a named
  branch such as `codex/<task>` before editing. Do not force-push, discard work,
  reset shared history, or delete branches without approval.
- Review the complete diff against the task's base, stage only intended files,
  and commit the completed changes on the feature branch.
- When GitHub access supports it, push the feature branch and prepare a pull
  request targeting `main` with the changes, verification results, limitations,
  and release risks. Check remote CI results when accessible and fix failures
  caused by the change. Report pending or inaccessible CI honestly.
- Keep a reviewable pull request and report the result. Merge only under the
  standing staged-release approval above or a separate explicit release approval.
  Do not enable auto-merge, approve reviews on the owner's behalf, or bypass
  branch protection.

### Verification and self-review

Inspect scripts before running them to identify service access and side effects.
Use installed locked dependencies, or `npm ci` when installation is needed. Run
all relevant available checks before handing work back, including:

```bash
npm run lint
./node_modules/.bin/tsc --noEmit --incremental false
node --test scripts/test-app-url.mjs scripts/verify-*.mjs
npm run build
```

- These commands extend the checks in `.github/workflows/ci.yml`. Run additional
  relevant unit, integration, and UI checks when safely available. There is no
  general `npm test` script currently; inspect `package.json` and CI again if
  commands change. CI and production use Node.js 22; report version differences
  in the execution environment. Run type checks and builds sequentially because
  Next.js builds rewrite the generated `.next/types` files.
- The default `verify-*.mjs` suite uses local fixtures/mocks. In particular,
  `verify-settlement-permissions.mjs` without opt-in flags checks local migration
  metadata only; it does not verify live database permissions. Inspect newly
  added tests before including them in a wildcard run.
- Do not run `scripts/test-synthetic-*.mjs`, production email tests, recovery
  runners, admin/fixture scripts, or `--run-production-synthetic` blindly. Some
  target production and mutate data even when Stripe is in test mode. Production
  mutations require separate explicit approval, including synthetic fixtures.
- Run database SQL behavior/permission tests under `supabase/tests` only against
  a confirmed isolated local/test database with the required fixtures. Never
  substitute production for an unavailable test environment.
- A production build is a local artifact, not sufficient release validation. It may need
  external Google fonts and service configuration. Use only explicitly designated
  local/CI/test configuration; never obtain production secrets or fabricate
  successful service checks to unblock it. If blocked, record the exact reason.
- Automatically fix errors introduced by the task, then rerun the affected
  checks. If fixes affect shared code or configuration, rerun the relevant broader
  suite and build. Do not stop at the first fix without verifying it.
- Review the final diff for correctness, regressions, security risks, access
  control, secret exposure, and unintended modifications. For payment/auth/data
  changes, explicitly inspect authorization, validation, idempotency, and error
  handling. Fix findings within scope and verify again.
- Never claim a test passed unless it actually ran successfully. Distinguish
  mocked tests, static checks, builds, CI, and real service integration tests.
  Clearly report failures, skips, pending checks, and unavailable Supabase,
  Stripe, email, AI, browser, or other external-service tests with their reasons.

### Production and high-risk safeguards

- Production deployment requires the standing staged-release conditions above
  to be met, or separate explicit approval. Task implementation, a passing build
  or an incomplete PR alone does not satisfy those conditions.
- Hostinger currently auto-deploys the connected `main` branch, as documented in
  `README.md` and `SETUP.md`. Treat any merge/push to `main` as a production
  deployment trigger. Before merging, verify that the standing approval covers
  the complete change and its resulting release, or obtain separate approval.
  Never push to `main` directly.
- Never modify production secrets, production databases, or run production
  migrations without separate explicit approval for the particular operation.
  Release approval does not implicitly authorize these actions. Preparing
  migration files on a feature branch is permitted when part of the task.
- `.github/workflows/supabase-migrations.yml` can apply production migrations
  after successful `main` CI when `SUPABASE_MIGRATIONS_ENABLED` is true, or through
  manual dispatch. Its `production` environment declaration alone does not prove
  that approval is enforced. Before an approved merge, check whether it could
  trigger production migrations; require separate migration approval or a
  verified approval gate before proceeding. Never dispatch it without approval.
- Ask for approval before destructive or high-risk actions, including production
  writes, payments/refunds/payouts, real email delivery, data deletion, permission
  changes, and irreversible infrastructure operations. Prepare the concrete
  proposal, impact, and relevant verification first, then request approval.
- Do not change repository settings, branch protection, deployment gates,
  environment approvals, or production service configuration without approval.
  Do not bypass existing safeguards or expose credentials in logs or commits.

### Final handoff

Report files changed, checks performed and results, issues found and fixed,
remaining failures, tests that could not run and why, branch name, commit, and
pull request link if created. Identify any approval-dependent release or migration
steps and confirm that no unapproved merge or production action occurred. Make
the report concise and readable on a phone; do not require the owner to inspect
earlier chat messages to understand readiness.

These instructions guide agents; they do not enforce GitHub or Hostinger settings.
When auditing protection, report what can actually be verified. Recommend a rule
for `main` requiring pull requests and passing `quality-checks` CI, restricting
direct pushes and bypasses, and blocking force-pushes/deletion. Use an independent
reviewer approval when available; a sole owner cannot approve their own PR.
Production deployment must respect the staged-release conditions above;
production migrations retain their separate approval requirement. Propose any
settings changes for review rather than changing them silently.
