# Group coaching reminder emails

The existing authenticated `/api/cron/session-reminders` job now runs the 1:1
and group workers independently. A failure in either worker still returns 503
and does not suppress the other worker. The reminder job runs independently of payment recovery, review prompts and
cleanup. GitHub schedules it at minutes 00, 10, 20, 30, 40, 50 and again at
04, 14, 24, 34, 44, 54. The second schedule only runs reminders. Each run
retries transport failures, HTTP 429 and 5xx up to twice. Other non-2xx
responses fail immediately. Each attempt uses the same protected endpoint
and the database journals handle overlapping calls.

GitHub can still delay or drop scheduled runs. In Actions, check the
`session-reminders` job for the last successful run. Treat a gap over 20
minutes as a scheduling incident and inspect the recent job history before
using an authorized manual recovery. The job's success indicates a successful
HTTP response. Provider acceptance and inbox delivery require separate evidence.
A scheduler outside GitHub is needed to cover an outage of GitHub scheduling.

Group reminders cover confirmed, eligible per-occurrence registrations starting
strictly after now and within the next 24 hours. Each participant gets one email;
the coach gets one email per occurrence when at least one eligible participant
remains, regardless of roster size. A later occurrence of a recurring course has
its own delivery identity. Later bookings for the same occurrence do not resend
the coach's already delivered reminder.

Both the reservation and attendance record must agree on identity, occurrence,
confirmation and absence of refunds. Paid attendance requires LIVE payment;
TEST, disputed, partially refunded, cancelled, pending and legacy registrations
are excluded. Free or subscription-included registrations remain supported.
Disabling sales or unpublishing a profile does not itself cancel an already
confirmed registration; eligibility follows the actual frozen booking agreement.

The existing `email_session_reminder` preference applies to both roles. The
worker checks eligibility before constructing an email, when claiming it, and
again immediately before sending. Cancellation racing the external provider
cannot be made transactional; the email never grants attendance or bypasses the
protected group-session page. No room URL, video token or roster is emailed.
Dates use Europe/Berlin and an absolute date/time, so delayed retries remain true.
HTML escapes names and titles; text preserves their literal values.

## Durable delivery and retries

Migration `20261027225809_group_session_reminders.sql` adds a private ledger,
service-only security-invoker candidate view and service-only eligibility,
claim, completion and failure functions. Browser roles have no table/view or
function access. There is no SECURITY DEFINER bypass or new public data surface.

A unique `(class, occurrence, recipient)` key deduplicates both job reruns and
coach entries across multiple participants. Atomic row locks and five-minute
leases serialize workers. Failed attempts retain their frozen payload and
`group-reminder/<delivery-id>` provider idempotency key. A provider success
followed by a failed database completion can safely retry the same request within
Resend's 24-hour retention. Ambiguous attempts older than 23 hours are held for
operator reconciliation instead of being resent. Held/busy/read/send/completion
failures remain visible as non-successful cron results. Successful completion
clears the private payload while retaining delivery identity and status.

Pending payloads contain personal data; do not dump the ledger or send payloads
to public logs. An operator must review expired/held/past-occurrence attempts;
there is no blind historical resend or exactly-once inbox delivery guarantee.
Large backlogs may exceed the existing request budget; monitor runtime and
failures before scaling. Concurrent sends may hit provider rate limits; failed
attempts are durable and retry on a later scheduled run.

## Verification and release

- `node --test scripts/verify-group-session-reminders.mjs` tests the real worker,
  templates and combined route with synthetic service boundaries and no network.
- `node scripts/test-isolated-group-reminders.mjs --run-isolated` creates and drops
  one new database in `colima-ardore-test`. It checks eligibility, permissions,
  recurrence identity, stale/expired leases, held attempts, frozen retries and
  two-connection contention. Only this SQL fixture substitutes the Auth FK with
  a synthetic fixture-user table; it never creates or modifies `auth.users`.
- A separate local GoTrue/PostgreSQL integration and actual Resend test-sink
  delivery exercise the unmodified migration/Auth FK, authenticated cron route,
  participant/coach delivery and recovery after provider acceptance with one
  explicitly injected completion failure. No production fixture or job is used.

Before release, separately approve and apply the additive migration, verify
service-only grants and browser denials, then approve merging/deploying the PR.
Do not enable the production migration workflow, dispatch a production cron, or
merge merely because these local tests pass. Deploying code without its required
migration intentionally fails the group worker visibly; it must not be treated
as a successful empty run. This work does not alter the 1:1 ledger or reminders,
charge customers, change coach payouts or provision video rooms.

### Local verification, 27 October 2026

All 928 repository regression tests, TypeScript and the production build passed.
Lint had no errors and four existing React Hook Form warnings. Local Node was
24.15.0; GitHub CI uses Node 22. The build used CI placeholder configuration,
not production credentials.

The disposable PostgreSQL test passed including two-connection lock contention.
The separate real GoTrue integration sent three unique Resend messages for two
participants and one coach; all three showed `Delivered` at official test sinks.
An explicitly interrupted completion produced four provider requests but only
three message IDs: retry reused the frozen payload/key and original provider ID.
Two additional simultaneous job runs sent nothing. The rendered participant and
coach emails fit 1280px and 390px viewports without horizontal overflow. Real
inbox placement and production scheduler delivery were not tested by these sinks.

### Approved production migration

The owner explicitly approved the production migration, PR #10 merge after CI,
and deployment. Supabase applied the exact reviewed DDL successfully and assigned
version `20261027225809`; the source filename is aligned with that authoritative
history entry. The DDL contents are unchanged. Production checks verified RLS,
the security-invoker view, browser-role denials and service-only function grants.
At application time there were no group occurrences, eligible recipients or
delivery rows. No production cron was manually invoked.

### Independent Supabase scheduler

The second scheduler uses a dedicated credential accepted solely by
`/api/cron/session-reminders`. Its calls execute the 1:1 and group reminder
workers. The existing GitHub credential also runs the coaching lifecycle worker
through that endpoint.

Store the dedicated credential in Supabase Vault as
`ardore_reminder_scheduler`, deploy the matching code, and apply
`ops/install-reminder-cron.sql` in the authorized project. The job fires every
five minutes at minutes 02, 07, ..., 57 UTC. Its stored command references the
Vault entry by name, and overlapping GitHub calls use the same delivery journals.
The bearer credential must stay out of the repository, terminal output, and
command arguments.

Check both `cron.job_run_details` and pg_net HTTP responses after installation.
A successful cron execution means the HTTP request was enqueued. An HTTP 2xx
response separately confirms the workers finished without reported errors.
Removal is `select cron.unschedule('ardore-session-reminders');`.
