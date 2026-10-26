import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { hasValidCoachingPayment } from '@/lib/coaching-payment'

export async function provisionConfirmedCoachingBooking(bookingId: string) {
  const service = await createServiceClient()
  const { data: booking, error } = await service
    .from('bookings')
    .select('id, creator_id, buyer_id, buyer_email, buyer_name, scheduled_at, duration_minutes, status, payment_status, stripe_livemode, creator_profiles(display_name, user_id)')
    .eq('id', bookingId)
    .single()
  if (error || !booking || booking.status !== 'confirmed' || !hasValidCoachingPayment(booking)) return

  // Video rooms and per-participant tokens are provisioned lazily by the
  // authenticated join endpoint. Confirmation never creates a provider room.

  const creator = Array.isArray(booking.creator_profiles)
    ? booking.creator_profiles[0]
    : booking.creator_profiles
  if (!creator) return

  const date = new Date(booking.scheduled_at)
  const scheduledDate = date.toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin',
  })
  const scheduledTime = date.toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  })
  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com'
  const appUrl = `${rawAppUrl.startsWith('http') ? rawAppUrl : `https://${rawAppUrl}`}`.replace(/\/$/, '')
  const sessionUrl = `${appUrl}/session/${booking.id}`

  createNotification({
    userId: creator.user_id,
    type: 'new_booking',
    title: 'Neue Session gebucht',
    message: `${booking.buyer_name} hat eine ${booking.duration_minutes}-Min.-Session am ${scheduledDate} um ${scheduledTime} Uhr gebucht.`,
    link: '/creator/sessions',
  }).catch(() => {})
  if (booking.buyer_id) {
    createNotification({
      userId: booking.buyer_id,
      type: 'booking_confirmed',
      title: 'Session bestätigt',
      message: `Deine Session mit ${creator.display_name} am ${scheduledDate} um ${scheduledTime} Uhr ist bestätigt.`,
      link: `/session/${booking.id}`,
    }).catch(() => {})
  }

  try {
    const { data: meeting } = await service.from('booking_meeting_links')
      .select('booking_id').eq('booking_id', booking.id).maybeSingle()
    const meetingReady = Boolean(meeting)
    const [{ sendBookingConfirmation }, creatorUser] = await Promise.all([
      import('@/lib/email/send'),
      service.auth.admin.getUserById(creator.user_id),
    ])
    await Promise.allSettled([
      sendBookingConfirmation(booking.buyer_email, {
        recipientName: booking.buyer_name, coachName: creator.display_name,
        scheduledDate, scheduledTime, durationMinutes: booking.duration_minutes, sessionUrl, role: 'buyer', meetingReady,
      }),
      creatorUser.data.user?.email
        ? sendBookingConfirmation(creatorUser.data.user.email, {
            recipientName: creator.display_name, coachName: booking.buyer_name,
            scheduledDate, scheduledTime, durationMinutes: booking.duration_minutes, sessionUrl, role: 'creator', meetingReady,
          })
        : Promise.resolve(),
    ])
  } catch { /* Notification delivery is best-effort. */ }
}
