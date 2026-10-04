import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { stripe } from '@/lib/stripe/server'
import { calculateArdorePlatformFee } from '@/lib/stripe/platformFee'
import { ConnectReadinessError, configuredStripeLivemode, requirePayoutReadyCoach } from '@/lib/stripe/connect-readiness'

type Kind = 'booking' | 'products' | 'subscription'
export type SettlementOrder = {
  id: string; kind: Kind; buyer_id: string; creator_id: string; account_id: string | null;
  gross_cents: number; platform_fee_cents: number; coach_net_cents: number; stripe_livemode: boolean;
  reference: Record<string, unknown>; stripe_checkout_session_id: string | null; stripe_subscription_id: string | null; state: string;
}
export type PaymentSettlement = {
  id: string; order_id: string; kind: Kind; buyer_id: string; creator_id: string; account_id: string;
  gross_cents: number; platform_fee_cents: number; coach_net_cents: number; stripe_livemode: boolean;
  stripe_payment_intent_id: string; stripe_charge_id: string; stripe_invoice_id: string | null;
  stripe_subscription_id: string | null; stripe_checkout_session_id: string | null;
  stripe_transfer_id: string | null; transfer_amount_cents: number | null; pretransfer_refunded_cents: number;
  amount_refunded_cents: number; refund_requested_cents: number; amount_reversed_cents: number;
  transfer_reversal_ids: string[]; fulfillment_state: string; state: string;
  lease_token: string | null; lease_expires_at: string | null;
}
type Action = { id: string; settlement_id: string; kind: string; target_cents: number; amount_cents: number;
  idempotency_key: string; stripe_object_id: string | null; request_started_at: string; uncertain: boolean }
export type SettlementFulfillmentResult = {
  handled: boolean; newlyFulfilled?: boolean; kind?: Kind; buyerId?: string; creatorId?: string;
  items?: { productId: string; amountCents: number }[]; tierId?: string; withdrawalConsentAt?: string;
  notifySubscriber?: boolean; retryNeeded?: boolean;
}
export class SettlementError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'SettlementError' }
}
const idOf = (value: string | { id: string } | null | undefined) => typeof value === 'string' ? value : value?.id ?? null
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const groupOf = (order: SettlementOrder) => `ardore-order-${order.id}`
function assert(value: unknown, code: string): asserts value { if (!value) throw new SettlementError(code) }
function safeCode(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(code) ? code : 'settlement_provider_failed'
}
async function rpc<T>(service: SupabaseClient, name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(name, params)
  if (error || data === null) throw new SettlementError('settlement_persistence_failed')
  return data as T
}
async function readOrder(service: SupabaseClient, orderId: string) {
  assert(uuid(orderId), 'order_identity_invalid')
  const { data, error } = await service.from('payment_orders').select('*').eq('id', orderId).maybeSingle()
  assert(!error && data, 'order_missing')
  return data as SettlementOrder
}
async function readSettlement(service: SupabaseClient, settlementId: string) {
  const { data, error } = await service.from('payment_settlements').select('*').eq('id', settlementId).maybeSingle()
  assert(!error && data, 'settlement_missing')
  return data as PaymentSettlement
}
function assertOrderMode(order: SettlementOrder) { assert(order.stripe_livemode === configuredStripeLivemode(), 'settlement_mode_mismatch') }

/** Commercial inputs come from the authenticated server's offer snapshot. */
export async function createSettlementOrder({ service, id = randomUUID(), kind, buyerId, creatorId, accountId, grossCents, livemode, reference }: {
  service: SupabaseClient; id?: string; kind: Kind; buyerId: string; creatorId: string; accountId: string | null;
  grossCents: number; livemode: boolean; reference: Record<string, unknown>;
}): Promise<SettlementOrder> {
  assert(uuid(id) && uuid(buyerId) && uuid(creatorId), 'order_identity_invalid')
  assert(livemode === configuredStripeLivemode(), 'settlement_mode_mismatch')
  assert(Number.isSafeInteger(grossCents) && grossCents >= 0 && grossCents <= 2_000_000_000
    && (grossCents > 0 ? /^acct_[A-Za-z0-9]+$/.test(accountId ?? '') : kind === 'products'), 'order_amount_invalid')
  if (kind === 'products') {
    const items = reference.items as { productId: string; amountCents: number }[]
    assert(Array.isArray(items) && items.length > 0 && new Set(items.map(item => item.productId)).size === items.length
      && items.every(item => uuid(item.productId) && Number.isSafeInteger(item.amountCents) && item.amountCents >= 0)
      && items.reduce((sum, item) => sum + item.amountCents, 0) === grossCents, 'order_items_invalid')
  }
  if (kind === 'booking') assert(uuid(reference.bookingId) && reference.attemptId === id, 'order_booking_invalid')
  if (kind === 'subscription') assert(uuid(reference.tierId), 'order_tier_invalid')
  const fee = calculateArdorePlatformFee(grossCents)
  const row = { id, kind, buyer_id: buyerId, creator_id: creatorId, account_id: accountId, gross_cents: grossCents,
    platform_fee_cents: fee, coach_net_cents: grossCents - fee, stripe_livemode: livemode, reference }
  const { error } = await service.from('payment_orders').insert(row)
  if (error && error.code !== '23505') throw new SettlementError('order_persistence_failed')
  const saved = await readOrder(service, id)
  const equivalent = (a: unknown, b: unknown): boolean => {
    if (a === b) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equivalent(v, b[i]))
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>
    return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => equivalent(left[key], right[key]))
  }
  assert(Object.entries(row).every(([key, value]) => equivalent(saved[key as keyof SettlementOrder], value)), 'order_snapshot_mismatch')
  return saved
}

export async function registerSettlementCheckout({ service, orderId, sessionId, subscriptionId, provider = stripe }: {
  service: SupabaseClient; orderId: string; sessionId: string; subscriptionId?: string | null; provider?: Stripe;
}) {
  const order = await readOrder(service, orderId)
  assertOrderMode(order)
  const session = await provider.checkout.sessions.retrieve(sessionId)
  assert(session.id === sessionId && session.livemode === order.stripe_livemode
    && session.metadata?.ardore_order_id === order.id && session.metadata.buyer_id === order.buyer_id
    && session.metadata.creator_id === order.creator_id
    && session.mode === (order.kind === 'subscription' ? 'subscription' : 'payment'), 'order_checkout_mismatch')
  const actualSubscription = idOf(session.subscription)
  assert(!subscriptionId || actualSubscription === subscriptionId, 'order_subscription_mismatch')
  return rpc<SettlementOrder>(service, 'bind_settlement_checkout', { p_order_id: orderId, p_session_id: sessionId,
    p_subscription_id: subscriptionId ?? actualSubscription })
}

async function invoiceSnapshot(order: SettlementOrder, invoiceId: string, provider: Stripe) {
  const invoice = await provider.invoices.retrieve(invoiceId)
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
  assert(subscriptionId, 'invoice_subscription_missing')
  const subscription = await provider.subscriptions.retrieve(subscriptionId)
  assert(invoice.id === invoiceId && invoice.livemode === order.stripe_livemode && invoice.currency === 'eur'
    && invoice.status === 'paid' && subscription.livemode === order.stripe_livemode
    && subscription.metadata.ardore_order_id === order.id && subscription.metadata.buyer_id === order.buyer_id
    && subscription.metadata.creator_id === order.creator_id && subscription.metadata.tier_id === order.reference.tierId
    && !subscription.transfer_data && !subscription.application_fee_percent
    && (!order.stripe_subscription_id || order.stripe_subscription_id === subscription.id), 'invoice_ownership_mismatch')
  const payments = await provider.invoicePayments.list({ invoice: invoice.id, limit: 100 })
  const paid = payments.data.filter(payment => payment.status === 'paid')
  assert(!payments.has_more && paid.length === 1 && paid[0].payment.type === 'payment_intent'
    && paid[0].amount_paid === invoice.amount_paid, 'invoice_payment_unsupported')
  const intentId = idOf(paid[0].payment.payment_intent)
  assert(intentId, 'invoice_payment_intent_missing')
  return { invoice, subscription, intentId }
}

async function capturedPayment(order: SettlementOrder, paymentIntentId: string, provider: Stripe, invoiceId?: string | null) {
  assertOrderMode(order)
  const intent = await provider.paymentIntents.retrieve(paymentIntentId)
  const chargeId = idOf(intent.latest_charge)
  assert(chargeId && intent.status === 'succeeded' && intent.id === paymentIntentId && intent.livemode === order.stripe_livemode
    && intent.currency === 'eur' && !intent.transfer_data && !intent.application_fee_amount, 'captured_payment_mismatch')
  if (order.kind === 'subscription') {
    assert(invoiceId, 'invoice_cycle_missing')
    const cycle = await invoiceSnapshot(order, invoiceId, provider)
    assert(cycle.intentId === intent.id && cycle.invoice.amount_paid === intent.amount_received
      && idOf(cycle.invoice.customer) === idOf(intent.customer), 'invoice_payment_mismatch')
  } else {
    assert(intent.metadata.ardore_order_id === order.id && intent.metadata.buyer_id === order.buyer_id
      && intent.metadata.creator_id === order.creator_id && intent.amount_received === order.gross_cents, 'payment_order_mismatch')
  }
  const charge = await provider.charges.retrieve(chargeId)
  assert(charge.id === chargeId && idOf(charge.payment_intent) === intent.id && charge.paid && charge.captured
    && charge.livemode === order.stripe_livemode && charge.currency === 'eur' && charge.amount_captured > 0
    && charge.amount_captured === intent.amount_received && charge.amount_captured === intent.amount
    && !charge.transfer && !charge.transfer_data && !charge.application_fee && !charge.source_transfer
    && (!charge.transfer_group || charge.transfer_group === groupOf(order))
    && Number.isSafeInteger(charge.amount_refunded) && charge.amount_refunded >= 0 && charge.amount_refunded <= charge.amount_captured,
  'platform_charge_mismatch')
  if (order.kind !== 'subscription') assert(charge.metadata.ardore_order_id === order.id, 'charge_order_mismatch')
  return { intent, charge }
}

async function freshDisputeState(charge: Stripe.Charge, provider: Stripe): Promise<'disputed' | 'chargeback' | null> {
  if (!charge.disputed) return null
  // Charge.disputed is a historical marker. Only current provider disputes can
  // distinguish an unresolved/lost dispute from one that was won or closed.
  const disputes = await provider.disputes.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(disputes.length < 1000 && disputes.every(dispute => idOf(dispute.charge) === charge.id
    && dispute.livemode === charge.livemode && dispute.currency === charge.currency), 'dispute_ownership_mismatch')
  if (disputes.some(dispute => dispute.status === 'lost')) return 'chargeback'
  if (!disputes.length || disputes.some(dispute => !['won', 'warning_closed'].includes(dispute.status))) return 'disputed'
  return null
}

export async function recordSuccessfulSettlement({ service, orderId, paymentIntentId, sessionId, invoiceId, provider = stripe }: {
  service: SupabaseClient; orderId: string; paymentIntentId: string; sessionId?: string | null; invoiceId?: string | null; provider?: Stripe;
}): Promise<PaymentSettlement> {
  let order = await readOrder(service, orderId)
  if (sessionId) {
    await registerSettlementCheckout({ service, orderId, sessionId, provider })
    order = await readOrder(service, orderId)
  }
  const { charge } = await capturedPayment(order, paymentIntentId, provider, invoiceId)
  if (order.kind === 'subscription') {
    const { subscription } = await invoiceSnapshot(order, invoiceId!, provider)
    const { error } = await service.from('payment_orders').update({ stripe_subscription_id: subscription.id }).eq('id', order.id)
    assert(!error, 'subscription_binding_failed')
  }
  const saved = await rpc<PaymentSettlement>(service, 'record_payment_settlement', { p_order_id: order.id,
    p_snapshot: { gross_cents: charge.amount_captured, livemode: charge.livemode, currency: charge.currency,
      payment_intent_id: paymentIntentId, charge_id: charge.id, invoice_id: invoiceId ?? null, session_id: sessionId ?? order.stripe_checkout_session_id } })
  return saved
}

function assertTransfer(transfer: Stripe.Transfer, settlement: PaymentSettlement, order: SettlementOrder) {
  assert(transfer.metadata.ardore_settlement_id === settlement.id && transfer.metadata.ardore_order_id === order.id
    && idOf(transfer.source_transaction) === settlement.stripe_charge_id && idOf(transfer.destination) === settlement.account_id
    && transfer.currency === 'eur' && transfer.livemode === settlement.stripe_livemode && transfer.transfer_group === groupOf(order)
    && transfer.amount === settlement.transfer_amount_cents && transfer.amount_reversed >= 0 && transfer.amount_reversed <= transfer.amount,
  'settlement_transfer_mismatch')
}
async function transferSnapshot(settlement: PaymentSettlement, order: SettlementOrder, provider: Stripe) {
  if (!settlement.stripe_transfer_id) return { transfer: null, reversalIds: [] as string[] }
  const transfer = await provider.transfers.retrieve(settlement.stripe_transfer_id)
  assertTransfer(transfer, settlement, order)
  const reversals = await provider.transfers.listReversals(transfer.id, { limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(reversals.length < 1000 && reversals.every(reversal => idOf(reversal.transfer) === transfer.id
    && reversal.currency === 'eur' && reversal.amount > 0), 'transfer_reversal_mismatch')
  assert(reversals.reduce((sum, reversal) => sum + reversal.amount, 0) === transfer.amount_reversed, 'transfer_reversal_totals_mismatch')
  return { transfer, reversalIds: reversals.map(reversal => reversal.id) }
}
async function recoverTransfer(settlement: PaymentSettlement, order: SettlementOrder, provider: Stripe) {
  if (settlement.transfer_amount_cents === null) return null
  const candidates = await provider.transfers.list({ transfer_group: groupOf(order), limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(candidates.length < 1000, 'transfer_history_limit')
  const owned = candidates.filter(transfer => transfer.metadata.ardore_settlement_id === settlement.id)
  assert(owned.length <= 1, 'duplicate_transfer_requires_review')
  if (owned[0]) assertTransfer(owned[0], settlement, order)
  return owned[0] ?? null
}
async function observe(service: SupabaseClient, settlement: PaymentSettlement, charge: Stripe.Charge,
  provider: Stripe, extras: Record<string, unknown> = {}) {
  const checkedAt = new Date().toISOString()
  const { transfer, reversalIds } = await transferSnapshot(settlement, await readOrder(service, settlement.order_id), provider)
  return rpc<PaymentSettlement>(service, 'observe_payment_settlement', { p_settlement_id: settlement.id,
    p_snapshot: { refunded_cents: charge.amount_refunded, reversed_cents: transfer?.amount_reversed ?? 0,
      reversal_ids: reversalIds, checked_at: checkedAt, ...extras } })
}
async function fulfill(service: SupabaseClient, order: SettlementOrder, settlement: PaymentSettlement | null,
  extras: Record<string, unknown> = {}) {
  return rpc<{ newly_fulfilled?: boolean; is_new_subscription?: boolean; refund_required?: boolean }>(service, 'fulfill_payment_order',
    { p_order_id: order.id, p_settlement_id: settlement?.id ?? null, ...extras })
}
function uncertain(error: unknown) {
  const e = error as { type?: string; code?: string; statusCode?: number }
  return !(e.type === 'StripeInvalidRequestError' || e.type === 'StripePermissionError'
    || e.type === 'StripeAuthenticationError' || (e.statusCode && e.statusCode >= 400 && e.statusCode < 500
      && ![409,429].includes(e.statusCode)))
}
async function finish(service: SupabaseClient, settlement: PaymentSettlement, action: Action, leaseToken: string,
  objectId: string | null, unknown = false, code: string | null = null) {
  const done = await rpc<boolean>(service, 'finish_settlement_action', { p_settlement_id: settlement.id,
    p_action_id: action.id, p_lease_token: leaseToken, p_object_id: objectId, p_uncertain: unknown, p_error_code: code })
  assert(done, 'settlement_lease_changed')
}

/** Money is already durably captured and fulfillment must exist before this call can transfer. */
export async function settlePayment({ service, settlementId, provider = stripe }: {
  service: SupabaseClient; settlementId: string; provider?: Stripe;
}): Promise<PaymentSettlement> {
  let settlement = await readSettlement(service, settlementId)
  const order = await readOrder(service, settlement.order_id)
  const { charge } = await capturedPayment(order, settlement.stripe_payment_intent_id, provider, settlement.stripe_invoice_id)
  if (settlement.fulfillment_state === 'awaiting' && order.kind !== 'subscription') {
    await fulfill(service, order, settlement)
    settlement = await readSettlement(service, settlementId)
  }
  settlement = await observe(service, settlement, charge, provider)
  if (await freshDisputeState(charge, provider)) {
    const { error } = await service.from('payment_settlements').update({ state: 'held', last_error_code: 'payment_disputed' }).eq('id', settlement.id)
    assert(!error, 'settlement_persistence_failed')
    return readSettlement(service, settlement.id)
  }
  if (settlement.fulfillment_state !== 'fulfilled'
    || settlement.refund_requested_cents > charge.amount_refunded || charge.amount_refunded === charge.amount_captured) return settlement
  if (settlement.stripe_transfer_id) return settlement
  // Pending refunds must reserve their money before any coach transfer.
  const refunds = await provider.refunds.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(refunds.length < 1000, 'refund_history_limit')
  if (refunds.some(refund => !['failed','canceled','succeeded'].includes(refund.status ?? ''))) return settlement
  const amount = settlement.coach_net_cents - Math.floor(settlement.coach_net_cents * charge.amount_refunded / settlement.gross_cents)
  if (amount <= 0) return settlement
  // Never reuse frozen provider parameters after a partial refund changed the
  // payable amount. The previous attempt must be reconciled explicitly.
  if (settlement.transfer_amount_cents !== null && settlement.transfer_amount_cents !== amount) {
    const { error } = await service.from('payment_settlements').update({ state: 'held', last_error_code: 'partial_refund_after_transfer_attempt' }).eq('id', settlement.id)
    assert(!error, 'settlement_persistence_failed')
    return readSettlement(service, settlement.id)
  }
  const leaseToken = randomUUID()
  const claimed = await rpc<{ action?: Action; busy?: boolean; done?: boolean; blocked?: boolean }>(service, 'claim_settlement_action',
    { p_settlement_id: settlement.id, p_kind: 'transfer', p_target_cents: 0, p_amount_cents: amount, p_lease_token: leaseToken })
  if (claimed.done || claimed.blocked) return readSettlement(service, settlement.id)
  assert(!claimed.busy && claimed.action, 'settlement_busy')
  const action = claimed.action
  settlement = await readSettlement(service, settlement.id)
  const priorUncertain = action.uncertain
  let postStarted = false
  try {
    const existing = await recoverTransfer(settlement, order, provider)
    if (existing) {
      await finish(service, settlement, action, leaseToken, existing.id)
      return observe(service, await readSettlement(service, settlement.id), charge, provider)
    }
    assert(!priorUncertain || Date.now() - new Date(action.request_started_at).getTime() < 23 * 3_600_000, 'transfer_result_unknown')
    const current = await readSettlement(service, settlement.id)
    assert(current.refund_requested_cents <= current.amount_refunded_cents && current.fulfillment_state === 'fulfilled', 'settlement_refund_pending')
    // This is deliberately the last provider read before money movement. A
    // cached flag, callback, client payload or replacement account cannot authorize it.
    const ready = await requirePayoutReadyCoach(service, settlement.creator_id, provider)
    assert(ready.accountId === settlement.account_id && ready.livemode === settlement.stripe_livemode, 'settlement_account_changed')
    const { error: markError } = await service.from('payment_settlement_actions').update({ uncertain: true }).eq('id', action.id)
    assert(!markError, 'settlement_persistence_failed')
    postStarted = true
    const transfer = await provider.transfers.create({ amount: action.amount_cents, currency: 'eur',
      destination: settlement.account_id, source_transaction: charge.id, transfer_group: groupOf(order),
      metadata: { ardore_settlement_id: settlement.id, ardore_order_id: order.id, ardore_action_id: action.id,
        creator_id: settlement.creator_id, buyer_id: settlement.buyer_id } }, { idempotencyKey: action.idempotency_key })
    assertTransfer(transfer, settlement, order)
    await finish(service, settlement, action, leaseToken, transfer.id)
    return observe(service, await readSettlement(service, settlement.id), charge, provider,
      { eligibility_checked_at: new Date().toISOString(), error_code: null })
  } catch (error) {
    // A response may be lost after Stripe created the transfer. Recover it by
    // immutable source/owner metadata before permitting a retry or refund.
    try {
      const existing = await recoverTransfer(settlement, order, provider)
      if (existing) {
        await finish(service, settlement, action, leaseToken, existing.id)
        return observe(service, await readSettlement(service, settlement.id), charge, provider)
      }
    } catch { /* Preserve the unknown mutation; its key remains durable. */ }
    await finish(service, settlement, action, leaseToken, null,
      priorUncertain || (postStarted && uncertain(error)), safeCode(error))
    if (error instanceof ConnectReadinessError || safeCode(error) === 'settlement_account_changed') {
      const { error: saveError } = await service.from('payment_settlements').update({ state: 'held', last_error_code: safeCode(error) }).eq('id', settlement.id)
      assert(!saveError, 'settlement_persistence_failed')
      return readSettlement(service, settlement.id)
    }
    throw new SettlementError(safeCode(error))
  }
}

export type SettlementRefundContext = {
  settlementId: string; orderId: string; kind: Kind; buyerId: string; creatorId: string; accountId: string;
  grossCents: number; livemode: boolean; reference: Record<string, unknown>; transferGroup: string;
  transferId: string | null; transferAmount: number; reversedAmount: number; reversalIds: string[];
}
export async function getSettlementRefundContext({ service, paymentIntentId, provider = stripe }: {
  service: SupabaseClient; paymentIntentId: string; provider?: Stripe;
}): Promise<SettlementRefundContext | null> {
  const { data, error } = await service.from('payment_settlements').select('*').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
  assert(!error, 'settlement_persistence_failed')
  if (!data) return null
  const settlement = data as PaymentSettlement
  const order = await readOrder(service, settlement.order_id)
  await capturedPayment(order, paymentIntentId, provider, settlement.stripe_invoice_id)
  const { transfer, reversalIds } = await transferSnapshot(settlement, order, provider)
  return { settlementId: settlement.id, orderId: order.id, kind: order.kind, buyerId: order.buyer_id,
    creatorId: order.creator_id, accountId: settlement.account_id, grossCents: settlement.gross_cents,
    livemode: settlement.stripe_livemode, reference: order.reference, transferGroup: groupOf(order),
    transferId: transfer?.id ?? null, transferAmount: transfer?.amount ?? 0, reversedAmount: transfer?.amount_reversed ?? 0, reversalIds }
}

/** Latch the refund BEFORE reversing funds, so no concurrent retry starts settlement. */
export async function prepareSettlementRefund({ service, paymentIntentId, targetRefundedCents, refundKey, provider = stripe }: {
  service: SupabaseClient; paymentIntentId: string; targetRefundedCents: number; refundKey: string; provider?: Stripe;
}): Promise<SettlementRefundContext | null> {
  let context = await getSettlementRefundContext({ service, paymentIntentId, provider })
  if (!context) return null
  assert(Number.isSafeInteger(targetRefundedCents) && targetRefundedCents >= 0 && targetRefundedCents <= context.grossCents
    && typeof refundKey === 'string' && refundKey.length > 0, 'refund_target_invalid')
  let settlement = await rpc<PaymentSettlement>(service, 'request_settlement_refund', { p_settlement_id: context.settlementId, p_target_cents: targetRefundedCents })
  const order = await readOrder(service, settlement.order_id)
  // If an earlier transfer POST is unresolved, never assume it failed and refund
  // money that might also have reached the coach. An active worker must finish first.
  assert(!settlement.lease_expires_at || new Date(settlement.lease_expires_at).getTime() <= Date.now(), 'settlement_busy')
  if (!settlement.stripe_transfer_id && settlement.transfer_amount_cents !== null) {
    const recovered = await recoverTransfer(settlement, order, provider)
    const { data: action, error } = await service.from('payment_settlement_actions').select('*')
      .eq('settlement_id', settlement.id).eq('kind', 'transfer').maybeSingle()
    assert(!error && action, 'transfer_action_missing')
    if (recovered) {
      // Adoption is identity-checked, not a new money movement.
      const { error: bindError } = await service.from('payment_settlements').update({ stripe_transfer_id: recovered.id }).eq('id', settlement.id)
      assert(!bindError, 'transfer_binding_failed')
      const { error: actionError } = await service.from('payment_settlement_actions')
        .update({ stripe_object_id: recovered.id, uncertain: false }).eq('id', action.id)
      assert(!actionError, 'transfer_binding_failed')
      settlement = await readSettlement(service, settlement.id)
      context = await getSettlementRefundContext({ service, paymentIntentId, provider })
      assert(context, 'settlement_missing')
    } else assert(action.uncertain === false, 'transfer_result_unknown')
  }
  if (!context.transferId) return context
  // Adopt successful reversals whose provider response was lost, including
  // earlier partial reversals before claiming a larger cumulative target.
  const provenReversals = await provider.transfers.listReversals(context.transferId, { limit: 100 }).autoPagingToArray({ limit: 1000 })
  const { data: actionRows, error: actionReadError } = await service.from('payment_settlement_actions').select('*')
    .eq('settlement_id', settlement.id).eq('kind', 'reversal')
  assert(!actionReadError, 'settlement_persistence_failed')
  for (const candidate of (actionRows ?? []) as Action[]) {
    const proven = provenReversals.filter(reversal => reversal.metadata?.ardore_action_id === candidate.id)
    assert(proven.length <= 1, 'duplicate_reversal_requires_review')
    if (proven[0]) {
      assert(proven[0].amount === candidate.amount_cents && idOf(proven[0].transfer) === context.transferId,
        'reversal_identity_mismatch')
      const { error } = await service.from('payment_settlement_actions').update({ stripe_object_id: proven[0].id, uncertain: false }).eq('id', candidate.id)
      assert(!error, 'settlement_persistence_failed')
    }
  }
  const captured = await capturedPayment(order, paymentIntentId, provider, settlement.stripe_invoice_id)
  settlement = await observe(service, settlement, captured.charge, provider)
  const required = Math.min(context.transferAmount, Math.max(0,
    Math.floor(settlement.coach_net_cents * targetRefundedCents / settlement.gross_cents)
      - Math.floor(settlement.coach_net_cents * settlement.pretransfer_refunded_cents / settlement.gross_cents)))
  if (context.reversedAmount >= required) return context
  const leaseToken = randomUUID()
  const claim = await rpc<{ action?: Action; busy?: boolean; done?: boolean }>(service, 'claim_settlement_action',
    { p_settlement_id: settlement.id, p_kind: 'reversal', p_target_cents: required,
      p_amount_cents: required - context.reversedAmount, p_lease_token: leaseToken })
  if (claim.done) return getSettlementRefundContext({ service, paymentIntentId, provider })
  assert(!claim.busy && claim.action, 'settlement_busy')
  const action = claim.action
  const priorUncertain = action.uncertain
  let postStarted = false
  try {
    const reversals = await provider.transfers.listReversals(context.transferId, { limit: 100 }).autoPagingToArray({ limit: 1000 })
    const existing = reversals.filter(reversal => reversal.metadata?.ardore_action_id === action.id)
    assert(existing.length <= 1, 'duplicate_reversal_requires_review')
    let reversal = existing[0]
    if (!reversal) {
      assert(!action.uncertain || Date.now() - new Date(action.request_started_at).getTime() < 23 * 3_600_000, 'reversal_result_unknown')
      const latest = await provider.transfers.retrieve(context.transferId)
      assertTransfer(latest, settlement, order)
      assert(action.amount_cents <= latest.amount - latest.amount_reversed, 'reversal_amount_exceeds_transfer')
      const { error: markError } = await service.from('payment_settlement_actions').update({ uncertain: true }).eq('id', action.id)
      assert(!markError, 'settlement_persistence_failed')
      postStarted = true
      reversal = await provider.transfers.createReversal(context.transferId, { amount: action.amount_cents,
        metadata: { ardore_settlement_id: settlement.id, ardore_action_id: action.id, ardore_refund_key: refundKey } },
      { idempotencyKey: action.idempotency_key })
    }
    assert(idOf(reversal.transfer) === context.transferId && reversal.amount === action.amount_cents
      && reversal.metadata?.ardore_action_id === action.id, 'reversal_identity_mismatch')
    await finish(service, settlement, action, leaseToken, reversal.id)
    return getSettlementRefundContext({ service, paymentIntentId, provider })
  } catch (error) {
    await finish(service, settlement, action, leaseToken, null, priorUncertain || (postStarted && uncertain(error)), safeCode(error))
    throw new SettlementError(safeCode(error))
  }
}

export async function reconcileSettlementRefund({ service, paymentIntentId, provider = stripe }: {
  service: SupabaseClient; paymentIntentId: string; provider?: Stripe;
}): Promise<SettlementRefundContext | null> {
  const context = await getSettlementRefundContext({ service, paymentIntentId, provider })
  if (!context) return null
  let settlement = await readSettlement(service, context.settlementId)
  const order = await readOrder(service, context.orderId)
  const { charge } = await capturedPayment(order, paymentIntentId, provider, settlement.stripe_invoice_id)
  const refunds = await provider.refunds.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 1000 })
  assert(refunds.length < 1000 && refunds.every(refund => idOf(refund.charge) === charge.id && refund.currency === 'eur'
    && Number.isSafeInteger(refund.amount) && refund.amount > 0), 'refund_ownership_mismatch')
  const reserved = refunds.filter(refund => !['failed','canceled'].includes(refund.status ?? '')).reduce((sum, refund) => sum + refund.amount, 0)
  assert(reserved <= settlement.gross_cents, 'refund_total_exceeds_payment')
  if (reserved > 0) await prepareSettlementRefund({ service, paymentIntentId, targetRefundedCents: reserved,
    refundKey: `ardore-settlement-${settlement.id}-provider-refunds`, provider })
  settlement = await readSettlement(service, settlement.id)
  settlement = await observe(service, settlement, charge, provider)
  if (order.kind === 'products') {
    // Reconcile only entitlements still bound to THIS payment. A delayed refund
    // for an older purchase must never revoke a newer purchase.
    const disputeState = await freshDisputeState(charge, provider)
    for (const item of order.reference.items as { productId: string; amountCents: number }[]) {
      const refundedCents = Math.floor(item.amountCents * settlement.amount_refunded_cents / settlement.gross_cents)
      let projection = service.from('purchases').update({ payment_status: settlement.amount_refunded_cents === settlement.gross_cents
        ? 'refunded' : disputeState ?? (settlement.amount_refunded_cents > 0 ? 'partially_refunded' : 'paid'), amount_refunded: refundedCents / 100,
      updated_at: new Date().toISOString() }).eq('buyer_id', order.buyer_id).eq('product_id', item.productId)
        .eq('stripe_payment_intent_id', paymentIntentId).eq('stripe_livemode', settlement.stripe_livemode)
        .lte('amount_refunded', refundedCents / 100)
      // A snapshot fetched before a dispute opened cannot erase a protected
      // dispute status. Restoration requires a positively observed resolution.
      if (!charge.disputed && settlement.amount_refunded_cents < settlement.gross_cents) {
        projection = projection.not('payment_status', 'in', '(disputed,chargeback)')
      }
      const { error } = await projection
      assert(!error, 'purchase_refund_persistence_failed')
    }
  }
  return getSettlementRefundContext({ service, paymentIntentId, provider })
}

async function refundUnfulfillable(service: SupabaseClient, settlement: PaymentSettlement, provider: Stripe) {
  const key = `ardore-settlement-${settlement.id}-unfulfilled-refund-v1`
  await prepareSettlementRefund({ service, paymentIntentId: settlement.stripe_payment_intent_id,
    targetRefundedCents: settlement.gross_cents, refundKey: key, provider })
  const refunds = await provider.refunds.list({ charge: settlement.stripe_charge_id, limit: 100 }).autoPagingToArray({ limit: 1000 })
  const active = refunds.filter(refund => !['failed','canceled'].includes(refund.status ?? ''))
  if (active.reduce((sum, refund) => sum + refund.amount, 0) < settlement.gross_cents) {
    assert(active.length === 0, 'unfulfilled_partial_refund_requires_review')
    await provider.refunds.create({ charge: settlement.stripe_charge_id, amount: settlement.gross_cents,
      metadata: { ardore_settlement_id: settlement.id, ardore_refund_key: key } }, { idempotencyKey: key })
  }
  await reconcileSettlementRefund({ service, paymentIntentId: settlement.stripe_payment_intent_id, provider })
}
function fulfillmentResult(order: SettlementOrder, result: { newly_fulfilled?: boolean; is_new_subscription?: boolean }): SettlementFulfillmentResult {
  return { handled: true, kind: order.kind, newlyFulfilled: result.newly_fulfilled === true,
    buyerId: order.buyer_id, creatorId: order.creator_id,
    ...(order.kind === 'products' ? { items: order.reference.items as { productId: string; amountCents: number }[],
      withdrawalConsentAt: typeof order.reference.withdrawalConsentAt === 'string' ? order.reference.withdrawalConsentAt : undefined } : {}),
    ...(order.kind === 'subscription' ? { tierId: String(order.reference.tierId), notifySubscriber: result.is_new_subscription === true } : {}) }
}

export async function reconcileSettlementCheckout({ service, sessionId, provider = stripe }: {
  service: SupabaseClient; sessionId: string; provider?: Stripe;
}): Promise<SettlementFulfillmentResult> {
  const session = await provider.checkout.sessions.retrieve(sessionId)
  if (!session.metadata?.ardore_order_id) return { handled: false }
  const order = await readOrder(service, session.metadata.ardore_order_id)
  await registerSettlementCheckout({ service, orderId: order.id, sessionId, provider })
  assert(order.kind !== 'booking', 'booking_requires_lifecycle_fulfillment')
  if (session.status === 'expired' && session.payment_status !== 'paid') {
    if (order.reference.discountRedemptionId) await rpc(service, 'release_discount_redemption', { p_id: order.reference.discountRedemptionId })
    return { handled: true }
  }
  if (order.kind === 'subscription') {
    const invoiceId = idOf(session.invoice)
    if (!invoiceId) return { handled: true }
    return reconcileSettlementInvoice({ service, invoiceId, provider })
  }
  assert(session.currency === 'eur' && session.amount_total === order.gross_cents, 'checkout_amount_mismatch')
  if (order.gross_cents === 0) {
    assert(session.status === 'complete' && ['paid','no_payment_required'].includes(session.payment_status) && !session.payment_intent,
      'free_checkout_not_complete')
    return fulfillmentResult(order, await fulfill(service, order, null))
  }
  if (session.payment_status !== 'paid') return { handled: true }
  const paymentIntentId = idOf(session.payment_intent)
  assert(paymentIntentId, 'checkout_payment_missing')
  const settlement = await recordSuccessfulSettlement({ service, orderId: order.id, paymentIntentId, sessionId, provider })
  const { charge } = await capturedPayment(order, paymentIntentId, provider)
  const disputeState = await freshDisputeState(charge, provider)
  if (charge.amount_refunded > 0 || charge.disputed) {
    await reconcileSettlementRefund({ service, paymentIntentId, provider })
    if (charge.amount_refunded === charge.amount_captured || disputeState) return { handled: true }
  }
  const result = await fulfill(service, order, settlement)
  try {
    if (result.refund_required) await refundUnfulfillable(service, settlement, provider)
    else {
      // A partial provider refund does not erase a successful purchase. Apply
      // its projection after the atomic entitlement insert, then settle only
      // the remaining coach share.
      if (charge.amount_refunded > 0) await reconcileSettlementRefund({ service, paymentIntentId, provider })
      await settlePayment({ service, settlementId: settlement.id, provider })
    }
  } catch { return { ...fulfillmentResult(order, result), retryNeeded: true } }
  return fulfillmentResult(order, result)
}

export async function reconcileSettlementInvoice({ service, invoiceId, provider = stripe }: {
  service: SupabaseClient; invoiceId: string; provider?: Stripe;
}): Promise<SettlementFulfillmentResult> {
  const invoice = await provider.invoices.retrieve(invoiceId)
  const subscriptionId = idOf(invoice.parent?.subscription_details?.subscription)
  if (!subscriptionId) return { handled: false }
  const subscription = await provider.subscriptions.retrieve(subscriptionId)
  if (!subscription.metadata.ardore_order_id) return { handled: false }
  const order = await readOrder(service, subscription.metadata.ardore_order_id)
  assert(order.kind === 'subscription' && subscription.livemode === order.stripe_livemode, 'subscription_order_mismatch')
  if (invoice.status !== 'paid') { await reconcileSubscriptionStatus(service, subscription); return { handled: true } }
  const cycle = await invoiceSnapshot(order, invoiceId, provider)
  const settlement = await recordSuccessfulSettlement({ service, orderId: order.id, paymentIntentId: cycle.intentId, invoiceId, provider })
  const { charge } = await capturedPayment(order, cycle.intentId, provider, invoiceId)
  const disputeState = await freshDisputeState(charge, provider)
  if (charge.amount_refunded > 0 || charge.disputed) {
    await reconcileSettlementRefund({ service, paymentIntentId: cycle.intentId, provider })
    if (charge.amount_refunded === charge.amount_captured || disputeState) return { handled: true }
  }
  const periodEnd = Math.max(...invoice.lines.data.map(line => line.period.end))
  assert(Number.isSafeInteger(periodEnd) && periodEnd > 0, 'invoice_period_missing')
  const result = await fulfill(service, order, settlement, { p_period_end: new Date(periodEnd * 1000).toISOString(),
    p_subscription_status: subscriptionState(subscription) })
  try {
    if (result.refund_required) await refundUnfulfillable(service, settlement, provider)
    else await settlePayment({ service, settlementId: settlement.id, provider })
  }
  catch { return { ...fulfillmentResult(order, result), retryNeeded: true } }
  return fulfillmentResult(order, result)
}
function subscriptionState(subscription: Stripe.Subscription) {
  return subscription.status === 'active' ? 'active' : subscription.status === 'trialing' ? 'trialing'
    : ['canceled','incomplete_expired'].includes(subscription.status) ? 'canceled' : 'past_due'
}
async function reconcileSubscriptionStatus(service: SupabaseClient, subscription: Stripe.Subscription) {
  const order = await readOrder(service, subscription.metadata.ardore_order_id)
  assertOrderMode(order)
  assert(order.kind === 'subscription' && order.stripe_subscription_id === subscription.id
    && subscription.metadata.buyer_id === order.buyer_id && subscription.metadata.creator_id === order.creator_id, 'subscription_identity_mismatch')
  // Status events cannot extend access: only a paid invoice advances its period.
  const { error } = await service.from('subscriptions').update({ status: subscriptionState(subscription) })
    .eq('stripe_subscription_id', subscription.id).eq('buyer_id', order.buyer_id).eq('creator_id', order.creator_id)
  assert(!error, 'subscription_status_persistence_failed')
}

/** Only private, explicitly retired fixture IDs may bypass a signed TEST event. */
export async function isRetiredStripeTestEvent({ service, event }: { service: SupabaseClient; event: Stripe.Event }) {
  if (event.livemode !== false) return false
  const objectId = (event.data.object as { id?: string }).id
  if (!objectId) return false
  const { data, error } = await service.from('retired_stripe_test_runs').select('id')
    .contains('object_ids', [objectId]).limit(1).maybeSingle()
  assert(!error, 'retired_fixture_check_failed')
  return !!data
}

/** Recovery is explicit and owner-scoped; it never changes financial snapshots. */
export async function recoverCoachSettlements({ service, creatorId, limit = 25 }: {
  service: SupabaseClient; creatorId: string; limit?: number;
}) {
  const { data, error } = await service.from('payment_settlements').select('*').eq('creator_id', creatorId)
    .eq('stripe_livemode', configuredStripeLivemode())
    .in('state', ['awaiting_fulfillment','pending','held','transferring','failed','refund_pending','reversing'])
    .order('updated_at').limit(Math.min(25, Math.max(1, limit)))
  assert(!error, 'settlement_persistence_failed')
  const result = { checked: 0, settled: 0, held: 0, refunded: 0, failed: 0 }
  for (const row of (data ?? []) as PaymentSettlement[]) {
    result.checked++
    try {
      await reconcileSettlementRefund({ service, paymentIntentId: row.stripe_payment_intent_id })
      if (row.kind === 'subscription' && row.stripe_invoice_id) {
        const recovered = await reconcileSettlementInvoice({ service, invoiceId: row.stripe_invoice_id })
        if (recovered.retryNeeded) throw new SettlementError('settlement_retry_failed')
      } else if (row.kind === 'products' && row.stripe_checkout_session_id) {
        const recovered = await reconcileSettlementCheckout({ service, sessionId: row.stripe_checkout_session_id })
        if (recovered.retryNeeded) throw new SettlementError('settlement_retry_failed')
      } else await settlePayment({ service, settlementId: row.id })
      const saved = await readSettlement(service, row.id)
      if (saved.state === 'settled') result.settled++
      else if (saved.state === 'refunded') result.refunded++
      else result.held++
    } catch { result.failed++ }
  }
  return result
}

export async function reconcileSettlementProviderEvent({ service, event, provider = stripe }: {
  service: SupabaseClient; event: Stripe.Event; provider?: Stripe;
}): Promise<SettlementFulfillmentResult> {
  assert(event.livemode === configuredStripeLivemode(), 'settlement_mode_mismatch')
  const eventObject = event.data.object as { id?: string }
  if (!eventObject.id) return { handled: false }
  const eventObjectId = eventObject.id
  if (event.type.startsWith('invoice.')) return reconcileSettlementInvoice({ service, invoiceId: eventObjectId, provider })
  if (event.type.startsWith('customer.subscription.')) {
    const subscription = await provider.subscriptions.retrieve(eventObjectId)
    if (!subscription.metadata.ardore_order_id) return { handled: false }
    await reconcileSubscriptionStatus(service, subscription)
    return { handled: true }
  }
  let paymentIntentId: string | null = null
  if (event.type.startsWith('payment_intent.')) paymentIntentId = eventObjectId
  else if (event.type.startsWith('charge.dispute.')) {
    const dispute = await provider.disputes.retrieve(eventObjectId)
    assert(dispute.id === eventObjectId && dispute.livemode === event.livemode && dispute.currency === 'eur', 'dispute_ownership_mismatch')
    const chargeId = idOf(dispute.charge)
    assert(chargeId, 'dispute_charge_missing')
    const charge = await provider.charges.retrieve(chargeId)
    assert(charge.id === chargeId && charge.livemode === dispute.livemode && charge.currency === dispute.currency, 'dispute_ownership_mismatch')
    paymentIntentId = idOf(charge.payment_intent)
  } else if (event.type.startsWith('charge.')) {
    const charge = await provider.charges.retrieve(eventObjectId)
    paymentIntentId = idOf(charge.payment_intent)
  } else if (event.type.startsWith('refund.')) {
    const refund = await provider.refunds.retrieve(eventObjectId)
    paymentIntentId = idOf(refund.payment_intent)
  } else if (event.type.startsWith('transfer.')) {
    const transfer = await provider.transfers.retrieve(eventObjectId)
    const { data, error } = await service.from('payment_settlements').select('*').eq('id', transfer.metadata.ardore_settlement_id ?? randomUUID()).maybeSingle()
    assert(!error, 'settlement_persistence_failed')
    if (!data) return { handled: false }
    paymentIntentId = data.stripe_payment_intent_id
  } else return { handled: false }
  if (!paymentIntentId) return { handled: false }
  const intent = await provider.paymentIntents.retrieve(paymentIntentId)
  const { data, error } = await service.from('payment_settlements').select('*').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle()
  assert(!error, 'settlement_persistence_failed')
  if (!data && !intent.metadata.ardore_order_id) return { handled: false }
  if (!data && intent.metadata.checkout_type === 'coaching_session') return { handled: false }
  if (!data && intent.status === 'succeeded') {
    const sessions = await provider.checkout.sessions.list({ payment_intent: intent.id, limit: 10 })
    assert(sessions.data.length === 1, 'payment_checkout_missing')
    return reconcileSettlementCheckout({ service, sessionId: sessions.data[0].id, provider })
  }
  if (!data) return { handled: true }
  const settlement = data as PaymentSettlement
  await reconcileSettlementRefund({ service, paymentIntentId, provider })
  if (event.type === 'payment_intent.succeeded' || event.type === 'charge.updated' || event.type === 'transfer.created'
    || event.type === 'charge.dispute.closed') {
    if (settlement.kind === 'booking') return { handled: true }
    if (settlement.stripe_invoice_id) return reconcileSettlementInvoice({ service, invoiceId: settlement.stripe_invoice_id, provider })
    if (settlement.stripe_checkout_session_id) return reconcileSettlementCheckout({ service, sessionId: settlement.stripe_checkout_session_id, provider })
  }
  return { handled: true }
}
