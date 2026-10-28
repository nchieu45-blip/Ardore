import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { berlinDateTimeToIso, isValidDateString, isValidTimeString } from '@/lib/coaching-slots'
import { runCoachingEmails } from '@/lib/coaching-emails'
import { validateCoachingSlot } from '@/lib/coaching-booking'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const { bookingId, newDate, newTime } = body ?? {}
  if (typeof bookingId !== 'string' || !/^[0-9a-f-]{36}$/i.test(bookingId) || !isValidDateString(newDate) || !isValidTimeString(newTime)) {
    return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, buyer_id, buyer_name, buyer_email, scheduled_at, duration_minutes, cancellation_policy_hours, status, payment_status, stripe_livemode, creator_id, creator_profiles!inner(user_id, display_name, slug)')
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

  const requestedStart = berlinDateTimeToIso(newDate, newTime)
  if (requestedStart && Date.parse(requestedStart) === Date.parse(booking.scheduled_at)) {
    after(async () => { await runCoachingEmails(bookingId) })
    return NextResponse.json({ ok: true, unchanged: true })
  }

  const sessionEnd = new Date(booking.scheduled_at).getTime() + booking.duration_minutes * 60_000
  if (!Number.isFinite(sessionEnd) || sessionEnd <= Date.now()) {
    return NextResponse.json({ error: 'Abgeschlossene Termine können nicht verschoben werden.' }, { status: 409 })
  }

  if (Date.parse(booking.scheduled_at) <= Date.now() + 15 * 60_000) {
    return NextResponse.json({ error: 'Der Videoraum ist bereits geöffnet. Dieser Termin kann nicht mehr verschoben werden.' }, { status: 409 })
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

  after(async () => {
    const label = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'full', timeStyle: 'short' }).format(newScheduledAt)
    await Promise.allSettled([runCoachingEmails(bookingId),
      ...(booking.buyer_id ? [createNotification({ userId: booking.buyer_id, type: 'booking_confirmed', title: 'Session verschoben', message: `Dein neuer Termin: ${label} Uhr.`, link: `/session/${bookingId}` })] : []),
      ...(cp?.user_id ? [createNotification({ userId: cp.user_id, type: 'new_booking', title: 'Session verschoben', message: `Neuer Termin mit ${booking.buyer_name}: ${label} Uhr.`, link: '/creator/sessions' })] : []),
    ])
  })
  return NextResponse.json({ ok: true })
}
