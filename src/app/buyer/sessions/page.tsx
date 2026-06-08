import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Video, Calendar, Clock, ChevronRight } from 'lucide-react'
import type { Metadata } from 'next'
import SessionReviewPrompt from '@/components/SessionReviewPrompt'

export const metadata: Metadata = { title: 'Meine Sessions' }

const STATUS_LABELS: Record<string, string> = {
  confirmed:  'Bestätigt',
  cancelled:  'Abgesagt',
  completed:  'Abgeschlossen',
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
}

interface BookingRow {
  id: string
  scheduled_at: string
  duration_minutes: number
  price_cents: number
  is_subscription_session: boolean
  status: string
  daily_room_url: string | null
  creator_profiles: { id: string; display_name: string; slug: string; avatar_url: string | null } | null
}

interface ExistingReview {
  rating: number
  content: string | null
}

export default async function BuyerSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ review?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { review: autoReviewBookingId } = await searchParams

  const [bookingsRes, reviewsRes] = await Promise.all([
    supabase
      .from('bookings')
      .select('id, scheduled_at, duration_minutes, price_cents, is_subscription_session, status, daily_room_url, creator_profiles(id, display_name, slug, avatar_url)')
      .eq('buyer_id', user.id)
      .order('scheduled_at', { ascending: false }),
    supabase
      .from('session_reviews')
      .select('booking_id, rating, content')
      .eq('buyer_id', user.id),
  ])

  const rows = (bookingsRes.data ?? []) as unknown as BookingRow[]
  const reviewMap = new Map<string, ExistingReview>()
  for (const r of (reviewsRes.data ?? []) as { booking_id: string; rating: number; content: string | null }[]) {
    reviewMap.set(r.booking_id, { rating: r.rating, content: r.content })
  }

  const now = Date.now()

  const upcoming = rows.filter(b => b.status === 'confirmed' && new Date(b.scheduled_at).getTime() > now)
  const past     = rows.filter(b => b.status !== 'confirmed' || new Date(b.scheduled_at).getTime() <= now)

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
          <Video className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Meine Sessions</h1>
      </div>

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
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bevorstehend</h2>
              <div className="space-y-3">
                {upcoming.map(b => (
                  <SessionCard
                    key={b.id}
                    booking={b}
                    now={now}
                    existingReview={reviewMap.get(b.id) ?? null}
                    autoOpen={autoReviewBookingId === b.id}
                  />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Vergangen</h2>
              <div className="space-y-3 opacity-90">
                {past.map(b => (
                  <SessionCard
                    key={b.id}
                    booking={b}
                    now={now}
                    existingReview={reviewMap.get(b.id) ?? null}
                    autoOpen={autoReviewBookingId === b.id}
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
}: {
  booking: BookingRow
  now: number
  existingReview: ExistingReview | null
  autoOpen: boolean
}) {
  const scheduledAt = new Date(b.scheduled_at)
  const endAt       = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  const isLive      = now >= scheduledAt.getTime() - 15 * 60_000 && now <= endAt.getTime()
  const isEnded     = endAt.getTime() < now && b.status !== 'cancelled'
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
              {scheduledAt.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · {b.duration_minutes} Min
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
    </div>
  )
}
