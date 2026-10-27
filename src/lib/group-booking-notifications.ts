import type { SupabaseClient } from '@supabase/supabase-js'
import { appOrigin } from '@/lib/app-url'
import { checkNotificationPreference, createNotification } from '@/lib/notifications'

/** Best-effort confirmation after the atomic first fulfillment, never Checkout return. */
export async function notifyGroupBookingConfirmed(service: SupabaseClient, reservationId: string) {
  try {
    const { data: r, error } = await service.from('group_booking_reservations')
      .select('id,buyer_id,creator_id,class_title,occurrence_start,duration_minutes,price_cents,stripe_livemode,status,booking_id,refund_status')
      .eq('id', reservationId).maybeSingle()
    if (error || !r || r.status !== 'confirmed' || !r.booking_id || r.refund_status !== 'not_requested'
      || (r.price_cents > 0 && r.stripe_livemode !== true)) return
    const [{ data: coach }, buyerRes] = await Promise.all([
      service.from('creator_profiles').select('user_id,display_name').eq('id', r.creator_id).maybeSingle(),
      service.auth.admin.getUserById(r.buyer_id),
    ])
    const buyer = buyerRes.data.user
    if (!coach?.user_id || !buyer) return
    const scheduleLabel = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', weekday: 'long', day: 'numeric',
      month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(r.occurrence_start)) + ' Uhr'
    const participantName = typeof buyer.user_metadata?.full_name === 'string' ? buyer.user_metadata.full_name : 'Ein Teilnehmer'
    const [inapp, email, send] = await Promise.all([
      checkNotificationPreference(coach.user_id, 'new_video_class_booking', 'inapp'),
      checkNotificationPreference(coach.user_id, 'new_video_class_booking', 'email'),
      import('@/lib/email/send'),
    ])
    const coachUser = email ? await service.auth.admin.getUserById(coach.user_id) : null
    const jobs: Promise<unknown>[] = []
    // Private provider room URLs/tokens are never persisted or emailed. Entry
    // remains authenticated and time-limited through the buyer dashboard.
    if (buyer.email) jobs.push(send.sendVideoClassConfirmation(buyer.email, {
      classTitle: r.class_title, coachName: coach.display_name, scheduleLabel, durationMinutes: r.duration_minutes,
      roomUrl: null, bookingsUrl: `${appOrigin()}/buyer/video-classes`,
    }))
    if (inapp) jobs.push(createNotification({ userId: coach.user_id, type: 'new_video_class_booking',
      title: `Neue Anmeldung: ${r.class_title}`, message: `${participantName} hat sich für deinen Kurs am ${scheduleLabel} angemeldet.`,
      link: '/creator/settings/video-classes' }))
    if (email) {
      if (coachUser?.data.user?.email) jobs.push(send.sendVideoClassNewParticipant(coachUser.data.user.email, {
        coachName: coach.display_name, participantName, classTitle: r.class_title, scheduleLabel,
        dashboardUrl: `${appOrigin()}/creator/settings/video-classes`,
      }))
    }
    await Promise.allSettled(jobs)
  } catch { /* Notification failure cannot change a confirmed payment/booking. */ }
}
