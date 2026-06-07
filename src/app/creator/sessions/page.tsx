import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Video, Calendar, Clock, ChevronRight, CheckCircle2 } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Meine Buchungen' }

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  cancelled: 'Abgesagt',
  completed: 'Abgeschlossen',
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  cancelled: 'bg-gray-50 text-gray-500 border-gray-200',
  completed: 'bg-blue-50 text-blue-700 border-blue-200',
}

interface BookingRow {
  id: string
  buyer_name: string
  buyer_email: string
  scheduled_at: string
  duration_minutes: number
  price_cents: number
  is_subscription_session: boolean
  status: string
  notes: string | null
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

  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, buyer_name, buyer_email, scheduled_at, duration_minutes, price_cents, is_subscription_session, status, notes')
    .eq('creator_id', creator.id)
    .order('scheduled_at', { ascending: false })

  const rows = (bookings ?? []) as BookingRow[]
  const now = Date.now()

  const upcoming = rows.filter(b => b.status === 'confirmed' && new Date(b.scheduled_at).getTime() > now)
  const past     = rows.filter(b => b.status !== 'confirmed' || new Date(b.scheduled_at).getTime() <= now)

  const totalRevenue    = rows.filter(b => b.status !== 'cancelled' && !b.is_subscription_session).reduce((sum, b) => sum + b.price_cents, 0)
  const aboSessionCount = rows.filter(b => b.status !== 'cancelled' && b.is_subscription_session).length

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-10 w-10 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
          <Video className="h-5 w-5 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Buchungen</h1>
      </div>
      <p className="text-sm text-gray-500 mb-8">Deine 1:1 Videocoaching-Sessions</p>

      {/* Stats row */}
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="rounded-xl bg-green-50 p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{upcoming.length}</p>
            <p className="text-xs text-green-600 mt-0.5">Bevorstehend</p>
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
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Bevorstehend</h2>
              <div className="space-y-3">
                {upcoming.map(b => <CreatorSessionCard key={b.id} booking={b} now={now} />)}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Vergangen</h2>
              <div className="space-y-3 opacity-75">
                {past.map(b => <CreatorSessionCard key={b.id} booking={b} now={now} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function CreatorSessionCard({ booking: b, now }: { booking: BookingRow; now: number }) {
  const scheduledAt  = new Date(b.scheduled_at)
  const endAt        = new Date(scheduledAt.getTime() + b.duration_minutes * 60_000)
  const isLive       = now >= scheduledAt.getTime() - 15 * 60_000 && now <= endAt.getTime()
  const price        = (b.price_cents / 100).toFixed(2).replace('.', ',')
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
          <p className="font-semibold text-gray-900 mb-1">{b.buyer_name}</p>
          <p className="text-sm text-gray-400 mb-2">{b.buyer_email}</p>
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
          {b.notes && (
            <p className="text-xs text-gray-400 mt-2 italic line-clamp-2">„{b.notes}"</p>
          )}
          {isAboSession ? (
            <span className="inline-flex items-center gap-1 mt-1 bg-purple-50 text-purple-700 text-xs font-medium px-2 py-0.5 rounded-full">
              <Video className="h-3 w-3" />
              Abo-Session (inklusiv)
            </span>
          ) : (
            <p className="text-sm font-medium text-gray-700 mt-1">{price} €</p>
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
    </div>
  )
}
