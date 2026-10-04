import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'
import { calculateArdorePlatformFee } from '@/lib/stripe/platformFee'
import { reconcileCoachingCheckout } from '@/lib/coaching-payment-lifecycle'
import { recoverCreatingCoachingCheckout } from '@/lib/coaching-checkout-recovery'
import { ConnectReadinessError, configuredStripeLivemode, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'
import { createSettlementOrder, registerSettlementCheckout } from '@/lib/stripe/settlement'

export const COACHING_RESERVATION_MINUTES = 31

type Booking = {
  id: string; buyer_id: string; creator_id: string; buyer_email: string; scheduled_at: string;
  duration_minutes: number; price_cents: number; status: string; payment_status: string;
  cancellation_policy_hours: number | null; stripe_livemode: boolean | null; refund_status: string;
  current_payment_attempt_id: string | null; is_subscription_session: boolean; stripe_checkout_session_id: string | null;
  discount_id?: string | null; booking_request_key?: string | null;
}

type Attempt = {
  id: string; booking_id: string; provider_state: string; stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null; checkout_url: string | null; stripe_livemode: boolean;
  checkout_idempotency_key: string; reservation_expires_at: string; created_at: string;
  price_cents: number; destination_account_id: string | null; application_fee_cents: number;
  charge_architecture?: 'destination' | 'separate';
}

type Claim = { booking?: Booking; attempt?: Attempt; created?: boolean; registered?: boolean; error?: string }
export type CoachingCheckoutResult = {
  status: number; bookingId?: string; checkoutUrl?: string | null; cancellationPolicyHours?: number | null;
  confirmed?: boolean; paymentPending?: boolean; refundStatus?: string; error?: string;
}

function response(booking: Booking, extra: Partial<CoachingCheckoutResult> = {}): CoachingCheckoutResult {
  return { status: 200, bookingId: booking.id, cancellationPolicyHours: booking.cancellation_policy_hours, ...extra }
}

function unavailable(error: string): CoachingCheckoutResult {
  const messages: Record<string, string> = {
    slot_unavailable: 'Dieser Termin ist inzwischen belegt. Bitte wähle einen anderen Termin.',
    forbidden: 'Keine Berechtigung für diese Buchung.',
    not_found: 'Buchung nicht gefunden.',
    not_payable: 'Diese Buchung kann nicht erneut bezahlt werden.',
    stale_attempt: 'Der Zahlungsstatus hat sich geändert. Bitte lade die Buchung erneut.',
    mode_mismatch: 'Der Zahlungsmodus dieser Buchung stimmt nicht überein.',
  }
  return { status: error === 'forbidden' ? 403 : error === 'not_found' ? 404 : 409, error: messages[error] ?? messages.not_payable }
}

function appUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com'
  return `${raw.startsWith('http') ? raw : `https://${raw}`}`.replace(/\/$/, '')
}

function intentId(session: Stripe.Checkout.Session) {
  return typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
}

function confirmedOrReconciled(booking: Booking): CoachingCheckoutResult | null {
  if (booking.status === 'confirmed' && booking.payment_status === 'paid') return response(booking, { confirmed: true })
  if (booking.refund_status !== 'not_requested' || ['refunded', 'partially_refunded'].includes(booking.payment_status)) {
    return response(booking, { status: 202, paymentPending: true, refundStatus: booking.refund_status })
  }
  return null
}

async function ensureSettlementOrder(service: SupabaseClient, booking: Booking, attempt: Attempt) {
  if (attempt.charge_architecture !== 'separate') return
  if (!attempt.destination_account_id) throw new Error('Missing agreed settlement account')
  await createSettlementOrder({ service, id: attempt.id, kind: 'booking',
    buyerId: booking.buyer_id, creatorId: booking.creator_id, accountId: attempt.destination_account_id,
    grossCents: attempt.price_cents, livemode: attempt.stripe_livemode,
    reference: { bookingId: booking.id, attemptId: attempt.id },
  })
}

/** Only trusted server callers can choose a booking; all commercial terms come from its frozen snapshot. */
export async function startOrResumeCoachingCheckout({
  service, bookingId, buyerId, provider = stripe,
}: { service: SupabaseClient; bookingId: string; buyerId: string; provider?: Stripe }): Promise<CoachingCheckoutResult> {
  let booking: Booking
  try {
    const { data, error } = await service.from('bookings').select('*').eq('id', bookingId).eq('buyer_id', buyerId).single()
    if (error || !data) return unavailable('not_found')
    booking = data as Booking
    const resolved = confirmedOrReconciled(booking)
    if (resolved) return resolved
    if (!['pending_payment', 'payment_failed', 'expired', 'reversed'].includes(booking.status)
      || !['pending', 'failed', 'expired', 'unpaid', 'reversed'].includes(booking.payment_status)
      || booking.is_subscription_session || !Number.isSafeInteger(booking.price_cents) || booking.price_cents < 50
      || new Date(booking.scheduled_at).getTime() <= Date.now()) return unavailable('not_payable')
    const stripeLivemode = configuredStripeLivemode()
    if (booking.stripe_livemode !== stripeLivemode) return unavailable('mode_mismatch')

    if (!booking.current_payment_attempt_id && booking.stripe_checkout_session_id) {
      const legacy = await reconcileCoachingCheckout({ service, sessionId: booking.stripe_checkout_session_id, stripeLivemode })
      if (!legacy.booking?.current_payment_attempt_id) throw new Error('Legacy checkout could not be reconciled')
      booking = { ...booking, ...legacy.booking }
      const legacySettled = confirmedOrReconciled(booking)
      if (legacySettled) return legacySettled
      if (legacy.needs_reconciliation || legacy.providerState === 'processing' || legacy.providerState === 'paid') return response(booking, { status: 202, paymentPending: true })
    }

    let attempt: Attempt | null = null
    let replaceAttemptId: string | null = null
    if (booking.current_payment_attempt_id) {
      const { data: current, error: currentError } = await service.from('coaching_payment_attempts').select('*')
        .eq('id', booking.current_payment_attempt_id).eq('booking_id', booking.id).single()
      if (currentError || !current) throw new Error('Missing current coaching payment attempt')
      attempt = current as Attempt

      if (attempt.stripe_checkout_session_id) {
        let session = await provider.checkout.sessions.retrieve(attempt.stripe_checkout_session_id)
        // Stripe remains the authority: the browser returning from Checkout cannot
        // release a hold or create another payable attempt on its own.
        if (session.status === 'open' && session.expires_at <= Math.floor(Date.now() / 1000)) {
          await provider.checkout.sessions.expire(session.id)
          session = await provider.checkout.sessions.retrieve(session.id)
        }
        const reconciled = await reconcileCoachingCheckout({ service, sessionId: session.id, stripeLivemode })
        if (reconciled.booking) booking = { ...booking, ...reconciled.booking }
        if (reconciled.attempt) attempt = { ...attempt, ...reconciled.attempt }
        const settled = confirmedOrReconciled(booking)
        if (settled) return settled
        if (reconciled.needs_reconciliation || reconciled.providerState === 'processing' || reconciled.providerState === 'paid') {
          return response(booking, { status: 202, paymentPending: true })
        }
        if (session.status === 'open') {
          const readyCoach = await requirePayoutReadyCoach(service, booking.creator_id, provider)
          if (attempt.destination_account_id !== readyCoach.accountId) {
            return { status: 409, error: 'Diese Zahlungsanfrage kann nicht sicher fortgesetzt werden. Bitte kontaktiere den Support.' }
          }
          if (!session.url) throw new Error('Open checkout URL unavailable')
          await ensureSettlementOrder(service, booking, attempt)
          if (attempt.charge_architecture === 'separate') {
            await registerSettlementCheckout({ service, orderId: attempt.id, sessionId: session.id })
          }
          return response(booking, { checkoutUrl: session.url })
        }

        const currentIntentId = intentId(session)
        if (currentIntentId) {
          const intent = await provider.paymentIntents.retrieve(currentIntentId)
          if (['processing', 'succeeded', 'requires_capture'].includes(intent.status)) {
            return response(booking, { status: 202, paymentPending: true })
          }
          // Stripe owns Checkout PaymentIntents: they cannot be canceled
          // directly unless awaiting capture. A closed Checkout with a failed,
          // unpaid intent is non-payable through Checkout and can be replaced.
          // Keep its exact attempt so an unexpected later success is reconciled.
          const terminalFailed = intent.status === 'requires_payment_method' && intent.amount_received === 0
            && (session.status === 'expired' || (session.status === 'complete' && session.payment_status === 'unpaid'))
          if (intent.status !== 'canceled' && !terminalFailed) return response(booking, { status: 202, paymentPending: true })
        }
        if (!['expired', 'canceled', 'failed'].includes(attempt.provider_state)) {
          return response(booking, { status: 202, paymentPending: true })
        }
        replaceAttemptId = attempt.id
      } else if (attempt.provider_state !== 'creating') {
        replaceAttemptId = attempt.id
      }
    }

    if (booking.discount_id && booking.booking_request_key) {
      const { data: snapshot, error } = await service.from('discount_redemptions').select('*').eq('id', booking.booking_request_key).single()
      if (error || !snapshot) throw new Error('Discount reservation unavailable')
      const { data: renewed, error: renewalError } = await service.rpc('reserve_discount_redemption', {
        p_id: snapshot.id, p_discount_id: booking.discount_id, p_buyer_id: buyerId, p_creator_id: booking.creator_id,
        p_kind: 'sessions', p_original_cents: snapshot.original_cents, p_product_ids: [], p_tier_id: null,
      })
      if (renewalError) throw new Error('Discount reservation unavailable')
      if (!renewed || renewed.error || renewed.final_cents !== booking.price_cents) {
        return { status: 409, error: 'Der Rabatt ist für einen erneuten Zahlungsversuch nicht mehr verfügbar. Bitte kontaktiere den Support.' }
      }
    }
    const readyCoach = await requirePayoutReadyCoach(service, booking.creator_id, provider)
    const reservationExpiresAt = new Date(Date.now() + COACHING_RESERVATION_MINUTES * 60_000).toISOString()
    const { data: claimData, error: claimError } = await service.rpc('begin_coaching_payment_attempt', {
      p_booking_id: booking.id, p_buyer_id: buyerId, p_livemode: stripeLivemode, p_expires_at: reservationExpiresAt,
      p_replace_attempt_id: replaceAttemptId,
      p_destination_account_id: readyCoach.accountId,
      p_application_fee_cents: calculateArdorePlatformFee(booking.price_cents),
      p_charge_architecture: 'separate',
    })
    if (claimError || !claimData) throw new Error('Payment attempt could not be claimed')
    const claim = claimData as Claim
    if (claim.error) return unavailable(claim.error)
    if (!claim.booking || !claim.attempt) throw new Error('Invalid checkout claim')
    booking = claim.booking
    attempt = claim.attempt
    if (claim.created && attempt.charge_architecture !== 'separate') {
      throw new Error('New payment attempt is missing its settlement architecture')
    }
    // Reused attempts retain their original financial target. A changed
    // connection must never silently redirect an existing payment.
    if (attempt.destination_account_id !== readyCoach.accountId) {
      return { status: 409, error: 'Diese Zahlungsanfrage kann nicht sicher fortgesetzt werden. Bitte kontaktiere den Support.' }
    }
    if (attempt.stripe_checkout_session_id) {
      const existing = await provider.checkout.sessions.retrieve(attempt.stripe_checkout_session_id)
      await ensureSettlementOrder(service, booking, attempt)
      if (attempt.charge_architecture === 'separate') {
        await registerSettlementCheckout({ service, orderId: attempt.id, sessionId: existing.id })
      }
      return existing.status === 'open' && existing.url
        ? response(booking, { checkoutUrl: existing.url })
        : response(booking, { status: 202, paymentPending: true })
    }
    if (attempt.provider_state !== 'creating') return response(booking, { status: 202, paymentPending: true })

    // Freeze coach ownership and earnings before creating a payable provider
    // object. Separate charges move no money until successful fulfillment.
    await ensureSettlementOrder(service, booking, attempt)

    // Recover a provider response lost before registering the session. Beyond
    // Stripe's idempotency-key retention we never blindly create another session.
    if (Date.now() - new Date(attempt.created_at).getTime() >= 23 * 3_600_000) {
      const recovered = await recoverCreatingCoachingCheckout({ service, attemptId: attempt.id, bookingId: booking.id, provider })
      if (!recovered.sessionId) throw new Error('Unknown historical checkout creation result')
      return response(booking, { status: 202, paymentPending: true })
    }

    const metadata = { checkout_type: 'coaching_session', booking_id: booking.id, payment_attempt_id: attempt.id,
      buyer_id: booking.buyer_id, creator_id: booking.creator_id, scheduled_at: booking.scheduled_at,
      ...(attempt.charge_architecture === 'separate' ? { ardore_order_id: attempt.id } : {}) }
    let session: Stripe.Checkout.Session
    try {
      session = await provider.checkout.sessions.create({
        mode: 'payment', customer_email: booking.buyer_email,
        line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: attempt.price_cents,
          product_data: { name: '1:1 Coaching', metadata: { booking_id: booking.id } } } }],
        metadata,
        payment_intent_data: { metadata,
          ...(attempt.charge_architecture === 'separate' ? { transfer_group: `ardore-order-${attempt.id}` } : {}),
          ...(attempt.charge_architecture !== 'separate' && attempt.destination_account_id
          ? { application_fee_amount: attempt.application_fee_cents, transfer_data: { destination: attempt.destination_account_id } } : {}) },
        expires_at: Math.floor(new Date(attempt.reservation_expires_at).getTime() / 1000),
        success_url: `${appUrl()}/buyer/sessions?checkout=success&booking=${booking.id}`,
        cancel_url: `${appUrl()}/buyer/sessions?checkout=cancelled&booking=${booking.id}`,
      }, { idempotencyKey: attempt.checkout_idempotency_key })
    } catch (error) {
      const stripeError = error as { type?: string; code?: string }
      if (claim.created && stripeError.type === 'StripeInvalidRequestError' && !['idempotency_key_in_use', 'idempotency_error'].includes(stripeError.code ?? '')) {
        await service.rpc('fail_coaching_checkout_creation', { p_attempt_id: attempt.id, p_error_code: 'checkout_rejected' })
      }
      // Network errors and 5xx responses can hide a created payable session.
      // Its durable attempt stays creating so a retry uses exactly the same key.
      throw new Error('Checkout creation could not be confirmed')
    }
    if (attempt.charge_architecture === 'separate') {
      await registerSettlementCheckout({ service, orderId: attempt.id, sessionId: session.id })
    }
    const { data: registeredData, error: registrationError } = await service.rpc('register_coaching_checkout', {
      p_attempt_id: attempt.id, p_session_id: session.id, p_session_url: session.url,
    })
    if (registrationError || !registeredData || (registeredData as Claim).error) throw new Error('Checkout session could not be registered')
    if (!session.url || session.status !== 'open') {
      const latest = await reconcileCoachingCheckout({ service, sessionId: session.id, stripeLivemode })
      if (latest.booking) booking = { ...booking, ...latest.booking }
      return confirmedOrReconciled(booking) ?? response(booking, { status: 202, paymentPending: true })
    }
    return response(booking, { checkoutUrl: session.url })
  } catch (error) {
    if (error instanceof ConnectReadinessError) return { status: error.status, bookingId, error: error.message }
    return { status: 503, bookingId, error: 'Der Zahlungsstatus konnte noch nicht sicher bestätigt werden. Bitte versuche es erneut; starte keine zusätzliche Buchung.' }
  }
}
