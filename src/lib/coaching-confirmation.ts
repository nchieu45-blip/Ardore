import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'

export async function provisionConfirmedCoachingBooking(bookingId: string) {
  const service = await createServiceClient()
  const { data: booking, error } = await service
    .from('bookings')
    .select('id, creator_id, buyer_id, buyer_email, buyer_name, scheduled_at, duration_minutes, daily_room_name, daily_room_url, creator_profiles(display_name, user_id)')
    .eq('id', bookingId)
    .single()
  if (error || !booking) return

  let roomName = booking.daily_room_name
  let roomUrl = booking.daily_room_url
  if (VIDEO_CALLS_ENABLED && !roomName && process.env.DAILY_API_KEY) {
    try {
      const roomExp = Math.floor(new Date(booking.scheduled_at).getTime() / 1000)
        + (booking.duration_minutes + 30) * 60
      const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          privacy: 'private',
          properties: { exp: roomExp, max_participants: 2, enable_chat: true, enable_screenshare: false },
        }),
      })
      if (response.ok) {
        const room = await response.json() as { name: string; url: string }
        roomName = room.name
        roomUrl = room.url
        await service.from('bookings').update({ daily_room_name: roomName, daily_room_url: roomUrl }).eq('id', bookingId)
      }
    } catch { /* Daily provisioning is recoverable and must not undo payment. */ }
  }

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
    const [{ sendBookingConfirmation }, creatorUser] = await Promise.all([
      import('@/lib/email/send'),
      service.auth.admin.getUserById(creator.user_id),
    ])
    await Promise.allSettled([
      sendBookingConfirmation(booking.buyer_email, {
        recipientName: booking.buyer_name, coachName: creator.display_name,
        scheduledDate, scheduledTime, durationMinutes: booking.duration_minutes, sessionUrl, role: 'buyer',
      }),
      creatorUser.data.user?.email
        ? sendBookingConfirmation(creatorUser.data.user.email, {
            recipientName: creator.display_name, coachName: booking.buyer_name,
            scheduledDate, scheduledTime, durationMinutes: booking.duration_minutes, sessionUrl, role: 'creator',
          })
        : Promise.resolve(),
    ])
  } catch { /* Notification delivery is best-effort. */ }
}
