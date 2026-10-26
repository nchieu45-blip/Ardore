import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'
import { canonicalOccurrenceStart, createVideoAccess, validVideoId, videoJoinWindow, VideoAccessError, VIDEO_PRIVATE_HEADERS } from '@/lib/video-provider'

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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'occurrenceStart')) {
      throw new VideoAccessError(400, 'Ungültige Anfrage.')
    }
    const occurrenceStart = canonicalOccurrenceStart((body as { occurrenceStart?: unknown }).occurrenceStart)
    if (!occurrenceStart) throw new VideoAccessError(400, 'Bitte wähle einen gültigen Termin.')
    const { id } = await context.params
    if (!validVideoId(id)) throw new VideoAccessError(404, 'Kurs nicht gefunden.')
    const client = await createClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) throw new VideoAccessError(401, 'Nicht angemeldet.')
    let service: Awaited<ReturnType<typeof createServiceClient>> | null = null
    const privileged = async () => service ?? (service = await createServiceClient())

    const load = async () => {
      // Class visibility and participant ownership are checked using the caller's
      // RLS client before any private occurrence/payment ledger is read.
      const { data: course, error: classError } = await client.from('video_classes')
        .select('id,creator_id,duration_minutes,creator_profiles(user_id,display_name)')
        .eq('id', id).maybeSingle()
      if (classError) throw new VideoAccessError(503, 'Der Kurs konnte momentan nicht geprüft werden.')
      if (!course || course.id !== id) throw new VideoAccessError(404, 'Kurs nicht gefunden.')
      const coach = Array.isArray(course.creator_profiles) ? course.creator_profiles[0] : course.creator_profiles
      const owner = coach?.user_id === user.id
      let booking: {
        id: string; user_id: string; video_class_id: string; occurrence_start: string | null;
        duration_minutes: number | null; status: string; price_paid_cents: number;
        payment_status: string; stripe_livemode: boolean | null; payment_order_id: string | null;
        reservation_id: string | null; refund_status: string; amount_refunded_cents: number;
      } | null = null
      if (!owner) {
        const result = await client.from('video_class_bookings')
          .select('id,user_id,video_class_id,occurrence_start,duration_minutes,status,price_paid_cents,payment_status,stripe_livemode,payment_order_id,reservation_id,refund_status,amount_refunded_cents')
          .eq('video_class_id', id).eq('user_id', user.id).eq('occurrence_start', occurrenceStart)
          .eq('status', 'confirmed').maybeSingle()
        if (result.error) throw new VideoAccessError(503, 'Deine Anmeldung konnte momentan nicht geprüft werden.')
        booking = result.data
        if (!booking || booking.user_id !== user.id || booking.video_class_id !== id || booking.status !== 'confirmed'
          || canonicalOccurrenceStart(booking.occurrence_start) !== occurrenceStart || !validVideoId(booking.reservation_id)
          || booking.refund_status !== 'not_requested' || booking.amount_refunded_cents !== 0
          || !((booking.price_paid_cents === 0 && booking.payment_status === 'not_required' && booking.payment_order_id === null)
            || (Number.isSafeInteger(booking.price_paid_cents) && booking.price_paid_cents > 0 && booking.payment_status === 'paid'
              && booking.stripe_livemode === true && validVideoId(booking.payment_order_id)))) {
          throw new VideoAccessError(404, 'Für diesen Termin liegt keine gültige Anmeldung vor.')
        }
      }
      if (!VIDEO_CALLS_ENABLED) throw new VideoAccessError(503, 'Videoanrufe sind momentan nicht verfügbar.')
      const admin = await privileged()
      const { data: stored, error: occurrenceError } = await admin.from('video_class_occurrences')
        .select('video_class_id,starts_at,duration_minutes,class_title')
        .eq('video_class_id', id).eq('starts_at', occurrenceStart).maybeSingle()
      if (occurrenceError) throw new VideoAccessError(503, 'Die Terminzeit konnte momentan nicht geprüft werden.')
      let occurrence = stored
      if (!occurrence && owner) {
        // Only the actual coach may freeze a valid, published course occurrence
        // before its first participant. The RPC validates the stored schedule.
        videoJoinWindow(occurrenceStart, course.duration_minutes)
        if (!process.env.DAILY_API_KEY?.trim()) throw new VideoAccessError(503, 'Videoanrufe sind noch nicht vollständig eingerichtet. Bitte kontaktiere den Support.')
        const result = await admin.rpc('ensure_group_class_occurrence', { p_class_id: id, p_occurrence_start: occurrenceStart })
        if (result.error) throw new VideoAccessError(503, 'Die Terminzeit konnte momentan nicht bestätigt werden.')
        occurrence = result.data
      }
      if (!occurrence || occurrence.video_class_id !== id || canonicalOccurrenceStart(occurrence.starts_at) !== occurrenceStart
        || (booking && booking.duration_minutes !== occurrence.duration_minutes)) {
        throw new VideoAccessError(409, 'Dieser Kurstermin ist nicht verfügbar.')
      }
      videoJoinWindow(occurrenceStart, occurrence.duration_minutes)
      if (booking?.payment_status === 'paid') {
        const [orderResult, reservationResult] = await Promise.all([
          admin.from('payment_orders').select('id,kind,buyer_id,creator_id,state,reference,gross_cents,stripe_livemode')
            .eq('id', booking.payment_order_id).maybeSingle(),
          admin.from('group_booking_reservations').select('id,buyer_id,creator_id,video_class_id,occurrence_start,duration_minutes,price_cents,status,booking_id,payment_order_id,stripe_livemode,refund_status,amount_refunded_cents')
            .eq('id', booking.reservation_id).maybeSingle(),
        ])
        if (orderResult.error || reservationResult.error) throw new VideoAccessError(503, 'Die Zahlung konnte momentan nicht geprüft werden.')
        const order = orderResult.data
        const reservation = reservationResult.data
        const reference = order?.reference as Record<string, unknown> | undefined
        if (!order || order.id !== booking.payment_order_id || order.kind !== 'group' || order.buyer_id !== user.id
          || order.creator_id !== course.creator_id || order.state !== 'fulfilled' || order.gross_cents !== booking.price_paid_cents
          || order.stripe_livemode !== true || reference?.reservationId !== booking.reservation_id
          || reference.videoClassId !== id || canonicalOccurrenceStart(reference.occurrenceStart) !== occurrenceStart
          || reference.durationMinutes !== booking.duration_minutes || !reservation || reservation.id !== booking.reservation_id
          || reservation.buyer_id !== user.id || reservation.creator_id !== course.creator_id || reservation.video_class_id !== id
          || canonicalOccurrenceStart(reservation.occurrence_start) !== occurrenceStart || reservation.duration_minutes !== booking.duration_minutes
          || reservation.price_cents !== booking.price_paid_cents || reservation.stripe_livemode !== true
          || reservation.status !== 'confirmed' || reservation.booking_id !== booking.id || reservation.payment_order_id !== order.id
          || reservation.refund_status !== 'not_requested' || reservation.amount_refunded_cents !== 0) {
          throw new VideoAccessError(409, 'Die bestätigte Zahlung gehört nicht zu dieser Anmeldung.')
        }
      }
      return { occurrence, owner, bookingId: booking?.id ?? null, name: owner ? coach?.display_name ?? 'Coach' : 'Teilnehmer' }
    }
    const initial = await load()
    const access = await createVideoAccess({
      kind: 'group', identity: id, startsAt: occurrenceStart, durationMinutes: initial.occurrence.duration_minutes,
      userId: user.id, userName: initial.name, isOwner: initial.owner,
      reauthorize: async () => {
        const fresh = await load()
        if (fresh.owner !== initial.owner || fresh.bookingId !== initial.bookingId
          || fresh.occurrence.duration_minutes !== initial.occurrence.duration_minutes) {
          throw new VideoAccessError(409, 'Die Anmeldung wurde inzwischen geändert. Bitte lade die Seite neu.')
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
