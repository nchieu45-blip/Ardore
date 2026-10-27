import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'
import { createVideoAccess, validVideoId, videoJoinWindow, VideoAccessError, VIDEO_PRIVATE_HEADERS } from '@/lib/video-provider'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    const origin = request.headers.get('origin')
    if (!origin || ![new URL(request.url).origin, appOrigin()].includes(origin)
      || request.headers.get('sec-fetch-site') === 'cross-site') throw new VideoAccessError(403, 'Ungültige Anfrage.')
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new VideoAccessError(415, 'Ungültige Anfrage.')
    }
    let body: unknown
    try { body = await request.json() } catch { throw new VideoAccessError(400, 'Ungültige Anfrage.') }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new VideoAccessError(400, 'Ungültige Anfrage.')
    const { id } = await context.params
    if (!validVideoId(id)) throw new VideoAccessError(404, 'Buchung nicht gefunden.')
    const client = await createClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) throw new VideoAccessError(401, 'Nicht angemeldet.')
    const load = async () => {
      const { data: booking, error } = await client.from('bookings')
        .select('id,buyer_id,buyer_name,price_cents,status,payment_status,stripe_livemode,refund_status,scheduled_at,duration_minutes,creator_profiles(user_id,display_name)')
        .eq('id', id).maybeSingle()
      if (error) throw new VideoAccessError(503, 'Die Session konnte momentan nicht geprüft werden.')
      const coach = Array.isArray(booking?.creator_profiles) ? booking.creator_profiles[0] : booking?.creator_profiles
      const owner = coach?.user_id === user.id
      if (!booking || booking.id !== id || (!owner && booking.buyer_id !== user.id)) throw new VideoAccessError(404, 'Buchung nicht gefunden.')
      if (booking.status !== 'confirmed' || !hasValidCoachingPayment(booking) || booking.refund_status !== 'not_requested'
        || (booking.payment_status === 'not_required' && booking.price_cents !== 0)) {
        throw new VideoAccessError(409, 'Nur bestätigte und gültige Buchungen erhalten einen Videozugang.')
      }
      videoJoinWindow(booking.scheduled_at, booking.duration_minutes)
      return { booking, owner, name: owner ? coach?.display_name ?? 'Coach' : booking.buyer_name ?? 'Teilnehmer' }
    }
    const initial = await load()
    if (!VIDEO_CALLS_ENABLED) throw new VideoAccessError(503, 'Videoanrufe sind momentan nicht verfügbar.')
    const access = await createVideoAccess({
      kind: 'coaching', identity: id, startsAt: initial.booking.scheduled_at,
      durationMinutes: initial.booking.duration_minutes, userId: user.id,
      userName: initial.name, isOwner: initial.owner,
      reauthorize: async () => {
        const fresh = await load()
        if (fresh.owner !== initial.owner || fresh.booking.scheduled_at !== initial.booking.scheduled_at
          || fresh.booking.duration_minutes !== initial.booking.duration_minutes) {
          throw new VideoAccessError(409, 'Der Termin wurde inzwischen geändert. Bitte lade die Seite neu.')
        }
      },
    })
    return NextResponse.json(access, { headers: VIDEO_PRIVATE_HEADERS })
  } catch (error) {
    return NextResponse.json({ error: error instanceof VideoAccessError ? error.message : 'Der Videozugang konnte nicht bestätigt werden. Bitte versuche es erneut.' }, {
      status: error instanceof VideoAccessError ? error.status : 503, headers: VIDEO_PRIVATE_HEADERS,
    })
  }
}
