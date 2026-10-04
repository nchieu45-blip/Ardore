# Private coach calendar

`/creator/calendar` unifies the existing availability snapshot and owned 1:1
bookings. Desktop defaults to Monday-first week, mobile to day; both views remain
selectable. No external synchronization, schema changes or calendar write API.

The read-only endpoint derives the coach from the authenticated user, queries
bookings through the user's RLS context with an explicit owner filter, and uses
the existing owner-checked availability RPC. It returns only the fields needed
for calendar cards: no customer email, private meeting URL or provider IDs.
Responses are private/no-store; failures never become an empty successful calendar.

Actual UTC instants partition each Berlin date, including 23/25-hour DST days.
Offset-aware labels distinguish repeated autumn times. Configured windows respect
date exceptions, offer enablement, notice and horizon. Confirmed/pending bookings
and the same buffer semantics as slot generation override them. Pending expiry
does not release a slot in the UI. Canceled/failed/expired/completed appointments
remain visible separately without changing their stored state.

The displayed availability is a schedule overview, not permission to book:
existing slot generation and atomic database protections remain authoritative.
Cards open the existing private session detail, including meeting status and a
link to the exact existing booking-management card. Availability editing remains
in its existing atomic form. Refresh, focus and visible-minute refresh reread data.

Tests: `node --test scripts/verify-coach-calendar.mjs`; the opt-in
`scripts/test-synthetic-coach-calendar.mjs --run-production-synthetic` verifies
owned fixtures, actual production APIs, RLS, desktop/mobile/keyboard navigation,
network errors, unchanged booking/availability state and owned-fixture cleanup.
No Stripe, email or financial operations are performed.
