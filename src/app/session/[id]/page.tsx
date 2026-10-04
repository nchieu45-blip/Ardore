import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Video, Clock, Calendar, ArrowLeft, User } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import VideoRoom from './VideoRoom'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import { canAccessSessionMeeting, normalizeMeetingUrl } from '@/lib/session-meeting'
import MeetingAccess from './MeetingAccess'

export const metadata: Metadata = { title: 'Coaching-Session', robots: { index: false, follow: false } }

interface BookingRow {
  id: string
  creator_id: string
  buyer_id: string | null
  buyer_name: string
  buyer_email: string
  scheduled_at: string
  duration_minutes: number
  price_cents: number
  status: string
  payment_status: string
  stripe_livemode: boolean | null
  daily_room_url: string | null
  notes: string | null
  creator_profiles: { display_name: string; user_id: string } | null
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/session/${id}`)}`)

  const { data: booking } = await supabase
    .from('bookings')
    .select('*, creator_profiles(display_name, user_id)')
    .eq('id', id)
    .single()

  if (!booking) notFound()

  const b = booking as BookingRow
  const creator = b.creator_profiles

  // Auth check: only creator or buyer can access
  const isCreator = user && creator && user.id === creator.user_id
  const isBuyer   = user && b.buyer_id && user.id === b.buyer_id

  if (!isCreator && !isBuyer) notFound()

  const scheduledAt = new Date(b.scheduled_at)
  const endAt       = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  // eslint-disable-next-line react-hooks/purity
  const now         = Date.now()
  const msUntil     = scheduledAt.getTime() - now
  const isConfirmed = b.status === 'confirmed'
  const hasValidPayment = hasValidCoachingPayment(b)
  const isOver      = now > endAt.getTime()
  const price       = (b.price_cents / 100).toFixed(2).replace('.', ',')
  const canAttend = canAccessSessionMeeting(b, now)
  const { data: meeting, error: meetingError } = canAttend
    ? await supabase.from('booking_meeting_links').select('meeting_url').eq('booking_id', b.id).maybeSingle()
    : { data: null, error: null }
  const meetingUrl = normalizeMeetingUrl(meeting?.meeting_url)
  const hasDaily = VIDEO_CALLS_ENABLED && Boolean(b.daily_room_url)
  const isLive = canAttend && Boolean(meetingUrl || hasDaily) && now >= scheduledAt.getTime() - 15 * 60_000

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href={isCreator ? '/creator/sessions' : '/buyer/sessions'}
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        {isCreator ? 'Meine Buchungen' : 'Meine Sessions'}
      </Link>

      {/* Session info card */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 mb-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-lg bg-green-600 flex items-center justify-center">
                <Video className="h-4 w-4 text-white" />
              </div>
              <h1 className="text-lg font-bold text-gray-900">1:1 Videocoaching</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-500 flex-wrap">
              <span className="flex items-center gap-1">
                <User className="h-3.5 w-3.5" />
                {isCreator ? b.buyer_name : (creator?.display_name ?? 'Coach')}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {scheduledAt.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} – {endAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })} Uhr (Europe/Berlin)
              </span>
            </div>
            {b.notes && isCreator && (
              <p className="text-sm text-gray-500 mt-3 italic">{'„'}{b.notes}{'"'}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">{b.duration_minutes} Min</p>
            <p className="text-sm text-gray-400">{price} €</p>
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-2">
          {isLive && (
            <span className="inline-flex items-center gap-1.5 bg-green-600 text-white text-xs font-bold px-3 py-1 rounded-full">
              <span className="h-1.5 w-1.5 bg-white rounded-full animate-pulse" />
              Teilnahme möglich
            </span>
          )}
          {isConfirmed && !isLive && !isOver && (
            <span className="inline-flex items-center bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-3 py-1 rounded-full">
              {msUntil <= 0 ? 'Terminzeit läuft' : msUntil > 3_600_000
                ? `Startet in ${Math.round(msUntil / 3_600_000)} Std.`
                : msUntil > 60_000
                ? `Startet in ${Math.round(msUntil / 60_000)} Min.`
                : 'Startet gleich'}
            </span>
          )}
          {isConfirmed && isOver && (
            <span className="inline-flex items-center bg-gray-50 text-gray-500 border border-gray-200 text-xs font-medium px-3 py-1 rounded-full">
              Terminzeit vorbei – noch nicht als abgeschlossen markiert
            </span>
          )}
          {b.status === 'completed' && <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-800">Abgeschlossen</span>}
          {!isConfirmed && !['cancelled', 'completed'].includes(b.status) && (
            <span role="status" className="inline-flex items-center bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium px-3 py-1 rounded-full">
              {b.status === 'payment_failed' ? 'Zahlung fehlgeschlagen – Session nicht bestätigt' : b.status === 'expired' ? 'Reservierung abgelaufen – Session nicht bestätigt' : b.status === 'refunded' ? 'Zahlung erstattet' : b.status === 'reversed' ? 'Zahlung rückgängig' : 'Zahlung ausstehend – Session nicht bestätigt'}
            </span>
          )}
          {b.status === 'cancelled' && (
            <span className="inline-flex items-center bg-red-50 text-red-600 border border-red-200 text-xs font-medium px-3 py-1 rounded-full">
              Abgesagt
            </span>
          )}
        </div>
      </div>

      {canAttend && <MeetingAccess key={meetingUrl ?? 'no-meeting'} bookingId={b.id} meetingUrl={meetingUrl} isCoach={Boolean(isCreator)} loadFailed={Boolean(meetingError)} />}
      {isConfirmed && !hasValidPayment && <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Der Session-Zugang ist erst nach einer gültigen Zahlung verfügbar.</p>}
      {['cancelled', 'completed'].includes(b.status) || isOver ? <p className="mt-4 text-sm text-gray-600">Für diesen Termin ist kein Meeting-Zugang mehr verfügbar.</p> : null}
      {isCreator && b.status === 'cancelled' && <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Bitte beende oder lösche das externe Meeting auch beim Anbieter. Bereits kopierte Anbieter-Links kann Ardore dort nicht widerrufen.</p>}
      {/* Preserve Daily for a future explicit feature activation. */}
      {VIDEO_CALLS_ENABLED && isConfirmed && hasValidPayment && !meetingUrl && (
        <VideoRoom
          roomUrl={b.daily_room_url}
          isLive={isLive}
          isOver={isOver}
          scheduledAt={b.scheduled_at}
          durationMinutes={b.duration_minutes}
        />
      )}
    </div>
  )
}
