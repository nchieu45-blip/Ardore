import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'
import { provisionConfirmedCoachingBooking } from '@/lib/coaching-confirmation'
import { processCoachingPaymentReconciliation } from '@/lib/coaching-payment-reconciliation'
import { recoverCreatingCoachingCheckout } from '@/lib/coaching-checkout-recovery'
import { recordSuccessfulSettlement, settlePayment } from '@/lib/stripe/settlement'

export type CoachingProviderState = 'open' | 'processing' | 'paid' | 'failed' | 'expired' | 'canceled'

interface LifecycleBooking {
  id: string
  buyer_id: string
  creator_id: string
  price_cents: number
  status: string
  payment_status: string
  stripe_livemode: boolean | null
  stripe_checkout_session_id: string | null
  current_payment_attempt_id: string | null
  reservation_expires_at: string | null
  fulfilled_payment_attempt_id?: string | null
}

interface LifecycleAttempt {
  id: string
  booking_id: string
  buyer_id: string
  creator_id: string
  price_cents: number
  stripe_livemode: boolean
  stripe_checkout_session_id: string | null
  stripe_payment_intent_id: string | null
  destination_account_id: string | null
  application_fee_cents: number
  legacy_checkout: boolean
  provider_state: string
  fulfillment_state: string
  charge_architecture?: 'destination' | 'separate'
}

export interface CoachingLifecycleResult {
  booking?: LifecycleBooking
  attempt?: LifecycleAttempt
  applied?: boolean
  newly_confirmed?: boolean
  needs_reconciliation?: boolean
  providerState?: CoachingProviderState
  ignored?: boolean
}

class CoachingLifecycleError extends Error {
  constructor(readonly code: string) { super(code) }
}

function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id ?? null
}

function configuredMode() {
  return process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true
}

function assertMode(livemode: boolean) {
  if (livemode !== configuredMode()) throw new CoachingLifecycleError('payment_mode_mismatch')
}

function metadataMatches(metadata: Stripe.Metadata | null, booking: LifecycleBooking, attempt: LifecycleAttempt) {
  return metadata?.checkout_type === 'coaching_session' && metadata.booking_id === booking.id
    && metadata.buyer_id === booking.buyer_id && metadata.creator_id === booking.creator_id
    && (attempt.legacy_checkout ? !metadata.payment_attempt_id : metadata.payment_attempt_id === attempt.id)
    && (attempt.charge_architecture !== 'separate' || metadata.ardore_order_id === attempt.id)
}

function providerState(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent | null): CoachingProviderState {
  // A failed card attempt is still retryable inside an open Checkout. Releasing
  // that hold would race another buyer against the customer's next card attempt.
  if (intent?.status === 'succeeded') return 'paid'
  if (intent?.status === 'processing' || intent?.status === 'requires_capture') return 'processing'
  if (intent?.status === 'canceled') return 'canceled'
  if (session.status === 'expired') return 'expired'
  if (session.status === 'complete') return intent?.status === 'requires_payment_method' ? 'failed' : 'processing'
  return 'open'
}

/** Reconcile one exact Checkout attempt from current provider state, never an event snapshot. */
export async function reconcileCoachingCheckout({ service, sessionId, stripeLivemode }: {
  service: SupabaseClient
  sessionId: string
  stripeLivemode: boolean
  eventType?: string
}): Promise<CoachingLifecycleResult> {
  assertMode(stripeLivemode)
  // Start the observation before network reads so an older in-flight read
  // cannot overwrite a newer committed observation at the database boundary.
  const checkedAt = new Date().toISOString()
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.metadata?.checkout_type !== 'coaching_session') return { ignored: true }
  if (session.id !== sessionId || session.livemode !== stripeLivemode || session.mode !== 'payment'
    || session.currency !== 'eur' || !session.metadata.booking_id) {
    throw new CoachingLifecycleError('checkout_ownership_or_mode_mismatch')
  }
  const { data: booking, error: bookingError } = await service.from('bookings')
    .select('id,buyer_id,creator_id,price_cents,status,payment_status,stripe_livemode,stripe_checkout_session_id,current_payment_attempt_id,reservation_expires_at,fulfilled_payment_attempt_id')
    .eq('id', session.metadata.booking_id).maybeSingle()
  if (bookingError) throw bookingError
  if (!booking) throw new CoachingLifecycleError('coaching_booking_missing')
  const reserved = booking as LifecycleBooking
  if (reserved.buyer_id !== session.metadata.buyer_id || reserved.creator_id !== session.metadata.creator_id
    || reserved.stripe_livemode !== stripeLivemode || reserved.price_cents !== session.amount_total
    || !Number.isSafeInteger(session.amount_total) || session.amount_total! <= 0) {
    throw new CoachingLifecycleError('checkout_booking_snapshot_mismatch')
  }

  const intentId = objectId(session.payment_intent)
  const intent = intentId ? await stripe.paymentIntents.retrieve(intentId) : null
  if (intent && (intent.id !== intentId || intent.livemode !== stripeLivemode || intent.currency !== 'eur'
    || intent.amount !== reserved.price_cents || intent.metadata.checkout_type !== 'coaching_session'
    || intent.metadata.booking_id !== reserved.id || intent.metadata.buyer_id !== reserved.buyer_id
    || intent.metadata.creator_id !== reserved.creator_id
    || (intent.metadata.payment_attempt_id ?? null) !== (session.metadata.payment_attempt_id ?? null))) {
    throw new CoachingLifecycleError('payment_intent_snapshot_mismatch')
  }
  let attempt: LifecycleAttempt
  if (session.metadata.payment_attempt_id) {
    const { data, error } = await service.from('coaching_payment_attempts').select('*')
      .eq('id', session.metadata.payment_attempt_id).maybeSingle()
    if (error) throw error
    if (!data) throw new CoachingLifecycleError('checkout_attempt_missing')
    attempt = data as LifecycleAttempt
  } else {
    // A lazily recorded historical attempt remains identifiable after a retry
    // replaces the booking's current Session. Its exact private identity owns
    // late success; registering an unknown legacy Session still requires the
    // original stored booking identity, never merely matching metadata.
    const { data: recorded, error: recordedError } = await service.from('coaching_payment_attempts')
      .select('*').eq('stripe_checkout_session_id', session.id).maybeSingle()
    if (recordedError) throw recordedError
    if (recorded) {
      if (!recorded.legacy_checkout) throw new CoachingLifecycleError('legacy_checkout_identity_mismatch')
      attempt = recorded as LifecycleAttempt
    } else {
      if (reserved.stripe_checkout_session_id !== session.id) throw new CoachingLifecycleError('legacy_checkout_identity_mismatch')
      const { data, error } = await service.rpc('register_legacy_coaching_payment_attempt', {
        p_booking_id: reserved.id, p_session_id: session.id, p_livemode: stripeLivemode,
        p_destination_account_id: objectId(intent?.transfer_data?.destination),
        p_application_fee_cents: intent?.application_fee_amount ?? 0,
      })
      if (error) throw error
      if (!data?.attempt) throw new CoachingLifecycleError('legacy_checkout_registration_failed')
      attempt = data.attempt as LifecycleAttempt
    }
  }
  if (attempt.booking_id !== reserved.id || attempt.buyer_id !== reserved.buyer_id
    || attempt.creator_id !== reserved.creator_id || attempt.price_cents !== session.amount_total
    || attempt.stripe_livemode !== stripeLivemode
    || (attempt.stripe_checkout_session_id && attempt.stripe_checkout_session_id !== session.id)
    || (attempt.stripe_payment_intent_id && attempt.stripe_payment_intent_id !== intentId)
    || !metadataMatches(session.metadata, reserved, attempt)) {
    throw new CoachingLifecycleError('checkout_attempt_identity_mismatch')
  }
  if (intent && (intent.id !== intentId || intent.livemode !== stripeLivemode || intent.currency !== 'eur'
    || intent.amount !== attempt.price_cents || !metadataMatches(intent.metadata, reserved, attempt)
    || (attempt.charge_architecture === 'separate'
      ? Boolean(intent.transfer_data) || (intent.application_fee_amount ?? 0) !== 0
        || intent.transfer_group !== `ardore-order-${attempt.id}`
      : objectId(intent.transfer_data?.destination) !== attempt.destination_account_id
        || (intent.application_fee_amount ?? 0) !== attempt.application_fee_cents))) {
    throw new CoachingLifecycleError('payment_intent_snapshot_mismatch')
  }

  const state = providerState(session, intent)
  let actualPaid: number | undefined
  let amountRefunded: number | undefined
  if (state === 'paid') {
    const chargeId = objectId(intent?.latest_charge)
    if (!intent || !chargeId || session.payment_status !== 'paid') throw new CoachingLifecycleError('paid_checkout_not_captured')
    const charge = await stripe.charges.retrieve(chargeId)
    if (charge.id !== chargeId || objectId(charge.payment_intent) !== intent.id || !charge.paid || !charge.captured
      || charge.livemode !== stripeLivemode || charge.currency !== 'eur' || charge.disputed
      || !metadataMatches(charge.metadata, reserved, attempt) || charge.amount_captured !== intent.amount_received
      || charge.amount_captured !== attempt.price_cents
      || (attempt.charge_architecture === 'separate'
        ? Boolean(charge.transfer_data) || Boolean(charge.transfer) || Boolean(charge.application_fee)
          || Boolean(charge.source_transfer) || charge.transfer_group !== `ardore-order-${attempt.id}`
        : objectId(charge.transfer_data?.destination) !== attempt.destination_account_id)
      || !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > charge.amount_captured) {
      throw new CoachingLifecycleError('captured_charge_snapshot_mismatch')
    }
    actualPaid = charge.amount_captured
    amountRefunded = charge.amount_refunded
  }
  const { data, error } = await service.rpc('observe_coaching_payment_attempt', {
    p_attempt_id: attempt.id,
    p_observation: {
      booking_id: reserved.id, buyer_id: reserved.buyer_id, creator_id: reserved.creator_id,
      session_id: session.id, payment_intent_id: intentId, livemode: stripeLivemode,
      currency: 'eur', amount_total: session.amount_total, provider_state: state,
      provider_checked_at: checkedAt, expires_at: new Date(session.expires_at * 1000).toISOString(),
      ...(actualPaid !== undefined ? { amount_paid_cents: actualPaid, amount_refunded_cents: amountRefunded,
        ...(amountRefunded! > 0 ? { force_reconciliation_reason: 'payment_already_refunded' } : {}) } : {}),
      provider_error_code: state === 'open' && intent?.last_payment_error ? 'payment_failed' : null,
    },
  })
  if (error) throw error
  if (!data?.booking || !data?.attempt) throw new CoachingLifecycleError('payment_observation_failed')
  const result: CoachingLifecycleResult = { ...data, providerState: state }
  // Confirmation is already durable. A later ledger/provider outage must not
  // lose this one-time confirmation side effect on the webhook's next retry.
  if (result.newly_confirmed) await provisionConfirmedCoachingBooking(data.booking.id)
  if (state === 'paid' && intent && attempt.charge_architecture === 'separate') {
    // Record every captured payment, including losers that require a refund.
    // Only the exact fulfilled, still-paid booking may initiate settlement.
    const settlement = await recordSuccessfulSettlement({ service, orderId: attempt.id,
      paymentIntentId: intent.id, sessionId: session.id,
    })
    if (!result.needs_reconciliation && data.attempt.fulfillment_state === 'paid_confirmed'
      && data.booking.fulfilled_payment_attempt_id === attempt.id && data.booking.status === 'confirmed'
      && data.booking.payment_status === 'paid' && amountRefunded === 0) {
      await settlePayment({ service, settlementId: settlement.id })
    }
  }
  if (result.needs_reconciliation) {
    await processCoachingPaymentReconciliation({ service, attemptId: data.attempt.id })
  }
  return result
}

/** PaymentIntent events may arrive before Checkout events; resolve its exact Session. */
export async function reconcileCoachingPaymentIntent({ service, paymentIntentId, stripeLivemode }: {
  service: SupabaseClient
  paymentIntentId: string
  stripeLivemode: boolean
  eventType?: string
}): Promise<CoachingLifecycleResult> {
  assertMode(stripeLivemode)
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (intent.metadata?.checkout_type !== 'coaching_session') return { ignored: true }
  if (intent.id !== paymentIntentId || intent.livemode !== stripeLivemode) throw new CoachingLifecycleError('payment_intent_mode_mismatch')
  const sessions = await stripe.checkout.sessions.list({ payment_intent: intent.id, limit: 10 })
  const owned = sessions.data.filter(session => session.mode === 'payment' && session.livemode === stripeLivemode
    && session.metadata?.checkout_type === 'coaching_session' && session.metadata.booking_id === intent.metadata.booking_id)
  if (owned.length !== 1) throw new CoachingLifecycleError('payment_checkout_identity_mismatch')
  return reconcileCoachingCheckout({ service, sessionId: owned[0].id, stripeLivemode })
}

/** Timed-out holds are released only after Stripe confirms a safe terminal state. */
export async function reconcileExpiredCoachingReservations({ service, creatorId, limit = 50 }: {
  service: SupabaseClient
  creatorId?: string
  limit?: number
}) {
  let query = service.from('bookings').select('id,stripe_checkout_session_id,stripe_livemode,current_payment_attempt_id')
    .eq('status', 'pending_payment').lte('reservation_expires_at', new Date().toISOString())
    .order('payment_updated_at', { ascending: true, nullsFirst: true })
    .order('reservation_expires_at', { ascending: true }).limit(Math.min(100, Math.max(1, limit)))
  if (creatorId) query = query.eq('creator_id', creatorId)
  const { data, error } = await query
  if (error) throw error
  const results = { checked: 0, released: 0, confirmed: 0, reconciliation: 0, unresolved: 0, failed: 0 }
  for (const row of data ?? []) {
    let rowFailed = false
    try {
      let sessionId = row.stripe_checkout_session_id
      if (!sessionId && row.current_payment_attempt_id) {
        const recovered = await recoverCreatingCoachingCheckout({ service, attemptId: row.current_payment_attempt_id, bookingId: row.id })
        sessionId = recovered.sessionId
      }
      if (!sessionId || typeof row.stripe_livemode !== 'boolean') {
        results.unresolved += 1
        continue
      }
      const result = await reconcileCoachingCheckout({ service, sessionId, stripeLivemode: row.stripe_livemode })
      results.checked += 1
      if (['expired', 'payment_failed', 'reversed'].includes(result.booking?.status ?? '')) results.released += 1
      if (result.newly_confirmed) results.confirmed += 1
      if (result.needs_reconciliation) results.reconciliation += 1
    } catch (error) {
      // One provider outage must not prevent reconciliation of other holds.
      // Callers still return a retryable failure when this counter is nonzero.
      results.failed += 1
      rowFailed = true
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
      console.error('[coaching-reservation] reconciliation failed', typeof code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : 'reservation_reconciliation_failed')
    } finally {
      // Rotate processing, unresolved, and failed holds behind unchecked ones.
      // This changes only the check timestamp of the same still-pending attempt;
      // a concurrent confirmation, cancellation, or retry is never overwritten.
      try {
        let touch = service.from('bookings').update({ payment_updated_at: new Date().toISOString() })
          .eq('id', row.id).eq('status', 'pending_payment')
        touch = row.current_payment_attempt_id
          ? touch.eq('current_payment_attempt_id', row.current_payment_attempt_id)
          : touch.is('current_payment_attempt_id', null)
        const { error: touchError } = await touch
        if (touchError) throw touchError
      } catch (error) {
        if (!rowFailed) results.failed += 1
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
        console.error('[coaching-reservation] rotation failed', typeof code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : 'reservation_rotation_failed')
      }
    }
  }
  return results
}
