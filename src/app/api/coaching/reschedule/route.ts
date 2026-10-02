import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { validateCoachingSlot } from '@/lib/coaching-booking'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId, newDate, newTime } = await req.json()
  if (!bookingId || !newDate || !newTime) {
    return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, buyer_id, buyer_name, buyer_email, scheduled_at, duration_minutes, cancellation_policy_hours, status, payment_status, stripe_livemode, creator_id, daily_room_name, creator_profiles!inner(user_id, display_name, slug)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  if (booking.status !== 'confirmed') return NextResponse.json({ error: 'Buchung kann nicht verschoben werden' }, { status: 400 })
  if (!hasValidCoachingPayment(booking)) {
    return NextResponse.json({ error: 'Die Zahlung für diese Buchung ist nicht gültig.' }, { status: 400 })
  }

  const cp = Array.isArray(booking.creator_profiles) ? booking.creator_profiles[0] : booking.creator_profiles
  const isBuyer   = booking.buyer_id === user.id
  const isCreator = cp?.user_id === user.id
  if (!isBuyer && !isCreator) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  const sessionEnd = new Date(booking.scheduled_at).getTime() + booking.duration_minutes * 60_000
  if (!Number.isFinite(sessionEnd) || sessionEnd <= Date.now()) {
    return NextResponse.json({ error: 'Abgeschlossene Termine können nicht verschoben werden.' }, { status: 409 })
  }

  // Both participants use the cutoff agreed at booking, never a later offer edit.
  const { data: offer } = await supabase
    .from('coaching_offers')
    .select('is_enabled, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days')
    .eq('creator_id', booking.creator_id)
    .single()

  if (!offer?.is_enabled) return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })

  const policyHours = booking.cancellation_policy_hours as number | null
  if (policyHours === null || !Number.isInteger(policyHours) || policyHours < 0) {
    return NextResponse.json({
      error: 'Die bei Buchung vereinbarte Stornierungsfrist ist nicht verfügbar. Bitte kontaktiere den Ardore-Support.',
      policyUnavailable: true,
    }, { status: 409 })
  }
  const msUntilSession = new Date(booking.scheduled_at).getTime() - Date.now()
  if (msUntilSession < policyHours * 3_600_000) {
    return NextResponse.json({
      error: `Verschiebungen sind nur bis ${policyHours} Stunden vor dem Termin möglich.`,
      policyViolation: true,
    }, { status: 403 })
  }

  const durationMin = booking.duration_minutes
  const slotValidation = await validateCoachingSlot({
    creatorId: booking.creator_id,
    date: newDate,
    time: newTime,
    durationMinutes: durationMin,
    excludeBookingId: bookingId,
  })
  if (!slotValidation.ok) {
    return NextResponse.json({ error: slotValidation.error }, { status: slotValidation.status })
  }

  const newScheduledAt = new Date(slotValidation.scheduledAt)
  const oldScheduledAt = new Date(booking.scheduled_at)

  const service = await createServiceClient()
  const { data: updatedBooking, error: updateError } = await service
    .from('bookings')
    .update({ scheduled_at: newScheduledAt.toISOString(), buffer_minutes: slotValidation.bufferMinutes })
    .eq('id', bookingId)
    .eq('status', 'confirmed')
    .eq('scheduled_at', booking.scheduled_at)
    .select('id')
    .maybeSingle()

  if (updateError?.code === '23P01') {
    return NextResponse.json({ error: 'Dieser Zeitslot wurde gerade vergeben.' }, { status: 409 })
  }
  if (updateError) return NextResponse.json({ error: 'Fehler beim Verschieben' }, { status: 500 })
  if (!updatedBooking) {
    return NextResponse.json({ error: 'Die Buchung wurde inzwischen geändert. Bitte lade die Seite erneut.' }, { status: 409 })
  }

  // Update Daily.co room expiry to match new session time (best-effort)
  if (VIDEO_CALLS_ENABLED && process.env.DAILY_API_KEY && booking.daily_room_name) {
    const newRoomExp = Math.floor(newScheduledAt.getTime() / 1000) + (durationMin + 30) * 60
    fetch(`https://api.daily.co/v1/rooms/${booking.daily_room_name}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties: { exp: newRoomExp } }),
    }).catch(() => {})
  }

  const fmtDate = (d: Date) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' })
  const fmtTime = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })

  const oldDate = fmtDate(oldScheduledAt)
  const oldTime = fmtTime(oldScheduledAt)
  const newDateFmt = fmtDate(newScheduledAt)
  const newTimeFmt = fmtTime(newScheduledAt)

  ;(async () => {
    try {
      const { sendRescheduleConfirmation } = await import('@/lib/email/send')
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com').replace(/\/$/, '')
      const sessionUrl = `${appUrl}/session/${bookingId}`

      const sharedData = {
        oldDate, oldTime,
        newDate: newDateFmt, newTime: newTimeFmt,
        durationMinutes: durationMin,
        sessionUrl,
      }

      // Notify buyer
      if (booking.buyer_id) {
        await createNotification({
          userId: booking.buyer_id,
          type: 'booking_confirmed',
          title: 'Session verschoben',
          message: `Deine Session mit ${cp?.display_name ?? 'deinem Coach'} wurde auf ${newDateFmt} um ${newTimeFmt} Uhr verschoben.`,
          link: `/session/${bookingId}`,
        })
      }
      await sendRescheduleConfirmation(booking.buyer_email, {
        recipientName: booking.buyer_name,
        coachName: cp?.display_name ?? 'Dein Coach',
        ...sharedData,
        role: 'buyer',
      })

      // Notify coach
      if (cp?.user_id) {
        await createNotification({
          userId: cp.user_id,
          type: 'new_booking',
          title: 'Session verschoben',
          message: `Die Session mit ${booking.buyer_name} wurde auf ${newDateFmt} um ${newTimeFmt} Uhr verschoben.`,
          link: '/creator/sessions',
        })
        const { data: { user: creatorUser } } = await service.auth.admin.getUserById(cp.user_id)
        if (creatorUser?.email) {
          await sendRescheduleConfirmation(creatorUser.email, {
            recipientName: cp.display_name,
            coachName: booking.buyer_name,
            ...sharedData,
            role: 'creator',
          })
        }
      }
    } catch (e) {
      console.error('[reschedule notification]', e)
    }
  })()

  return NextResponse.json({ ok: true })
}
