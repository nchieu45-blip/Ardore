import type { SupabaseClient } from '@supabase/supabase-js'
import {
  processCoachingRefund,
  reconcileClaimedCoachingRefund,
  type CoachingRefundBooking,
  type CoachingRefundRequest,
  type CoachingRefundResult,
  type CoachingRefundState,
  type CoachingTransferStatus,
} from '@/lib/coaching-refund'

interface ReconciliationAttempt {
  id: string
  booking_id: string
  buyer_id: string
  creator_id: string
  price_cents: number
  amount_paid_cents: number | null
  amount_refunded_cents: number
  stripe_payment_intent_id: string | null
  stripe_livemode: boolean
  legacy_checkout: boolean
  fulfillment_state: string
  reconciliation_reason: string | null
  refund_status: CoachingRefundState
  refund_amount_cents: number | null
  refund_idempotency_key: string
  stripe_refund_id: string | null
  stripe_transfer_id: string | null
  transfer_reversal_ids: string[]
  application_fee_refund_ids: string[]
  transfer_status: CoachingTransferStatus
  last_error_code: string | null
}

const reconciliationReasons = new Set([
  'slot_unavailable', 'appointment_elapsed', 'booking_cancelled', 'duplicate_payment', 'payment_already_refunded',
])

function refundClaim(attempt: ReconciliationAttempt) {
  // Only a service-created, durable system claim may refund a losing payment.
  // An ordinary paid/fulfilled attempt is never turned into a refund here.
  if (!reconciliationReasons.has(attempt.reconciliation_reason ?? '')
    || !['reconciliation_pending', 'reconciled'].includes(attempt.fulfillment_state)
    || attempt.refund_status === 'not_requested'
    || !attempt.stripe_payment_intent_id || !attempt.amount_paid_cents
    || attempt.refund_idempotency_key !== `ardore-coaching-reconciliation-${attempt.id}-v1`) {
    throw new Error('Invalid durable payment reconciliation claim')
  }
  const booking: CoachingRefundBooking = {
    id: attempt.booking_id, buyer_id: attempt.buyer_id, creator_id: attempt.creator_id,
    price_cents: attempt.price_cents, amount_paid_cents: attempt.amount_paid_cents,
    stripe_payment_intent_id: attempt.stripe_payment_intent_id,
    stripe_livemode: attempt.stripe_livemode,
    // This is a payment-specific engine view; the persistence RPC validates the
    // real booking separately and leaves a different fulfilled payment intact.
    status: 'cancelled', payment_status: attempt.refund_status === 'succeeded' ? 'refunded' : 'paid',
  }
  const request: CoachingRefundRequest = {
    booking_id: attempt.booking_id, actor_user_id: null, actor_role: 'system',
    state: attempt.refund_status, amount_cents: attempt.refund_amount_cents,
    stripe_refund_id: attempt.stripe_refund_id,
    stripe_payment_intent_id: attempt.stripe_payment_intent_id,
    stripe_transfer_id: attempt.stripe_transfer_id,
    transfer_reversal_ids: attempt.transfer_reversal_ids,
    application_fee_refund_ids: attempt.application_fee_refund_ids,
    transfer_status: attempt.transfer_status, last_error_code: attempt.last_error_code,
  }
  return { booking, request, target: { attemptId: attempt.id, legacyCheckout: attempt.legacy_checkout } }
}

export async function processCoachingPaymentReconciliation({ service, attemptId }: {
  service: SupabaseClient
  attemptId: string
}): Promise<CoachingRefundResult> {
  const { data, error } = await service.from('coaching_payment_attempts').select('*').eq('id', attemptId).single()
  if (error || !data) throw error ?? new Error('Payment reconciliation claim not found')
  const claim = refundClaim(data as ReconciliationAttempt)
  // A recoverable transport error must release its webhook for delivery retry.
  // The existing engine retains the frozen amount and exact attempt-specific key.
  return processCoachingRefund({ service, ...claim, resumeCapture: true })
}

export async function reconcileCoachingPaymentReconciliation({ service, paymentIntentId, stripeLivemode,
  resumeCapture = false }: {
  service: SupabaseClient
  paymentIntentId: string
  stripeLivemode: boolean
  resumeCapture?: boolean
}): Promise<CoachingRefundResult | null> {
  const { data, error } = await service.from('coaching_payment_attempts').select('*')
    .eq('stripe_payment_intent_id', paymentIntentId).eq('stripe_livemode', stripeLivemode).maybeSingle()
  if (error) throw error
  if (!data || !data.reconciliation_reason || data.refund_status === 'not_requested') return null
  return reconcileClaimedCoachingRefund({ service, ...refundClaim(data as ReconciliationAttempt), resumeCapture })
}
