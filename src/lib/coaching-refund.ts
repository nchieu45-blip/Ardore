import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

export type CoachingRefundState = 'not_requested' | 'pending' | 'succeeded' | 'failed'
export type CoachingTransferStatus = 'not_required' | 'pending' | 'succeeded' | 'failed'

export interface CoachingRefundBooking {
  id: string
  buyer_id: string
  creator_id: string
  price_cents: number
  amount_paid_cents: number | null
  stripe_payment_intent_id: string | null
  stripe_livemode: boolean | null
  status: string
  payment_status: string
}

export interface CoachingRefundRequest {
  booking_id: string
  actor_user_id: string | null
  actor_role: 'buyer' | 'creator' | 'system'
  state: CoachingRefundState
  amount_cents: number | null
  stripe_refund_id: string | null
  stripe_payment_intent_id: string | null
  stripe_transfer_id?: string | null
  transfer_reversal_ids?: string[]
  application_fee_refund_ids?: string[]
  transfer_status?: CoachingTransferStatus
  last_error_code?: string | null
}

export interface CoachingRefundResult {
  state: CoachingRefundState
  amountCents: number
  amountRefundedCents: number
  transferStatus: CoachingTransferStatus
  stripeRefundId: string | null
  errorCode: string | null
}

// Only trusted server reconciliation claims select a payment-attempt target.
// Browser input never supplies a refund key or a persistence destination.
export interface CoachingRefundTarget {
  attemptId: string
  legacyCheckout?: boolean
}

function refundKey(bookingId: string, target?: CoachingRefundTarget): string {
  return target ? `ardore-coaching-reconciliation-${target.attemptId}-v1`
    : `ardore-booking-refund-${bookingId}-v1`
}

interface RefundStateWrite {
  p_booking_id: string
  p_state: Record<string, unknown> | null
  p_payment_status: string | null
  p_amount_refunded_cents: number | null
  p_amount_paid_cents: number | null
  p_provider_checked_at: string
}

async function applyRefundState(service: SupabaseClient, target: CoachingRefundTarget | undefined,
  parameters: RefundStateWrite) {
  if (!target) return service.rpc('apply_coaching_refund_state', parameters)
  const { p_booking_id: bookingId, ...state } = parameters
  // The attempt RPC independently checks its booking, durable system claim and
  // winning payment before any ledger or booking state can change.
  return service.rpc('apply_coaching_attempt_refund_state', {
    p_attempt_id: target.attemptId, ...state,
  }).then(result => {
    const saved = result.data as { refund?: { booking_id?: string } } | null
    if (!result.error && saved?.refund?.booking_id !== bookingId) {
      throw new RefundValidationError('reconciliation_claim_mismatch')
    }
    return result
  })
}

interface ProviderSnapshot {
  checkedAt: string
  intent: Stripe.PaymentIntent
  charge: Stripe.Charge
  refunds: Stripe.Refund[]
  transfer: Stripe.Transfer | null
  applicationFee: Stripe.ApplicationFee | null
  actualPaid: number
  accountingPending: boolean
}

class RefundValidationError extends Error {
  constructor(readonly code: string) { super(code) }
}

function objectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : value?.id ?? null
}

function safeErrorCode(error: unknown): string {
  // Stripe error messages can contain account/payment details. Persist only a
  // short machine code; neither credentials nor raw provider messages escape.
  if (error instanceof RefundValidationError) return error.code
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null
  return typeof code === 'string' && /^[a-z_]{1,80}$/.test(code) ? code : 'stripe_refund_request_failed'
}

function transientRefundError(error: unknown): boolean {
  if (error instanceof RefundValidationError || typeof error !== 'object' || error === null) return false
  const details = error as { code?: unknown; type?: unknown; statusCode?: unknown; message?: unknown }
  const code = typeof details.code === 'string' ? details.code : ''
  // Capture events must be retried after a transport/provider/database outage.
  // Validation errors and rejected refunds remain explicit permanent failures.
  return ['StripeConnectionError', 'StripeAPIError', 'StripeRateLimitError'].includes(String(details.type))
    || ['api_connection_error', 'api_error', 'rate_limit', '40001', '40P01'].includes(code)
    || /^(08|53|57P|58)/.test(code) || /^PGRST00[0-3]$/.test(code)
    || (typeof details.statusCode === 'number' && (details.statusCode === 429 || details.statusCode >= 500))
    // postgrest-js returns transport errors as plain objects with an empty code.
    || (!code && typeof details.message === 'string'
      && /^(?:TypeError:\s*)?(?:fetch failed|failed to fetch|network request failed)(?:[.:\s]|$)/i.test(details.message))
    || (error instanceof TypeError && typeof details.message === 'string'
      && /fetch failed|failed to fetch|network/i.test(details.message))
}

function activeRefund(refund: Stripe.Refund): boolean {
  return !['failed', 'canceled'].includes(refund.status ?? '')
}

function refundTotals(snapshot: ProviderSnapshot) {
  return {
    succeeded: snapshot.refunds.filter(refund => refund.status === 'succeeded').reduce((sum, refund) => sum + refund.amount, 0),
    reserved: snapshot.refunds.filter(activeRefund).reduce((sum, refund) => sum + refund.amount, 0),
  }
}

async function providerSnapshot(booking: CoachingRefundBooking, target?: CoachingRefundTarget): Promise<ProviderSnapshot> {
  const checkedAt = new Date().toISOString()
  if (!booking.stripe_payment_intent_id || booking.stripe_livemode === null) throw new RefundValidationError('missing_booking_payment')
  const configuredLiveMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true
  if (booking.stripe_livemode !== configuredLiveMode) throw new RefundValidationError('payment_mode_mismatch')
  const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id)
  const chargeId = objectId(intent.latest_charge)
  if (!chargeId || intent.status !== 'succeeded') throw new RefundValidationError('payment_not_captured')
  const charge = await stripe.charges.retrieve(chargeId)
  if (target && !target.legacyCheckout && (intent.metadata.payment_attempt_id !== target.attemptId
    || charge.metadata.payment_attempt_id !== target.attemptId)) {
    throw new RefundValidationError('payment_attempt_ownership_mismatch')
  }
  const metadataMatches = (metadata: Stripe.Metadata) => metadata.checkout_type === 'coaching_session'
    && metadata.booking_id === booking.id && metadata.buyer_id === booking.buyer_id && metadata.creator_id === booking.creator_id
  if (intent.id !== booking.stripe_payment_intent_id || objectId(charge.payment_intent) !== intent.id
    || !metadataMatches(intent.metadata) || !metadataMatches(charge.metadata)
    || intent.livemode !== booking.stripe_livemode || charge.livemode !== booking.stripe_livemode
    || intent.currency !== 'eur' || charge.currency !== 'eur' || !charge.paid || !charge.captured || charge.disputed) {
    throw new RefundValidationError('payment_ownership_or_state_mismatch')
  }
  // A standalone coaching checkout owns one charge. A mismatch is an accounting
  // exception, never a reason to guess an amount or refund a different purchase.
  const actualPaid = charge.amount_captured
  if (!Number.isSafeInteger(actualPaid) || actualPaid <= 0 || actualPaid !== intent.amount_received
    || actualPaid > booking.price_cents
    || (booking.amount_paid_cents !== null && booking.amount_paid_cents !== actualPaid)) {
    throw new RefundValidationError('payment_amount_mismatch')
  }
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 1000 })
  if (refunds.length >= 1000) throw new RefundValidationError('refund_history_limit')
  if (refunds.some(refund => objectId(refund.charge) !== charge.id || objectId(refund.payment_intent) !== intent.id
    || refund.currency !== charge.currency || !Number.isSafeInteger(refund.amount) || refund.amount <= 0)) {
    throw new RefundValidationError('refund_ownership_mismatch')
  }
  const reserved = refunds.filter(activeRefund).reduce((sum, refund) => sum + refund.amount, 0)
  if (reserved > actualPaid) throw new RefundValidationError('refund_amount_mismatch')

  const transferId = objectId(charge.transfer)
  const destination = objectId(charge.transfer_data?.destination)
  const feeId = objectId(charge.application_fee)
  const expectedFee = intent.application_fee_amount ?? 0
  if (!Number.isSafeInteger(expectedFee) || expectedFee < 0 || expectedFee > actualPaid) {
    throw new RefundValidationError('application_fee_amount_mismatch')
  }
  // automatic_async reports a captured payment before its Connect transfer and
  // fee exist. Preserve the authorised cancellation claim until Stripe supplies
  // both objects; refunding now could leave a coach transfer/fee unreconciled.
  const accountingPending = intent.capture_method === 'automatic_async' && Boolean(destination)
    && (!transferId || (expectedFee > 0 && !feeId))
  if ((Boolean(destination) !== Boolean(transferId) && !accountingPending) || objectId(intent.transfer_data?.destination) !== destination
    || (!transferId && charge.transfer_group && !accountingPending) || charge.source_transfer) {
    // Ardore currently creates platform/destination charges, never independent
    // transfer groups or direct charges. Unknown architectures fail closed.
    throw new RefundValidationError('unsupported_transfer_architecture')
  }
  if (expectedFee > 0 && !feeId && !accountingPending) {
    throw new RefundValidationError('application_fee_not_available')
  }
  const transfer = transferId ? await stripe.transfers.retrieve(transferId) : null
  if (transfer && (objectId(transfer.source_transaction) !== charge.id || objectId(transfer.destination) !== destination
    || transfer.livemode !== charge.livemode || transfer.currency !== charge.currency
    || transfer.amount > actualPaid || transfer.amount_reversed < 0 || transfer.amount_reversed > transfer.amount)) {
    throw new RefundValidationError('transfer_ownership_mismatch')
  }
  const applicationFee = feeId ? await stripe.applicationFees.retrieve(feeId) : null
  if (applicationFee && ((!transfer && !accountingPending) || objectId(applicationFee.originating_transaction) !== charge.id
    || objectId(applicationFee.account) !== destination || applicationFee.livemode !== charge.livemode
    || applicationFee.currency !== charge.currency || applicationFee.amount > actualPaid
    || applicationFee.amount_refunded > applicationFee.amount)) {
    throw new RefundValidationError('application_fee_ownership_mismatch')
  }
  return { checkedAt, intent, charge, refunds, transfer, applicationFee, actualPaid, accountingPending }
}

function transferStatus(snapshot: ProviderSnapshot): CoachingTransferStatus {
  if (snapshot.accountingPending) return 'pending'
  if (!snapshot.transfer) return 'not_required'
  const { reserved } = refundTotals(snapshot)
  const requiredReversal = Math.floor(snapshot.transfer.amount * reserved / snapshot.actualPaid)
  const requiredFeeRefund = Math.floor((snapshot.applicationFee?.amount ?? 0) * reserved / snapshot.actualPaid)
  return snapshot.transfer.amount_reversed >= requiredReversal
    && (snapshot.applicationFee?.amount_refunded ?? 0) >= requiredFeeRefund ? 'succeeded' : 'failed'
}

async function processingCosts(snapshot: ProviderSnapshot): Promise<number | null> {
  const balanceId = objectId(snapshot.charge.balance_transaction)
  if (!balanceId) return null
  try {
    const balance = await stripe.balanceTransactions.retrieve(balanceId)
    if (balance.currency !== snapshot.charge.currency) return null
    const paymentFees = (transaction: Stripe.BalanceTransaction) => transaction.fee_details
      .filter(fee => ['stripe_fee', 'payment_method_passthrough_fee'].includes(fee.type))
      .reduce((sum, fee) => sum + fee.amount, 0)
    let costs = paymentFees(balance)
    for (const refund of snapshot.refunds.filter(refund => refund.status === 'succeeded')) {
      const refundBalanceId = objectId(refund.balance_transaction)
      if (!refundBalanceId) return null
      const refundBalance = await stripe.balanceTransactions.retrieve(refundBalanceId)
      if (refundBalance.currency !== balance.currency) return null
      costs += paymentFees(refundBalance)
    }
    return Math.max(0, costs)
  } catch {
    // Accounting retrieval must not turn a successfully created customer refund
    // into a failed refund. An explicit pending marker allows later reconciliation.
    return null
  }
}

function ownedRefund(snapshot: ProviderSnapshot, request: CoachingRefundRequest, target?: CoachingRefundTarget): Stripe.Refund | null {
  const matches = snapshot.refunds.filter(refund => refund.id === request.stripe_refund_id
    || (refund.metadata?.ardore_refund_key === refundKey(request.booking_id, target)
      && refund.metadata?.booking_id === request.booking_id))
  if (matches.length > 1) throw new RefundValidationError('duplicate_refund_requires_reconciliation')
  if (request.stripe_refund_id && matches.length === 0) throw new RefundValidationError('stored_refund_not_found')
  return matches[0] ?? null
}

function authoritativeResult(data: unknown, fallback: CoachingRefundResult): CoachingRefundResult {
  const saved = data as { booking?: { payment_status: string; amount_refunded_cents: number }; refund?: CoachingRefundRequest & { last_error_code?: string | null } } | null
  if (!saved?.booking) return fallback
  return {
    state: saved.refund?.state ?? (saved.booking.payment_status === 'refunded' ? 'succeeded' : fallback.state),
    amountCents: saved.refund?.amount_cents ?? fallback.amountCents,
    amountRefundedCents: saved.booking.amount_refunded_cents,
    transferStatus: saved.refund?.transfer_status ?? fallback.transferStatus,
    stripeRefundId: saved.refund?.stripe_refund_id ?? fallback.stripeRefundId,
    errorCode: saved.refund?.last_error_code ?? fallback.errorCode,
  }
}

async function persistSnapshot(service: SupabaseClient, booking: CoachingRefundBooking,
  request: CoachingRefundRequest | null, snapshot: ProviderSnapshot,
  preserveUnsubmittedFailure = false, target?: CoachingRefundTarget): Promise<CoachingRefundResult> {
  const totals = refundTotals(snapshot)
  const refund = request ? ownedRefund(snapshot, request, target) : null
  const transfer = transferStatus(snapshot)
  const complete = totals.succeeded === snapshot.actualPaid
  const failed = refund && ['failed', 'canceled'].includes(refund.status ?? '')
  // A later event can observe the payment without observing an accepted refund.
  // Keep the rejected request actionable; only an explicit cancellation retry
  // may restart it. An accepted own refund or full external refund still wins.
  const unsubmittedFailure = preserveUnsubmittedFailure && request?.state === 'failed' && !refund && !complete
  const state: CoachingRefundState = transfer === 'failed' ? 'failed'
    : unsubmittedFailure ? 'failed' : complete && !snapshot.accountingPending ? 'succeeded' : failed ? 'failed' : 'pending'
  const errorCode = unsubmittedFailure ? request.last_error_code ?? 'stripe_refund_failed'
    : transfer === 'failed' ? 'transfer_reconciliation_required'
    : failed ? safeErrorCode({ code: refund.failure_reason ?? 'stripe_refund_failed' })
      : snapshot.accountingPending ? 'payment_capture_pending' : null
  const paymentStatus = complete ? 'refunded' : totals.succeeded > 0 ? 'partially_refunded' : 'paid'
  const feeCosts = request ? await processingCosts(snapshot) : null
  const reversalIds = [...new Set(snapshot.refunds.map(item => objectId(item.transfer_reversal)).filter((id): id is string => Boolean(id)))]
  const feeRefundIds = snapshot.applicationFee?.refunds.data.map(item => item.id) ?? []
  const ledgerState = request ? {
    state, amount_cents: request.amount_cents ?? refund?.amount ?? null,
    stripe_refund_id: refund?.id ?? request.stripe_refund_id,
    stripe_payment_intent_id: snapshot.intent.id,
    stripe_livemode: snapshot.intent.livemode,
    stripe_transfer_id: snapshot.transfer?.id ?? null,
    transfer_reversal_ids: reversalIds,
    application_fee_refund_ids: feeRefundIds,
    transfer_status: transfer,
    processing_fee_cents: feeCosts,
    processing_fee_cost_owner: request.actor_role === 'creator' ? 'coach' : 'platform',
    processing_fee_accounting_status: feeCosts === null ? 'pending' : 'recorded',
    last_error_code: errorCode,
  } : null
  const { data, error } = await applyRefundState(service, target, {
    p_booking_id: booking.id, p_state: ledgerState, p_payment_status: paymentStatus,
    p_amount_refunded_cents: totals.succeeded, p_amount_paid_cents: snapshot.actualPaid,
    p_provider_checked_at: snapshot.checkedAt,
  })
  if (error) throw error
  return authoritativeResult(data, { state, amountCents: request?.amount_cents ?? refund?.amount ?? snapshot.actualPaid,
    amountRefundedCents: totals.succeeded, transferStatus: transfer, stripeRefundId: refund?.id ?? null, errorCode })
}

/** Called only after the cancellation RPC has durably claimed this booking. */
export async function processCoachingRefund({ service, booking, request, resumeCapture = false, target }: {
  service: SupabaseClient
  booking: CoachingRefundBooking
  request: CoachingRefundRequest
  resumeCapture?: boolean
  target?: CoachingRefundTarget
}): Promise<CoachingRefundResult> {
  if (request.booking_id !== booking.id || booking.status !== 'cancelled'
    || request.stripe_payment_intent_id !== booking.stripe_payment_intent_id) throw new RefundValidationError('unclaimed_refund_request')
  let snapshot: ProviderSnapshot | null = null
  try {
    snapshot = await providerSnapshot(booking, target)
    const existing = ownedRefund(snapshot, request, target)
    const totals = refundTotals(snapshot)
    if (snapshot.accountingPending) return await persistSnapshot(service, booking, request, snapshot, false, target)
    if (existing || totals.succeeded === snapshot.actualPaid || totals.reserved !== totals.succeeded) {
      return await persistSnapshot(service, booking, request, snapshot, false, target)
    }
    if (transferStatus(snapshot) === 'failed') throw new RefundValidationError('transfer_reconciliation_required')
    const remaining = snapshot.actualPaid - totals.succeeded
    const amount = request.amount_cents ?? remaining
    if (amount !== remaining || amount <= 0) throw new RefundValidationError('refund_amount_changed_requires_reconciliation')
    // Freeze the refund parameters before the network mutation. Retrying after
    // a timeout reuses both the durable amount and the exact same Stripe key.
    const { data: frozenData, error: freezeError } = await applyRefundState(service, target, {
      p_booking_id: booking.id, p_state: { state: 'pending', amount_cents: amount,
        stripe_payment_intent_id: snapshot.intent.id, stripe_livemode: snapshot.intent.livemode,
        transfer_status: snapshot.transfer ? 'pending' : 'not_required',
        last_error_code: resumeCapture ? 'payment_capture_pending' : null },
      p_payment_status: totals.succeeded > 0 ? 'partially_refunded' : 'paid',
      p_amount_refunded_cents: totals.succeeded, p_amount_paid_cents: snapshot.actualPaid,
      p_provider_checked_at: snapshot.checkedAt,
    })
    if (freezeError) throw freezeError
    const frozen = frozenData as { refund?: CoachingRefundRequest } | null
    request = frozen?.refund ?? { ...request, amount_cents: amount }
    if (request.amount_cents !== amount) throw new RefundValidationError('refund_amount_changed_requires_reconciliation')
    if (request.stripe_refund_id || request.state === 'succeeded') {
      return await persistSnapshot(service, booking, request, await providerSnapshot(booking, target), false, target)
    }
    if (snapshot.transfer && snapshot.transfer.amount_reversed === snapshot.transfer.amount) {
      throw new RefundValidationError('transfer_previously_reversed_requires_reconciliation')
    }
    await stripe.refunds.create({
      charge: snapshot.charge.id, amount,
      ...(request.actor_role === 'system' ? {} : { reason: 'requested_by_customer' as const }),
      metadata: { booking_id: booking.id, buyer_id: booking.buyer_id, creator_id: booking.creator_id,
        actor_role: request.actor_role, ardore_refund_key: refundKey(booking.id, target),
        ...(target ? { payment_attempt_id: target.attemptId } : {}) },
      ...(snapshot.transfer ? { reverse_transfer: true,
        ...(snapshot.applicationFee ? { refund_application_fee: true } : {}) } : {}),
    }, { idempotencyKey: refundKey(booking.id, target) })
    return await persistSnapshot(service, booking, request, await providerSnapshot(booking, target), false, target)
  } catch (error) {
    // A timeout may have occurred after Stripe accepted the request. Fresh
    // reconciliation is attempted before declaring failure, without another POST.
    try {
      const current = await providerSnapshot(booking, target)
      if (ownedRefund(current, request, target) || refundTotals(current).succeeded === current.actualPaid) {
        return await persistSnapshot(service, booking, request, current, false, target)
      }
      snapshot = current
    } catch { /* Preserve the durable request for a later retry/webhook. */ }
    // Keep the authorised capture claim resumable and let the webhook release
    // its event claim for delivery retry. The frozen amount/idempotency key also
    // cover a timeout after Stripe accepted the refund but before persistence.
    if (resumeCapture && transientRefundError(error)) throw error
    const code = safeErrorCode(error)
    const { data: failureData, error: saveError } = await applyRefundState(service, target, {
      p_booking_id: booking.id,
      p_state: { state: 'failed', last_error_code: code,
        transfer_status: code.includes('transfer') ? 'failed' : request.transfer_status ?? (snapshot?.transfer ? 'pending' : 'not_required') },
      p_payment_status: snapshot ? (refundTotals(snapshot).succeeded === snapshot.actualPaid ? 'refunded'
        : refundTotals(snapshot).succeeded > 0 ? 'partially_refunded' : 'paid') : null,
      p_amount_refunded_cents: snapshot ? refundTotals(snapshot).succeeded : null,
      p_amount_paid_cents: snapshot?.actualPaid ?? null,
      p_provider_checked_at: snapshot?.checkedAt ?? new Date().toISOString(),
    })
    if (saveError) throw saveError
    return authoritativeResult(failureData, { state: 'failed', amountCents: request.amount_cents ?? 0,
      amountRefundedCents: snapshot ? refundTotals(snapshot).succeeded : 0,
      transferStatus: code.includes('transfer') ? 'failed' : request.transfer_status ?? 'not_required',
      stripeRefundId: request.stripe_refund_id, errorCode: code })
  }
}

/** Only a durable eligible claim waiting for capture may start its first refund. */
export async function reconcileCoachingRefund({ service, paymentIntentId, stripeLivemode, resumeCapture = false }: {
  service: SupabaseClient
  paymentIntentId: string
  stripeLivemode: boolean
  resumeCapture?: boolean
}): Promise<CoachingRefundResult | null> {
  const { data: booking, error: bookingError } = await service.from('bookings')
    .select('id,buyer_id,creator_id,price_cents,amount_paid_cents,stripe_payment_intent_id,stripe_livemode,status,payment_status')
    .eq('stripe_payment_intent_id', paymentIntentId).eq('stripe_livemode', stripeLivemode).maybeSingle()
  if (bookingError) throw bookingError
  if (!booking) return null
  const { data: request, error: requestError } = await service.from('booking_refunds').select('*').eq('booking_id', booking.id).maybeSingle()
  if (requestError) throw requestError
  return reconcileClaimedCoachingRefund({ service, booking: booking as CoachingRefundBooking,
    request: request as CoachingRefundRequest | null, resumeCapture })
}

export async function reconcileClaimedCoachingRefund({ service, booking, request, resumeCapture = false, target }: {
  service: SupabaseClient
  booking: CoachingRefundBooking
  request: CoachingRefundRequest | null
  resumeCapture?: boolean
  target?: CoachingRefundTarget
}): Promise<CoachingRefundResult> {
  if (resumeCapture && booking.status === 'cancelled' && request?.state === 'pending'
    && request.last_error_code === 'payment_capture_pending' && !request.stripe_refund_id) {
    return processCoachingRefund({ service, booking, request, resumeCapture: true, target })
  }
  return persistSnapshot(service, booking, request, await providerSnapshot(booking, target), true, target)
}
