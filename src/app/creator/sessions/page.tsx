import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Video, Calendar, Clock, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import BookingActions, { BookingRefundStatus, type BookingRefund } from '@/components/BookingActions'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import { BookingPaymentReconciliationStatus } from '@/components/BookingPaymentActions'

import { BookingStatusBadge } from '@/components/ui/StatusBadge'
import { bookingPaymentSummary, groupBookingsByTime } from '@/lib/booking-presentation'

export const metadata: Metadata = { title: 'Meine Buchungen' }

interface BookingRow {
  id: string
  buyer_name: string
  buyer_email: string
  scheduled_at: string
  duration_minutes: number
  cancellation_policy_hours: number | null
  price_cents: number
  is_subscription_session: boolean
  status: string
  notes: string | null
  payment_status: string
  refund_status: string
  stripe_livemode: boolean | null
}

export default async function CreatorSessionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!creator) redirect('/creator/onboarding')

  const bookingsRes = await supabase
    .from('bookings')
    .select('id, buyer_name, buyer_email, scheduled_at, duration_minutes, cancellation_policy_hours, price_cents, is_subscription_session, status, notes, payment_status, refund_status, stripe_livemode')
    .eq('creator_id', creator.id)
    .order('scheduled_at', { ascending: false })

  const rows = (bookingsRes.data ?? []) as BookingRow[]
  const refundMap = new Map<string, BookingRefund>()
  let refundLoadError = false
  if (rows.length > 0) {
    const { data: refunds, error } = await supabase
      .from('booking_refunds')
      .select('booking_id, state, amount_cents')
      .in('booking_id', rows.map(b => b.id))
    refundLoadError = Boolean(error)
    for (const refund of (refunds ?? []) as BookingRefund[]) refundMap.set(refund.booking_id, refund)
  }
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

  const { current, past } = groupBookingsByTime(rows, now)

  const totalRevenue    = rows.filter(b => b.payment_status === 'paid' && b.stripe_livemode === true && !b.is_subscription_session).reduce((sum, b) => sum + b.price_cents, 0)
  const aboSessionCount = rows.filter(b => b.status !== 'cancelled' && b.is_subscription_session).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
          <Video className="h-5 w-5 text-white" />
        </div>
        <h1 className="section-title text-gray-900">Buchungen</h1>
      </div>
      <p className="text-sm text-gray-500 mb-8">Deine 1:1 Videocoaching-Sessions</p>
      <Link href="/creator/calendar" className="inline-block mb-6 rounded-lg border border-green-300 px-4 py-2 text-sm font-medium text-green-800 focus-visible:ring-2 focus-visible:ring-green-600">Kalender mit Verfügbarkeit öffnen →</Link>

      {/* Stats row */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <div className="rounded-xl bg-green-50 p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{current.filter(b => b.status === 'confirmed').length}</p>
            <p className="text-xs text-green-600 mt-0.5">Bestätigte Termine</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{rows.filter(b => b.status === 'completed').length}</p>
            <p className="text-xs text-blue-600 mt-0.5">Abgeschlossen</p>
          </div>
          <div className="rounded-xl bg-purple-50 p-4 text-center">
            <p className="text-2xl font-bold text-purple-700">{aboSessionCount}</p>
            <p className="text-xs text-purple-600 mt-0.5">Abo-Sessions</p>
          </div>
          <div className="rounded-xl bg-gray-50 p-4 text-center">
            <p className="text-2xl font-bold text-gray-700">{(totalRevenue / 100).toFixed(0)} €</p>
            <p className="text-xs text-gray-500 mt-0.5">Umsatz (bezahlt)</p>
          </div>
        </div>
      )}

      {refundLoadError && <p role="alert" className="mb-6 text-sm text-amber-800">Der Erstattungsstatus konnte nicht geladen werden. Bitte lade die Seite erneut; eine Erstattung wird deshalb nicht als abgeschlossen angezeigt.</p>}
      {rows.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border-2 border-dashed border-gray-200">
          <Video className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-700 mb-1">Noch keine Buchungen</p>
          <p className="text-sm text-gray-400 mb-5">Aktiviere Videocoaching in den Einstellungen, damit Kunden buchen können.</p>
          <Link href="/creator/settings/videocoaching" className="text-sm text-green-600 hover:text-green-700 font-medium">
            Videocoaching einrichten →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {current.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bevorstehend und laufend</h2>
              <div className="space-y-3">
                {current.map(b => <CreatorSessionCard key={b.id} booking={b} now={now} creatorId={creator.id} refund={refundMap.get(b.id) ?? null} />)}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Vergangen</h2>
              <div className="space-y-3">
                {past.map(b => <CreatorSessionCard key={b.id} booking={b} now={now} creatorId={creator.id} refund={refundMap.get(b.id) ?? null} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function CreatorSessionCard({ booking: b, now, creatorId, refund }: { booking: BookingRow; now: number; creatorId: string; refund: BookingRefund | null }) {
  const scheduledAt  = new Date(b.scheduled_at)
  const endAt        = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  const isLive       = VIDEO_CALLS_ENABLED && b.status === 'confirmed' && hasValidCoachingPayment(b)
    && now >= scheduledAt.getTime() - 15 * 60_000 && now <= endAt.getTime()
  // Completion is explicit; elapsed appointment time alone is not delivery.
  const canCancel = b.status === 'confirmed'
  const canReschedule = scheduledAt.getTime() > now
  const isAboSession = b.is_subscription_session

  return (
    <div id={`booking-${b.id}`} className="scroll-mt-24 rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-sm transition-shadow">
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {isLive && (
              <span className="inline-flex items-center gap-1 bg-green-600 text-white text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                ● Live
              </span>
            )}
            <BookingStatusBadge status={b.status} />
          </div>
          <p className="font-semibold text-gray-900 mb-1">{b.buyer_name}</p>
          <p className="text-sm text-gray-400 mb-2 break-words [overflow-wrap:anywhere]">{b.buyer_email}</p>
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {scheduledAt.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr (Europe/Berlin) · {b.duration_minutes} Min
            </span>
          </div>
          {b.notes && (
            <p className="text-xs text-gray-400 mt-2 italic line-clamp-2">{'„'}{b.notes}{'"'}</p>
          )}
          {!VIDEO_CALLS_ENABLED && b.status === 'confirmed' && (
            <p className="text-xs text-gray-500 mt-2">Öffne die Sessiondetails, um den privaten Meeting-Link zu hinterlegen oder zu ändern.</p>
          )}
          {isAboSession ? (
            <span className="inline-flex items-center gap-1 mt-1 bg-purple-50 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">
              <Video className="h-3 w-3" />
              {bookingPaymentSummary(b)}
            </span>
          ) : (
            <p className="text-sm font-medium text-gray-700 mt-1">
              {bookingPaymentSummary(b)}
            </p>
          )}
        </div>
        <Link
          href={`/session/${b.id}`}
          className="flex-shrink-0 flex items-center gap-1.5 text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
        >
          {isLive ? (
            <>
              <Video className="h-4 w-4" />
              Beitreten
            </>
          ) : (
            <>
              Details
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Link>
      </div>
      <BookingRefundStatus refund={refund} />
      {!refund && b.refund_status && b.refund_status !== 'not_requested' && <BookingPaymentReconciliationStatus state={b.refund_status} />}
      {(canCancel || (b.status === 'cancelled' && (refund?.state === 'pending' || refund?.state === 'failed'))) && (
        <BookingActions
          bookingId={b.id}
          scheduledAt={b.scheduled_at}
          creatorId={creatorId}
          coachName={b.buyer_name}
          policyHours={b.cancellation_policy_hours}
          paid={b.payment_status === 'paid' || b.payment_status === 'partially_refunded'}
          canReschedule={canReschedule}
          refund={refund}
          refundRetry={b.status === 'cancelled'}
          role="creator"
        />
      )}
    </div>
  )
}
