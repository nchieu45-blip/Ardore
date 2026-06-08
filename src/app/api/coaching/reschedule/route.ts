import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { getWindowsForDate, generateSlots } from '@/lib/coaching-slots'

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
    .select('id, buyer_id, buyer_name, buyer_email, scheduled_at, duration_minutes, status, creator_id, daily_room_name, creator_profiles!inner(user_id, display_name, slug)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  if (booking.status !== 'confirmed') return NextResponse.json({ error: 'Buchung kann nicht verschoben werden' }, { status: 400 })

  const cp = Array.isArray(booking.creator_profiles) ? booking.creator_profiles[0] : booking.creator_profiles
  const isBuyer   = booking.buyer_id === user.id
  const isCreator = cp?.user_id === user.id
  if (!isBuyer && !isCreator) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  // Policy check: both buyer and creator are blocked within the cancellation/reschedule window
  const { data: offer } = await supabase
    .from('coaching_offers')
    .select('is_enabled, duration_minutes, buffer_minutes, min_notice_hours, max_horizon_days, cancellation_policy_hours')
    .eq('creator_id', booking.creator_id)
    .single()

  if (!offer?.is_enabled) return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })

  const policyHours = (offer as { cancellation_policy_hours?: number } | null)?.cancellation_policy_hours ?? 24
  const msUntilSession = new Date(booking.scheduled_at).getTime() - Date.now()
  if (msUntilSession < policyHours * 3_600_000) {
    return NextResponse.json({
      error: `Verschiebungen sind nur bis ${policyHours} Stunden vor dem Termin möglich.`,
      policyViolation: true,
    }, { status: 403 })
  }

  // Validate new slot server-side — exclude the current booking to avoid self-conflict
  const [recurringRes, overridesRes, bookingsRes] = await Promise.all([
    supabase.from('availability_slots').select('day_of_week, start_time, end_time').eq('creator_id', booking.creator_id),
    supabase.from('date_overrides').select('date, type, start_time, end_time').eq('creator_id', booking.creator_id).eq('date', newDate),
    supabase.from('bookings')
      .select('scheduled_at, duration_minutes')
      .eq('creator_id', booking.creator_id)
      .neq('status', 'cancelled')
      .neq('id', bookingId)
      .gte('scheduled_at', `${newDate}T00:00:00Z`)
      .lte('scheduled_at', `${newDate}T23:59:59Z`),
  ])

  const durationMin  = offer.duration_minutes ?? 60
  const bufferMin    = offer.buffer_minutes ?? 0
  const minNoticeHrs = offer.min_notice_hours ?? 24
  const earliestUtcMs = Date.now() + minNoticeHrs * 3_600_000

  const windows = getWindowsForDate(
    newDate,
    recurringRes.data ?? [],
    (overridesRes.data ?? []) as { date: string; type: 'available' | 'unavailable'; start_time: string | null; end_time: string | null }[],
  )

  const availableSlots = generateSlots(
    newDate,
    windows,
    durationMin,
    bufferMin,
    (bookingsRes.data ?? []) as { scheduled_at: string; duration_minutes: number }[],
    earliestUtcMs,
  )

  if (!availableSlots.includes(newTime)) {
    return NextResponse.json({ error: 'Dieser Zeitslot ist nicht mehr verfügbar.' }, { status: 409 })
  }

  const newScheduledAt = new Date(`${newDate}T${newTime}:00`)
  const oldScheduledAt = new Date(booking.scheduled_at)

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ scheduled_at: newScheduledAt.toISOString() })
    .eq('id', bookingId)

  if (updateError) return NextResponse.json({ error: 'Fehler beim Verschieben' }, { status: 500 })

  // Update Daily.co room expiry to match new session time (best-effort)
  if (process.env.DAILY_API_KEY && booking.daily_room_name) {
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

  const fmtDate = (d: Date) => d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const fmtTime = (d: Date) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

  const oldDate = fmtDate(oldScheduledAt)
  const oldTime = fmtTime(oldScheduledAt)
  const newDateFmt = fmtDate(newScheduledAt)
  const newTimeFmt = fmtTime(newScheduledAt)

  ;(async () => {
    try {
      const service = await createServiceClient()
      const { sendRescheduleConfirmation } = await import('@/lib/email/send')
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health').replace(/\/$/, '')
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
