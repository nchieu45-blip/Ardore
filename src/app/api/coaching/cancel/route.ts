import { after, NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'
import { processCoachingRefund, type CoachingRefundBooking, type CoachingRefundRequest } from '@/lib/coaching-refund'

interface CancellationResult {
  error?: string
  policy_hours?: number
  booking: CoachingRefundBooking & { buyer_name: string; buyer_email: string; scheduled_at: string }
  refund: CoachingRefundRequest | null
  actor_role: 'buyer' | 'creator'
  creator_user_id: string
  creator_display_name: string
  newly_cancelled: boolean
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  let bookingId: unknown
  try { ({ bookingId } = await req.json()) } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 })
  }
  if (typeof bookingId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bookingId)) {
    return NextResponse.json({ error: 'Ungültige Buchungs-ID' }, { status: 400 })
  }
  const service = await createServiceClient()
  // Only this server-authenticated identity is passed to the service-only RPC.
  // Row locks prevent cancellation, rescheduling and repeated claims racing.
  const { data, error } = await service.rpc('cancel_coaching_booking', {
    p_booking_id: bookingId, p_actor_user_id: user.id,
  })
  if (error || !data) return NextResponse.json({ error: 'Stornierung konnte nicht geprüft werden.' }, { status: 500 })
  const result = data as CancellationResult
  if (result.error) {
    const errors: Record<string, { status: number; error: string }> = {
      not_found: { status: 404, error: 'Buchung nicht gefunden' },
      forbidden: { status: 403, error: 'Keine Berechtigung' },
      not_cancellable: { status: 400, error: 'Diese Buchung kann nicht storniert werden. Bereits abgeschlossene Sessions sind ausgeschlossen.' },
      policy_unavailable: { status: 409, error: 'Die bei Buchung vereinbarte Stornierungsfrist ist nicht verfügbar. Bitte kontaktiere den Ardore-Support.' },
      policy_violation: { status: 403, error: `Stornierungen sind nur bis ${result.policy_hours} Stunden vor dem Termin kostenlos möglich.` },
      payment_not_valid: { status: 409, error: 'Die Zahlung muss vor einer Stornierung vom Ardore-Support geprüft werden.' },
    }
    const refusal = errors[result.error] ?? { status: 500, error: 'Stornierung konnte nicht geprüft werden.' }
    return NextResponse.json({ error: refusal.error,
      ...(result.error === 'policy_violation' ? { policyViolation: true } : {}),
      ...(result.error === 'policy_unavailable' ? { policyUnavailable: true } : {}),
    }, { status: refusal.status })
  }
  const booking = result.booking
  if (!booking || booking.status !== 'cancelled') return NextResponse.json({ error: 'Stornierung konnte nicht bestätigt werden.' }, { status: 500 })

  if (result.newly_cancelled) {
  const scheduledDate = new Date(booking.scheduled_at).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin',
  })
  const scheduledTime = new Date(booking.scheduled_at).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin',
  })

  const cancelledByRole = result.actor_role
  const isBuyer = cancelledByRole === 'buyer'
  const isCreator = cancelledByRole === 'creator'
  const cp = { user_id: result.creator_user_id, display_name: result.creator_display_name }

  // Notify and email the other party
  after(async () => {
    try {
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
      console.error('[cancel notification] delivery failed', e instanceof Error ? e.name : 'unknown')
    }
  })

  }
  if (!result.refund) return NextResponse.json({ ok: true, refundStatus: 'not_requested', refundAmountCents: 0 })
  try {
    const refund = await processCoachingRefund({ service, booking, request: result.refund })
    if (refund.state === 'failed') {
      return NextResponse.json({ ok: false, bookingCancelled: true, refundStatus: 'failed',
        error: 'Die Session ist storniert. Die Erstattung konnte noch nicht bestätigt werden. Bitte versuche es erneut oder kontaktiere den Ardore-Support.',
      }, { status: 503 })
    }
    return NextResponse.json({ ok: true, refundStatus: refund.state, refundAmountCents: refund.amountCents },
      { status: refund.state === 'pending' ? 202 : 200 })
  } catch {
    return NextResponse.json({ ok: false, bookingCancelled: true, refundStatus: 'failed',
      error: 'Die Session ist storniert. Der Erstattungsstatus ist noch nicht bestätigt. Bitte kontaktiere den Ardore-Support.',
    }, { status: 503 })
  }
}
