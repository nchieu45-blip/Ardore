# Prepared account-deletion recovery release

Local preparation, 2026-10-28. This revision is not deployed or pushed.
The earlier `878c315` revision was published for historical CI validation.

This branch starts at PR #7 `eccb417`, restores the tested hold release and then
incorporates current main `c3fed1e` (group reminders, cancellation/refund emails
and group rescheduling). Against that main, only
the deletion route, proxy, hold helper and hold regression test differ in runtime/scripts. It is an application fallback
with deletion paused, rather than a revert to an active legacy deletion handler.
All 50 applied main migration files match `c3fed1e`; the three pending deletion/view
migrations remain identical to `eccb417`. No database rollback or migration execution is part
of this artifact. The main/PR #7 worktrees are not changed by this preparation.

Local verification: 961 offline regressions, ESLint (four existing warnings),
non-emitting TypeScript and the Webpack production build passed. A loopback-only
production server without service credentials passed 137 HTTP hold checks and
three redirect checks. Runtime was Node 24; Node-22 CI is still required before
release. Responses are 503, private/no-store, with marker `paused-v1`.
The current evidence and scope are in
[`account-deletion-hold-validation.md`](account-deletion-hold-validation.md).

Earlier candidates `38f6e03` and `878c315` are superseded for current use: they do
not contain all changes through PR #12. Before future use, freeze unrelated main changes and review this exact snapshot
against the then-current release. Obtain explicit release approval, run Node-22
CI without creating a production-connected preview, and publish only via an
approved recovery PR into main. Never force-reset main, restore old hosting
backups over the app, remove migration history or replay applied SQL. If main
has gained other application changes, prepare and test a new recovery snapshot.

The prior PR #7 behavior/tests are preserved in Git history; this fallback
deliberately runs the older application's tests plus hard-hold coverage. Its
successful build does not prove retirement of old Hostinger workers/requests.
