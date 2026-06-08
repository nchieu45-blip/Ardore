import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId } = await req.json()
  if (!bookingId) return NextResponse.json({ error: 'Fehlende Buchungs-ID' }, { status: 400 })

  const { data: booking } = await supabase
    .from('bookings')
    .select('id, buyer_id, buyer_name, buyer_email, scheduled_at, duration_minutes, status, creator_id, is_subscription_session, creator_profiles!inner(user_id, display_name, slug)')
    .eq('id', bookingId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  if (booking.status !== 'confirmed') return NextResponse.json({ error: 'Buchung kann nicht storniert werden' }, { status: 400 })

  const cp = Array.isArray(booking.creator_profiles) ? booking.creator_profiles[0] : booking.creator_profiles
  const isBuyer   = booking.buyer_id === user.id
  const isCreator = cp?.user_id === user.id
  if (!isBuyer && !isCreator) return NextResponse.json({ error: 'Keine Berechtigung' }, { status: 403 })

  // Policy check: buyers are blocked within the cancellation window; coaches can always cancel
  if (isBuyer) {
    const { data: offer } = await supabase
      .from('coaching_offers')
      .select('cancellation_policy_hours')
      .eq('creator_id', booking.creator_id)
      .single()

    const policyHours = (offer as { cancellation_policy_hours?: number } | null)?.cancellation_policy_hours ?? 24
    const msUntilSession = new Date(booking.scheduled_at).getTime() - Date.now()
    if (msUntilSession < policyHours * 3_600_000) {
      return NextResponse.json({
        error: `Stornierungen sind nur bis ${policyHours} Stunden vor dem Termin kostenlos möglich.`,
        policyViolation: true,
      }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId)

  if (error) return NextResponse.json({ error: 'Fehler beim Stornieren' }, { status: 500 })

  // Subscription session: no counter to update — remaining sessions are computed
  // dynamically by counting non-cancelled bookings, so cancelling restores the allowance automatically.

  // Stripe refund: not applicable — 1:1 session payment is not collected via Stripe.

  const scheduledDate = new Date(booking.scheduled_at).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const scheduledTime = new Date(booking.scheduled_at).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit',
  })

  const cancelledByRole: 'buyer' | 'creator' = isBuyer ? 'buyer' : 'creator'

  // Notify and email the other party
  ;(async () => {
    try {
      const service = await createServiceClient()
      const { sendSessionCancellation } = await import('@/lib/email/send')

      if (isBuyer && cp?.user_id) {
        // Notify coach
        await createNotification({
          userId: cp.user_id,
          type: 'new_booking',
          title: 'Session storniert',
          message: `${booking.buyer_name} hat die Session am ${scheduledDate} um ${scheduledTime} Uhr storniert.`,
          link: '/creator/sessions',
        })
        const { data: { user: creatorUser } } = await service.auth.admin.getUserById(cp.user_id)
        if (creatorUser?.email) {
          await sendSessionCancellation(creatorUser.email, {
            recipientName: cp.display_name,
            otherPartyName: booking.buyer_name,
            scheduledDate,
            scheduledTime,
            cancelledByRole,
          })
        }
      } else if (isCreator && booking.buyer_id) {
        // Notify buyer
        await createNotification({
          userId: booking.buyer_id,
          type: 'booking_confirmed',
          title: 'Session storniert',
          message: `${cp?.display_name ?? 'Dein Coach'} hat die Session am ${scheduledDate} um ${scheduledTime} Uhr storniert.`,
          link: '/buyer/sessions',
        })
        await sendSessionCancellation(booking.buyer_email, {
          recipientName: booking.buyer_name,
          otherPartyName: cp?.display_name ?? 'Dein Coach',
          scheduledDate,
          scheduledTime,
          cancelledByRole,
        })
      }
    } catch (e) {
      console.error('[cancel notification]', e)
    }
  })()

  return NextResponse.json({ ok: true })
}
