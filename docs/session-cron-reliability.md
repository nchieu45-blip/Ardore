# Session reminder and review-prompt reliability

This change is prepared on a feature branch only. Local tests use fixtures and
mock providers; they do not send real email, invoke production cron endpoints,
apply a production migration, or change the GitHub scheduler.

## Schedule and independent failures

`.github/workflows/ardore-cron.yml` keeps the existing recovery runner and its
ten-minute schedule, alongside daily cleanup:

| UTC schedule | Endpoints |
| --- | --- |
| `*/10 * * * *` | Coaching-payment recovery, session reminders, session review prompts |
| `0 9 * * *` | Verification-document cleanup |

08:00 UTC is already covered by `*/10`; its redundant daily session sweep has
been removed to avoid routine overlapping claims and misleading busy/503 alerts.

Manual `all` includes all four endpoints; `coaching-payments` retains its existing
recovery-only scope. A failed recovery, checkout, reminder, or review-prompt step
does not skip another eligible endpoint. A failed step still fails the whole job;
there is no `continue-on-error`. Cancellation and invalid configuration stop
authenticated requests. Cleanup's daily schedule and retention rules are unchanged;
read, storage, or metadata failures now fail the request, and metadata clearing
compares the original document path so a replacement is not silently cleared.

GitHub's schedule is **best effort**, not a ten-minute delivery SLA. Previous
observed gaps were multi-hour. More frequent polling and catch-up reduce missed
work, but do not make GitHub a guaranteed-time scheduler. An outage exceeding the
application's catch-up window needs operator investigation; do not blindly resend
historical mail. A dedicated scheduler with monitored delivery guarantees remains
a separate operational decision if stricter timing is required.

The recovery runner retains its own bounded, idempotent retry policy and public
network diagnostics. Session/cleanup calls are independent single attempts, with
10-second connection and 60-second overall timeouts; the job has a ten-minute
budget so recovery failures cannot consume the entire old five-minute budget.
Every session/cleanup call explicitly rejects non-2xx responses, including
redirects. It does not follow redirects, disable TLS verification, or automatically
retry a request in the runner. Later scheduled application retries use the durable
delivery state instead.

## Credentials and logging

- Repository variable `ARDORE_BASE_URL` must be
  `https://www.ardore-health.com` (one trailing slash is accepted).
- Repository secret `CRON_SECRET` must match Hostinger's existing credential.
  Missing, oversized, and CR/LF-containing credentials fail configuration validation.
- No new credentials or dependencies are required. Credentials are passed to curl
  through stdin, not command arguments or a file, and removed from curl's environment.
- Session/cleanup response bodies are discarded. Workflow errors include only a
  fixed description and HTTP status, never request headers, credentials, or bodies.
- Keep monitoring delivery failures and GitHub failures; a successful request is
  not proof that a recipient opened or received a message in their inbox.

## Durable application delivery

Reminders consider confirmed, payment-eligible sessions starting strictly after
now and within the next 24 hours. A late scheduled run catches up only while the
session is still in the future; it never sends a reminder for an already started
session. Copy uses an actual date/time rather than assuming the session is tomorrow.
Review prompts consider confirmed/completed, payment-eligible sessions that ended
within the past seven days and have not been reviewed. The application supports
durations up to 480 minutes and over-fetches seven days plus eight hours before
filtering the actual session end. Existing payment eligibility is preserved.

The accompanying migration adds the private
`public.session_notification_deliveries` ledger and service-role-only claim,
completion, and failure functions. Each delivery is identified by booking,
recipient, notification type, channel, and scheduled occurrence. Email and in-app
delivery are tracked separately; one channel must not hide the other's failure.
Atomic claims and five-minute leases protect overlapping or restarted workers.

Pending email payloads are retained for consistent retries with the same provider
idempotency key. They contain personal data: do not dump them into workflow logs,
browser responses, support screenshots, or public diagnostics. Supabase RLS and
grants keep this ledger unavailable to browser roles.

Successful delivery clears its stored payload while retaining the delivery key
and completion state. Held/ambiguous payloads remain private for reconciliation.

Old in-app notifications cannot prove whether old email was sent. The migration
does not backfill or resend that uncertain legacy work. Legacy deliveries are
skipped conservatively rather than risking duplicate mail. A service-only function
stores the actual migration-application timestamp: reviews for sessions ending
before that instant are skipped, as are pre-existing bookings starting within
25 hours of that instant. This also covers old email-only recipients with no
in-app marker, at the cost of possibly missing first-day reminders that were
never sent. Newly created bookings and later occurrences remain eligible.
An email attempt older
than the provider-idempotency safety horizon (23 hours) is held for operator/provider
reconciliation instead of being resent automatically. Neither missing legacy email
nor ambiguous old provider outcomes can be repaired automatically with a delivery
guarantee; any real resend requires a separate explicit approval.

[Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
The 23-hour cutoff is conservative; this is not an exactly-once inbox guarantee.
At larger booking volumes, scanning the seven-day population may exceed the
request budget. Monitor runtime/backlog and add bounded backlog processing before
scaling beyond the initial launch; no throughput SLA has been load-tested here.

This work does not enable Daily or create/update video rooms. Existing session
pages and external meeting information remain the way participants access their
session; do not promise built-in video conferencing.

## Validation and release order

1. Review the feature-branch application, workflow, and new migration together.
   Run lint, TypeScript, fixture regression tests, and a production build. Validate
   SQL behavior/permissions only on an explicitly isolated local/test database;
   record any unavailable database test honestly.
2. Confirm `20261015132045_session_notification_deliveries.sql` is the only pending
   intended migration, and verify the
   GitHub Supabase migration workflow remains disabled. Do not dispatch that
   workflow or enable `SUPABASE_MIGRATIONS_ENABLED`.
3. Obtain **separate explicit approval for this exact production migration**.
   Apply only the reviewed additive migration through the connected Supabase
   plugin and verify the resulting table, functions, browser-role denials, and
   migration-history entry. Never replay old migrations or reset/seed production.
4. Only after migration verification, obtain explicit approval covering both the
   merge and resulting Hostinger production release. Merge the reviewed PR into
   `main`; Hostinger auto-deploys it. Do not push directly to `main`.
5. Wait for GitHub CI and Hostinger to succeed; verify the deployed revision and
   endpoint availability without running delivery jobs. Observe the first normal
   scheduled runs and aggregate failure counts. A manual cron invocation can send
   real email or delete verification documents and needs separate approval.
6. If errors occur, investigate redacted aggregate results and provider records
   before any retry/resend. Do not remove the additive ledger or reverse-delete
   notifications. A rollback must use compatible code and an explicitly approved
   release plan; an old non-idempotent handler must not be paired blindly with the
   new frequent schedule.

Coordinate migration and release in a short, approved rollout window after any
old session cron request has finished. The old handler has no email ledger;
overlapping old/new handlers or delaying the release long after the migration
cannot provide a strict historical deduplication guarantee.

Local SQL verification used PostgreSQL 17.5 in disposable PGlite/WASM. Only the
in-memory test copy replaces the Auth recipient FK with a synthetic fixture-user
table: no Auth rows were inserted or changed. Syntax, state transitions, grants,
and anonymous/authenticated denial probes passed. Full GoTrue/Auth FK integration
and real multi-connection lock contention remain untested. The tracked SQL suite
contains explicit isolation guards and must never run against production.

No production migration, real email, workflow dispatch, merge, deployment, or
infrastructure change is authorized by preparing or testing these files.
