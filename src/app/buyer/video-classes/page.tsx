import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Users, Calendar, Clock, Video, ExternalLink } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Meine Video Classes' }

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

interface VCInfo {
  title: string
  schedule_type: 'once' | 'recurring'
  starts_at: string | null
  recurring_weekday: number | null
  recurring_time: string | null
  duration_minutes: number
  creator_profiles:
    | { display_name: string; slug: string }
    | { display_name: string; slug: string }[]
    | null
}

interface BookingRow {
  id: string
  video_class_id: string
  price_paid_cents: number
  status: string
  daily_room_url: string | null
  created_at: string
  video_classes: VCInfo | null
}

function scheduleLabel(vc: VCInfo | null): string | null {
  if (!vc) return null
  if (vc.schedule_type === 'once' && vc.starts_at) {
    return new Date(vc.starts_at).toLocaleString('de-DE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }) + ' Uhr'
  }
  if (vc.schedule_type === 'recurring' && vc.recurring_weekday !== null) {
    return `Jeden ${WEEKDAYS[vc.recurring_weekday]}, ${vc.recurring_time ?? ''} Uhr`
  }
  return null
}

function isLiveNow(vc: VCInfo | null, now: number): boolean {
  if (!vc || vc.schedule_type !== 'once' || !vc.starts_at) return false
  const startMs = new Date(vc.starts_at).getTime()
  const endMs   = startMs + vc.duration_minutes * 60_000
  return now >= startMs - 15 * 60_000 && now <= endMs
}

// Recurring classes: join button always active (we can't compute next occurrence)
function canJoin(vc: VCInfo | null, now: number): boolean {
  if (!vc) return false
  if (vc.schedule_type === 'recurring') return true
  return isLiveNow(vc, now)
}

export default async function BuyerVideoClassesPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { success } = await searchParams

  const { data } = await supabase
    .from('video_class_bookings')
    .select('id, video_class_id, price_paid_cents, status, daily_room_url, created_at, video_classes(title, schedule_type, starts_at, recurring_weekday, recurring_time, duration_minutes, creator_profiles(display_name, slug))')
    .eq('user_id', user.id)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })

  const bookings = (data ?? []) as unknown as BookingRow[]
  const now = Date.now()

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-violet-600 flex items-center justify-center shadow-sm">
          <Users className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Meine Video Classes</h1>
      </div>

      {success && (
        <div className="mb-6 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 font-medium">
          Anmeldung erfolgreich! Du findest den Kurs-Link hier, sobald die Zahlung bestätigt ist.
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="text-center py-20 rounded-2xl border-2 border-dashed border-gray-200">
          <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-700 mb-1">Noch keine Gruppen-Kurse gebucht</p>
          <p className="text-sm text-gray-400 mb-5">Entdecke Live-Sessions von geprüften Coaches.</p>
          <Link href="/coaches" className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors">
            Coaches entdecken →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map(booking => {
            const vc   = booking.video_classes
            const cp   = vc ? (Array.isArray(vc.creator_profiles) ? vc.creator_profiles[0] : vc.creator_profiles) : null
            const live = isLiveNow(vc, now)
            const join = canJoin(vc, now)
            const label = scheduleLabel(vc)

            return (
              <div key={booking.id} className="rounded-2xl border border-gray-100 bg-white p-5 hover:shadow-sm transition-shadow">
                <div className="flex items-start gap-4">
                  <div className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${live ? 'bg-green-100' : 'bg-violet-50'}`}>
                    <Users className={`h-5 w-5 ${live ? 'text-green-600' : 'text-violet-600'}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {live && (
                        <span className="inline-flex items-center gap-1 bg-green-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                          ● Live
                        </span>
                      )}
                      <span className="font-semibold text-gray-900">{vc?.title ?? 'Unbekannter Kurs'}</span>
                    </div>
                    {cp && (
                      <Link href={`/creators/${cp.slug}`} className="text-xs text-green-600 hover:underline font-medium">
                        {cp.display_name}
                      </Link>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-2">
                      {label && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {label}
                        </span>
                      )}
                      {vc && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {vc.duration_minutes} Min
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex-shrink-0">
                    {booking.daily_room_url && join ? (
                      <a
                        href={booking.daily_room_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                          live
                            ? 'bg-green-600 text-white hover:bg-green-700'
                            : 'bg-violet-600 text-white hover:bg-violet-700'
                        }`}
                      >
                        <Video className="h-3.5 w-3.5" />
                        Beitreten
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : booking.daily_room_url ? (
                      <button
                        disabled
                        title="Schaltfläche wird 15 Minuten vor dem Kurs aktiv"
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold text-gray-400 bg-gray-50 border border-gray-200 cursor-not-allowed"
                      >
                        <Video className="h-3.5 w-3.5" />
                        Beitreten
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
