import Link from 'next/link'
import { CalendarDays, ArrowRight } from 'lucide-react'
import { BookingStatusBadge } from '@/components/ui/StatusBadge'
import { bookingPaymentSummary } from '@/lib/booking-presentation'

export interface WorkspaceBooking {
  id: string; buyer_name: string; scheduled_at: string; duration_minutes: number;
  status: string; payment_status: string; price_cents: number; is_subscription_session: boolean;
}
const appointmentTime = (value: string) => new Date(value).toLocaleString('de-DE', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
})
export function CoachDayOverview({ bookings, error, meetingReadyIds, meetingError, now }: {
  bookings: WorkspaceBooking[]; error: boolean; meetingReadyIds: Set<string>; meetingError: boolean; now: number;
}) {
  const upcoming = bookings.filter(b => new Date(b.scheduled_at).getTime() + b.duration_minutes * 60_000 > now)
  return <section aria-labelledby="workspace-appointments-title" className="surface-card min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-5">
      <div><p className="mb-1 text-sm text-brand">Dein Coaching-Alltag</p><h2 id="workspace-appointments-title" className="text-xl font-semibold tracking-tight">Heute & nächste Termine</h2></div>
      <Link href="/creator/calendar" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand">Kalender <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
    </div>
    {error ? <p role="alert" className="p-5 text-sm text-red-800">Termine konnten nicht geladen werden. Bitte lade die Seite erneut oder öffne den Kalender.</p>
      : upcoming.length === 0 ? <div className="p-6"><CalendarDays className="mb-3 h-6 w-6 text-muted" aria-hidden="true" /><p className="font-medium">Keine bevorstehenden Termine</p><p className="mt-2 text-sm text-muted">Deine verfügbaren Zeiten und Buchungen findest du im Kalender.</p></div>
      : <ul className="divide-y divide-border">{upcoming.slice(0,5).map(b => <li key={b.id} className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-2"><BookingStatusBadge status={b.status} /><span className="text-sm text-muted">1:1 Coaching · {b.duration_minutes} Min.</span></div>
        <Link href={`/session/${b.id}`} className="flex min-h-11 items-center justify-between gap-3 font-semibold text-foreground hover:text-brand"><span className="min-w-0 break-words">{b.buyer_name}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" /></Link>
        <p className="text-sm text-muted"><time dateTime={b.scheduled_at}>{appointmentTime(b.scheduled_at)} Uhr</time> · Europe/Berlin</p>
        <p className="mt-2 text-sm text-muted">{bookingPaymentSummary(b)}</p>
        {b.status === 'confirmed' && <p className={`mt-2 text-sm ${meetingError ? 'text-muted' : meetingReadyIds.has(b.id) ? 'text-brand' : 'text-amber-800'}`}>{meetingError ? 'Meeting-Status nicht verfügbar – bitte Sessiondetails prüfen.' : meetingReadyIds.has(b.id) ? 'Meeting-Link hinterlegt' : 'Meeting-Link fehlt – in den Sessiondetails ergänzen.'}</p>}
      </li>)}</ul>}
    <div className="border-t border-border px-5 py-2"><Link href="/creator/sessions" className="inline-flex min-h-11 items-center text-sm font-medium text-brand">Alle Buchungen ansehen →</Link></div>
  </section>
}
