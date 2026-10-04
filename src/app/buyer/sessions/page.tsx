import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Video, Calendar, Clock, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import SessionReviewPrompt from '@/components/SessionReviewPrompt'
import BookingActions, { BookingRefundStatus, type BookingRefund } from '@/components/BookingActions'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import BookingPaymentActions, { BookingPaymentReconciliationStatus } from '@/components/BookingPaymentActions'

export const metadata: Metadata = { title: 'Meine Sessions' }

const STATUS_LABELS: Record<string, string> = {
  confirmed:  'Bestätigt',
  cancelled:  'Abgesagt',
  completed:  'Abgeschlossen',
  pending_payment: 'Zahlung ausstehend',
  payment_failed: 'Zahlung fehlgeschlagen',
  expired: 'Reservierung abgelaufen',
  refunded: 'Erstattet',
  reversed: 'Zahlung rückgängig',
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
  pending_payment: 'bg-amber-50 text-amber-700 border-amber-200',
}

interface BookingRow {
  id: string
  creator_id: string
  scheduled_at: string
  duration_minutes: number
  cancellation_policy_hours: number | null
  price_cents: number
  is_subscription_session: boolean
  status: string
  daily_room_url: string | null
  payment_status: string
  refund_status: string
  stripe_livemode: boolean | null
  creator_profiles: { id: string; display_name: string; slug: string; avatar_url: string | null } | null
}

interface ExistingReview {
  rating: number
  content: string | null
}

export default async function BuyerSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string; checkout?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { review: autoReviewBookingId, checkout } = await searchParams

  const [bookingsRes, reviewsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, creator_id, scheduled_at, duration_minutes, cancellation_policy_hours, price_cents, is_subscription_session, status, payment_status, refund_status, stripe_livemode, daily_room_url, creator_profiles(id, display_name, slug, avatar_url)')
      .eq('buyer_id', user.id)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('session_reviews')
      .select('booking_id, rating, content')
      .eq('buyer_id', user.id),
  ])

  const rows = (bookingsRes.data ?? []) as unknown as BookingRow[]

  // eslint-disable-next-line react-hooks/purity
  const now = Date.now()

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
  const reviewMap = new Map<string, ExistingReview>()
  for (const r of (reviewsRes.data ?? []) as { booking_id: string; rating: number; content: string | null }[]) {
    reviewMap.set(r.booking_id, { rating: r.rating, content: r.content })
  }

  const current = rows.filter(b => b.status === 'confirmed' && new Date(b.scheduled_at).getTime() + b.duration_minutes * 60_000 > now)
  const other = rows.filter(b => !current.includes(b))

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
          <Video className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Meine Sessions</h1>
      </div>

      {checkout === 'success' && (
        <div role="status" className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Deine Zahlung wird überprüft. Die Session ist erst nach der Stripe-Zahlungsbestätigung bestätigt.
        </div>
      )}
      {checkout === 'cancelled' && (
        <div role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Du hast den Checkout verlassen. Du kannst die Zahlung für dieselbe Buchung fortsetzen; der Zahlungsstatus wird dabei erneut geprüft.
        </div>
      )}

      {refundLoadError && <p role="alert" className="mb-6 text-sm text-amber-800">Der Erstattungsstatus konnte nicht geladen werden. Bitte lade die Seite erneut; eine Erstattung wird deshalb nicht als abgeschlossen angezeigt.</p>}
      {rows.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border-2 border-dashed border-gray-200">
          <Video className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-700 mb-1">Noch keine Sessions gebucht</p>
          <p className="text-sm text-gray-400 mb-5">Buche eine 1:1 Session direkt auf dem Profil deines Coaches.</p>
          <Link href="/coaches" className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors">
            Coaches entdecken →
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {current.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bevorstehend und laufend</h2>
              <div className="space-y-3">
                {current.map(b => (
                  <SessionCard
                    key={b.id}
                    booking={b}
                    now={now}
                    existingReview={reviewMap.get(b.id) ?? null}
                    autoOpen={autoReviewBookingId === b.id}
                    refund={refundMap.get(b.id) ?? null}
                  />
                ))}
              </div>
            </section>
          )}
          {other.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Weitere Buchungen</h2>
              <div className="space-y-3 opacity-90">
                {other.map(b => (
                  <SessionCard
                    key={b.id}
                    booking={b}
                    now={now}
                    existingReview={reviewMap.get(b.id) ?? null}
                    autoOpen={autoReviewBookingId === b.id}
                    refund={refundMap.get(b.id) ?? null}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SessionCard({
  booking: b,
  now,
  existingReview,
  autoOpen,
  refund,
}: {
  booking: BookingRow
  now: number
  existingReview: ExistingReview | null
  autoOpen: boolean
  refund: BookingRefund | null
}) {
  const scheduledAt  = new Date(b.scheduled_at)
  const endAt        = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  const isLive       = VIDEO_CALLS_ENABLED && b.status === 'confirmed' && hasValidCoachingPayment(b)
    && now >= scheduledAt.getTime() - 15 * 60_000 && now <= endAt.getTime()
  const isEnded      = endAt.getTime() < now && ['confirmed', 'completed'].includes(b.status)
  const isUpcoming   = b.status === 'confirmed' && scheduledAt.getTime() > now
  const price       = (b.price_cents / 100).toFixed(2).replace('.', ',')
  const creator     = b.creator_profiles
  const isAboSession = b.is_subscription_session

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {isLive && (
              <span className="inline-flex items-center gap-1 bg-green-600 text-white text-xs font-bold px-2.5 py-0.5 rounded-full animate-pulse">
                ● Live
              </span>
            )}
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[b.status] ?? ''}`}>
              {STATUS_LABELS[b.status] ?? b.status}
            </span>
          </div>
          {creator && (
            <p className="font-semibold text-gray-900 mb-1">
              Session mit {creator.display_name}
            </p>
          )}
          <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {scheduledAt.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Berlin' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr · {b.duration_minutes} Min
            </span>
          </div>
          {isAboSession ? (
            <span className="inline-flex items-center gap-1 mt-1 bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
              <Video className="h-3 w-3" />
              Inklusiv (Abo)
            </span>
          ) : (
            <p className="text-sm text-gray-400 mt-1">{price} €</p>
          )}
          {!VIDEO_CALLS_ENABLED && b.status === 'confirmed' && (
            <p className="text-xs text-gray-500 mt-2">Den privaten Meeting-Link deines Coaches findest du in den Sessiondetails.</p>
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
              Session
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Link>
      </div>

      {isEnded && creator && (
        <SessionReviewPrompt
          bookingId={b.id}
          coachName={creator.display_name}
          existingReview={existingReview}
          autoOpen={autoOpen}
        />
      )}
      <BookingRefundStatus refund={refund} />
      {!refund && b.refund_status && b.refund_status !== 'not_requested' && <BookingPaymentReconciliationStatus state={b.refund_status} />}
      {creator && !b.is_subscription_session && b.price_cents > 0 && scheduledAt.getTime() > now
        && ['pending_payment', 'payment_failed', 'expired', 'reversed'].includes(b.status)
        && ['pending', 'failed', 'expired', 'unpaid', 'reversed'].includes(b.payment_status)
        && (!b.refund_status || b.refund_status === 'not_requested')
        && (!refund || refund.state === 'not_requested') && (
          <BookingPaymentActions bookingId={b.id} status={b.status} />
        )}
      {creator && (isUpcoming || (b.status === 'cancelled' && (refund?.state === 'pending' || refund?.state === 'failed'))) && (
        <BookingActions
          bookingId={b.id}
          scheduledAt={b.scheduled_at}
          creatorId={b.creator_id}
          coachName={creator.display_name}
          policyHours={b.cancellation_policy_hours}
          paid={b.payment_status === 'paid' || b.payment_status === 'partially_refunded'}
          refund={refund}
          refundRetry={b.status === 'cancelled'}
          role="buyer"
        />
      )}
    </div>
  )
}
