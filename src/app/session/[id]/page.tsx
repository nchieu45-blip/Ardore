import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Video, Clock, Calendar, ArrowLeft, User } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'
import VideoRoom from './VideoRoom'

export const metadata: Metadata = { title: 'Video-Session' }

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

  if (!isCreator && !isBuyer) {
    // Allow public viewing of confirmed upcoming sessions — just no video
    // (email link without account → let them see details but no video)
    if (b.status === 'cancelled') notFound()
  }

  const scheduledAt = new Date(b.scheduled_at)
  const endAt       = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  const now         = Date.now()
  const msUntil     = scheduledAt.getTime() - now
  const isLive      = now >= scheduledAt.getTime() - 15 * 60_000 && now <= endAt.getTime()
  const isOver      = now > endAt.getTime()
  const price       = (b.price_cents / 100).toFixed(2).replace('.', ',')

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
                {scheduledAt.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} – {endAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr
              </span>
            </div>
            {b.notes && isCreator && (
              <p className="text-sm text-gray-500 mt-3 italic">„{b.notes}"</p>
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
              Live jetzt
            </span>
          )}
          {!isLive && !isOver && (
            <span className="inline-flex items-center bg-amber-50 text-amber-700 border border-amber-200 text-xs font-medium px-3 py-1 rounded-full">
              Startet {msUntil > 3_600_000
                ? `in ${Math.round(msUntil / 3_600_000)} Std.`
                : msUntil > 60_000
                ? `in ${Math.round(msUntil / 60_000)} Min.`
                : 'gleich'}
            </span>
          )}
          {isOver && (
            <span className="inline-flex items-center bg-gray-50 text-gray-500 border border-gray-200 text-xs font-medium px-3 py-1 rounded-full">
              Session beendet
            </span>
          )}
          {b.status === 'cancelled' && (
            <span className="inline-flex items-center bg-red-50 text-red-600 border border-red-200 text-xs font-medium px-3 py-1 rounded-full">
              Abgesagt
            </span>
          )}
        </div>
      </div>

      {/* Video room */}
      {b.status !== 'cancelled' && (
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
