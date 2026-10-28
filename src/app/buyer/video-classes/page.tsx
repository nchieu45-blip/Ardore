import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { formatGroupOccurrence } from '@/lib/group-schedule'
import { formatCurrency } from '@/lib/utils'
import GroupBookingActions from '@/components/GroupBookingActions'
import { buttonStyles } from '@/components/ui/Button'

export const metadata: Metadata = { title: 'Meine Gruppenbuchungen', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const labels: Record<string, string> = {
  creating: 'Zahlung wird vorbereitet', open: 'Zahlung offen', processing: 'Zahlung wird geprüft',
  confirmed: 'Gebucht', expired: 'Reservierung abgelaufen', failed: 'Zahlung fehlgeschlagen',
  cancelled: 'Storniert', refund_pending: 'Erstattung in Bearbeitung', refunded: 'Erstattet', payment_review: 'Zahlung wird geprüft',
}

interface Reservation {
  id: string; scheduled_at?: string; video_class_id: string; occurrence_start: string; duration_minutes: number; class_title: string
  creator_slug: string; price_cents: number; status: string; booking_id: string | null
  refund_status: string; amount_refunded_cents: number; stripe_livemode: boolean | null
}

export default async function BuyerVideoClassesPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const client = await createClient()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) redirect('/login?redirect=%2Fbuyer%2Fvideo-classes')
  const { checkout } = await searchParams
  // This security-invoker view exposes only the caller's safe status fields.
  // The browser never receives Checkout keys, payment identities or room URLs.
  const [reservations, historical] = await Promise.all([
    client.from('group_booking_status').select('scheduled_at,id,video_class_id,occurrence_start,duration_minutes,class_title,creator_slug,price_cents,status,booking_id,refund_status,amount_refunded_cents,stripe_livemode').order('created_at', { ascending: false }),
    client.from('video_class_bookings').select('id,status,created_at,video_classes(title)').eq('user_id', user.id).is('reservation_id', null).order('created_at', { ascending: false }),
  ])
  const rows = (reservations.data ?? []) as Reservation[]
  const now = new Date().getTime()
  return <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
    <h1 className="section-title">Meine Gruppenbuchungen</h1>
    <p className="mt-2 text-sm leading-relaxed text-muted">Jede Buchung gilt für den angezeigten Termin. Den Videozugang findest du hier, sobald deine Anmeldung bestätigt ist.</p>
    {checkout && <p role="status" className="mt-5 rounded-xl border border-border bg-surface p-4 text-sm text-muted">Du bist von der Zahlung zurückgekehrt. Maßgeblich ist der Status deiner Buchung unten. Die Rückkehr von Stripe bestätigt allein noch keine Teilnahme.</p>}
    {(reservations.error || historical.error) && <div role="alert" className="mt-6 rounded-xl border border-border p-5"><p className="text-sm text-red-700">Deine Gruppenbuchungen konnten nicht vollständig geladen werden. Bitte lade die Seite erneut.</p><Link href="/buyer/video-classes" className="mt-3 inline-flex min-h-11 items-center font-medium text-brand underline underline-offset-4">Erneut laden</Link></div>}
    {!reservations.error && rows.length === 0 && <div className="mt-6 rounded-xl border border-border p-6"><h2 className="font-semibold">Noch keine Gruppenbuchungen</h2><p className="mt-2 text-sm text-muted">Wähle einen Gruppenkurs und buche einen passenden Termin.</p><Link href="/marketplace?area=groups" className={buttonStyles({ variant: 'secondary', className: 'mt-4 w-full sm:w-auto' })}>Gruppencoaching entdecken</Link></div>}
    <div className="mt-6 space-y-4">
      {rows.map(row => {
        const paidTest = row.price_cents > 0 && row.stripe_livemode === false
        const confirmed = row.status === 'confirmed' && (row.price_cents === 0 || row.stripe_livemode === true) && row.refund_status === 'not_requested' && row.amount_refunded_cents === 0
        const canCancel = row.status === 'confirmed' && Date.parse(row.scheduled_at ?? row.occurrence_start) > now
        return <article key={row.id} id={`reservation-${row.id}`} className="scroll-mt-24 rounded-xl border border-border bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-semibold">{row.class_title}</h2><span className="text-sm font-medium">{labels[row.status] ?? 'Status wird geprüft'}</span></div>
          <p className="mt-2 text-sm text-muted">{formatGroupOccurrence(row.scheduled_at ?? row.occurrence_start)} · {row.duration_minutes} Min.</p>
          <p className="mt-2 text-sm font-medium">{row.price_cents === 0 ? 'Kostenlos oder im Abo enthalten' : `${formatCurrency(row.price_cents / 100)} für diesen Termin`}</p>
          {row.creator_slug && <Link href={`/creators/${row.creator_slug}`} className="mr-4 mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand underline underline-offset-4">Zum Coach-Profil</Link>}
          {paidTest && <p role="status" className="mt-3 text-sm leading-relaxed text-muted">Testzahlung: Diese Zahlung schaltet keine reale kostenpflichtige Teilnahme frei.</p>}
          {row.refund_status === 'failed' && <p role="alert" className="mt-3 text-sm text-red-700">Die Erstattung konnte noch nicht abgeschlossen werden. Bitte kontaktiere den Support mit deiner Buchungsnummer {row.id}.</p>}
          {row.refund_status === 'pending' && <p role="status" className="mt-3 text-sm text-muted">Deine Erstattung wird bearbeitet. Sie ist noch nicht als abgeschlossen bestätigt.</p>}
          {row.refund_status === 'succeeded' && <p className="mt-3 text-sm text-muted">Erstattet: {formatCurrency(row.amount_refunded_cents / 100)}.</p>}
          {confirmed && row.booking_id && <Link href={`/group-session/${row.video_class_id}?occurrenceStart=${encodeURIComponent(row.occurrence_start)}`} className={buttonStyles({ className: 'mt-4 w-full sm:w-auto' })}>Termin und Videozugang öffnen</Link>}
          {['failed', 'expired'].includes(row.status) && <p className="mt-3 text-sm text-muted">Für diesen Versuch liegt keine bestätigte Anmeldung vor. Eine neue Buchung kannst du im Coach-Profil starten.</p>}
          <GroupBookingActions reservationId={row.id} bookingId={row.booking_id} status={row.status} canCancel={canCancel} paid={row.price_cents > 0} />
        </article>
      })}
    </div>
    {!historical.error && (historical.data ?? []).length > 0 && <section className="mt-8 border-t border-border pt-6"><h2 className="text-lg font-semibold">Ältere Kursanmeldungen</h2><p className="mt-2 text-sm leading-relaxed text-muted">Diese Anmeldungen wurden vor der Einführung einzelner Terminbuchungen erstellt. Sie werden nicht automatisch in neue kostenpflichtige Termine umgewandelt.</p><ul className="mt-4 space-y-3">{historical.data!.map(row => { const course = Array.isArray(row.video_classes) ? row.video_classes[0] : row.video_classes; return <li key={row.id} className="text-sm"><span className="font-medium">{course?.title ?? 'Gruppenkurs'}</span> · {row.status === 'cancelled' ? 'Storniert' : 'Ältere Anmeldung'}</li> })}</ul></section>}
  </div>
}
