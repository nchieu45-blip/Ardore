# Local deletion hold and recovery validation

Verified on 2026-10-28 against main
`c3fed1ebbd799f9aa3723004d071e8224c97cdf6` (including PRs #11 and #12).
This update is local only. No push, GitHub workflow, main merge, deployment,
production request or database migration was performed for this validation.

## Candidates and preserved scope

- `codex/account-deletion-hostinger-baseline` is the independent initial hold.
  Its runtime/test delta from main remains the deletion route, early proxy stop,
  shared hold helper and the corresponding regression test. It has no PR-#7
  repair ancestry or repair migration files.
- `codex/account-deletion-recovery` is a later application fallback. Its runtime,
  scripts, dependencies and Next configuration are byte-identical to the hold.
  It retains PR-#7 history and the three repair SQL files. Never merge this
  recovery branch as the initial hold: that would also integrate repair history.
- Both contain all 50 main migration files byte-for-byte, including the recent
  cancellation/refund emails and group-rescheduling implementation. No applied
  migration was edited, replayed or executed.

## Checks actually run for each candidate

| Check | Result |
| --- | --- |
| `node --test scripts/test-app-url.mjs scripts/verify-*.mjs` | 961 passed, zero failures/skips |
| ESLint | Passed, four existing React Hook Form compatibility warnings |
| TypeScript `--noEmit --incremental false` | Passed |
| Production build (`next build --webpack`) | Passed; 75 static pages generated |
| Local HTTP hold checks | 137 passed, including 50 simultaneous requests |
| Local redirect checks | Three passed; redirects simulated at loopback only |
| Runtime credential check | Next servers started without service credentials |
| Runtime/test-file comparison | Hold and recovery identical |
| Diff checks against main | Passed |

The HTTP requests use only `127.0.0.1:3012`, synthetic invalid authentication
headers and simulated Host headers. Path variants, seven methods, canonical/
normalization redirects, no-store and the `paused-v1` marker are asserted. The
unit suite also rejects Auth/database/payment dependency imports for the hold
and checks 100 parallel route calls and unchanged unrelated Auth routing.
The local servers were stopped after testing.

Builds use only the established loopback Supabase/test configuration. Neither
checkout contains `.env*` files. No SMTP/Resend or Daily credentials are provided.
Local runtime is Node 24.15.0. Node-22 CI has NOT run for these new revisions;
historical CI on `70ddca2`/`878c315` does not validate this update. Pushing and
dispatching CI were intentionally not part of the user's local-only request.

The merge diff inherits one trailing-space warning already present in main at
`scripts/test-isolated-coaching-reschedules.mjs:73`; that unrelated file is
unchanged from main. The candidates' own diffs against main are whitespace-clean.

## Remaining release gates

The verified backup `20261028T195659Z` remains a separate recovery artifact
outside Git. No key, customer rows or backup payloads are included here.

Before any release, pin the final candidate SHA, recheck main for drift, obtain
explicit release approval and run Node-22 CI with production-connected previews
disabled. The initial hold and the subsequent repair are separate releases.
Old-handler retirement and an automatic hosting fallback that cannot reopen
the old deletion path remain operational gates. These local checks prove neither.
Do not execute repair migrations until that transition is evidenced and the
exact migrations receive separate approval. Do not revert applied SQL or clear
uncertain deletion barriers during a code fallback.
