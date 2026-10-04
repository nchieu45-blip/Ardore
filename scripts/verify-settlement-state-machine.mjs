import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const ids = { order: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', buyer: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  coach: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', booking: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  settlement: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }
function fixture(options = {}) {
  const kind = options.kind ?? 'booking'
  const offerId = 'abababab-abab-4aba-8aba-abababababab'
  const order = { id: ids.order, kind, buyer_id: ids.buyer, creator_id: ids.coach,
    account_id: 'acct_syntheticReady', gross_cents: 500, platform_fee_cents: 50, coach_net_cents: 450,
    stripe_livemode: false, reference: kind === 'products' ? { items: [{ productId: offerId, amountCents: 500 }] }
      : kind === 'subscription' ? { tierId: offerId } : { bookingId: ids.booking, attemptId: ids.order },
    state: 'checkout_created', stripe_checkout_session_id: 'cs_synthetic', stripe_subscription_id: kind === 'subscription' ? 'sub_synthetic' : null }
  const metadata = { ardore_order_id: ids.order, buyer_id: ids.buyer, creator_id: ids.coach,
    checkout_type: 'coaching_session', booking_id: ids.booking, payment_attempt_id: ids.order }
  const intent = { id: 'pi_synthetic', latest_charge: 'ch_synthetic', status: 'succeeded', amount: 500,
    amount_received: 500, currency: 'eur', livemode: false, metadata, transfer_data: null,
    application_fee_amount: null, transfer_group: `ardore-order-${ids.order}`, customer: 'cus_synthetic' }
  const charge = { id: 'ch_synthetic', payment_intent: intent.id, paid: true, captured: true,
    amount_captured: 500, amount_refunded: 0, currency: 'eur', livemode: false, disputed: false,
    metadata, transfer: null, transfer_data: null, application_fee: null, source_transfer: null,
    transfer_group: intent.transfer_group }
  const session = { id: 'cs_synthetic', mode: kind === 'subscription' ? 'subscription' : 'payment', livemode: false, metadata, payment_intent: intent.id,
    currency: 'eur', amount_total: 500, payment_status: 'paid', status: 'complete', subscription: null }
  const invoice = { id: 'in_synthetic', parent: { subscription_details: { subscription: 'sub_synthetic' } },
    livemode: false, currency: 'eur', status: 'paid', amount_paid: 500, customer: 'cus_synthetic',
    lines: { data: [{ period: { end: 1900000000 } }] } }
  const subscription = { id: 'sub_synthetic', livemode: false, status: 'active',
    metadata: { ardore_order_id: ids.order, buyer_id: ids.buyer, creator_id: ids.coach, tier_id: offerId },
    transfer_data: null, application_fee_percent: null }
  const transfers = new Map(), reversals = new Map(), actions = new Map(), refunds = [], purchases = [], disputes = []
  const calls = { transferPosts: [], reversalPosts: [], refundPosts: [], readiness: [], rpcs: [], entitlements: 0 }
  let settlement = null, ready = options.ready !== false, readyAccount = order.account_id
  let transferFailure = options.transferFailure, reversalFailure = options.reversalFailure
  let transferDiscoveryFailure = false, hiddenTransfers = false, finishFailure = false, beforeTransfer = null
  const clone = value => value == null ? value : structuredClone(value)
  const tables = () => ({ payment_orders: [order], payment_settlements: settlement ? [settlement] : [], payment_settlement_actions: [...actions.values()], purchases })
  const service = {
    from(table) {
      const filters = []; let mode = 'select', changes
      const execute = () => {
        assert.ok(table in tables(), table)
        const rows = tables()[table].filter(row => filters.every(predicate => predicate(row)))
        if (mode === 'update') for (const row of rows) Object.assign(row, clone(changes))
        if (mode === 'insert') return { data: null, error: { code: '23505' } }
        return { data: clone(rows), error: null }
      }
      return {
        select() { return this }, eq(key, value) { filters.push(row => row[key] === value); return this },
        lte(key, value) { filters.push(row => row[key] <= value); return this },
        not(key, operator, values) {
          assert.equal(operator, 'in')
          const blocked = values.slice(1, -1).split(',')
          filters.push(row => !blocked.includes(row[key])); return this
        },
        update(values) { mode = 'update'; changes = values; return this }, insert(values) { mode = 'insert'; changes = values; return this },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) },
      }
    },
    async rpc(name, params) {
      calls.rpcs.push({ name, params: clone(params) })
      if (name === 'bind_settlement_checkout') {
        assert.equal(params.p_order_id, order.id); assert.equal(params.p_session_id, session.id)
        return { data: clone(order), error: null }
      }
      if (name === 'release_discount_redemption') return {data:{released:true},error:null}
      if (name === 'record_payment_settlement') {
        assert.equal(params.p_order_id, order.id)
        const s = params.p_snapshot
        if (settlement) {
          assert.equal(s.payment_intent_id, settlement.stripe_payment_intent_id)
          assert.equal(s.charge_id, settlement.stripe_charge_id); assert.equal(s.gross_cents, settlement.gross_cents)
        } else settlement = { id: ids.settlement, order_id: order.id, kind: order.kind, buyer_id: order.buyer_id,
          creator_id: order.creator_id, account_id: order.account_id, gross_cents: s.gross_cents,
          platform_fee_cents: 50, coach_net_cents: 450, stripe_livemode: s.livemode,
          stripe_payment_intent_id: s.payment_intent_id, stripe_charge_id: s.charge_id,
          stripe_invoice_id: s.invoice_id, stripe_checkout_session_id: s.session_id, stripe_subscription_id: null,
          stripe_transfer_id: null, transfer_amount_cents: null, pretransfer_refunded_cents: 0,
          amount_refunded_cents: 0, refund_requested_cents: 0, amount_reversed_cents: 0,
          transfer_reversal_ids: [], fulfillment_state: 'awaiting', state: 'pending',
          lease_token: null, lease_expires_at: null }
        return { data: clone(settlement), error: null }
      }
      assert.ok(settlement, 'Financial operations require an existing private captured-payment ledger')
      assert.equal(params.p_settlement_id ?? ids.settlement, ids.settlement)
      if (name === 'fulfill_payment_order') {
        const existing = settlement.fulfillment_state === 'fulfilled'
        if (options.unfulfilled) settlement.fulfillment_state = 'refund_required'
        else {
          settlement.fulfillment_state = 'fulfilled'
          if (!existing) {
            calls.entitlements++
            if (order.kind === 'products') purchases.push({ buyer_id: order.buyer_id, product_id: offerId,
              stripe_payment_intent_id: intent.id, stripe_livemode: false, payment_status: 'paid', amount_refunded: 0 })
          }
        }
        return { data: { newly_fulfilled: !existing, refund_required: options.unfulfilled ?? false }, error: null }
      }
      if (name === 'observe_payment_settlement') {
        const s = params.p_snapshot
        settlement.amount_refunded_cents = Math.max(settlement.amount_refunded_cents, s.refunded_cents)
        settlement.amount_reversed_cents = Math.max(settlement.amount_reversed_cents, s.reversed_cents)
        settlement.transfer_reversal_ids = [...new Set([...settlement.transfer_reversal_ids, ...s.reversal_ids])]
        if (settlement.amount_refunded_cents === 500) {
          settlement.fulfillment_state = 'refunded'
          const proven = settlement.stripe_transfer_id ? settlement.amount_reversed_cents === settlement.transfer_amount_cents
            : ![...actions.values()].some(action => action.kind === 'transfer' && action.uncertain)
          if (proven) settlement.state = 'refunded'
        } else if (settlement.refund_requested_cents > settlement.amount_refunded_cents) settlement.state = 'refund_pending'
        else if (!settlement.lease_token && settlement.stripe_transfer_id) settlement.state = 'settled'
        return { data: clone(settlement), error: null }
      }
      if (name === 'request_settlement_refund') {
        assert.ok(params.p_target_cents >= 0 && params.p_target_cents <= settlement.gross_cents)
        settlement.refund_requested_cents = Math.max(settlement.refund_requested_cents, params.p_target_cents)
        settlement.state = 'refund_pending'
        return { data: clone(settlement), error: null }
      }
      if (name === 'claim_settlement_action') {
        if (settlement.lease_token) return { data: { busy: true }, error: null }
        if (params.p_kind === 'transfer') {
          if (settlement.fulfillment_state !== 'fulfilled' || settlement.refund_requested_cents > settlement.amount_refunded_cents
            || settlement.amount_refunded_cents === 500) return { data: { blocked: true }, error: null }
          if (settlement.stripe_transfer_id) return { data: { done: true }, error: null }
          assert.equal(params.p_amount_cents, 450 - Math.floor(450 * settlement.amount_refunded_cents / 500))
        } else {
          assert.ok(settlement.stripe_transfer_id)
          assert.ok(params.p_target_cents <= settlement.transfer_amount_cents)
          assert.equal(params.p_amount_cents, params.p_target_cents - settlement.amount_reversed_cents)
        }
        const key = `${params.p_kind}:${params.p_target_cents}`
        let action = actions.get(key)
        if (action?.stripe_object_id) return { data: { done: true, action: clone(action) }, error: null }
        if (!action) {
          action = { id: `action-${key}`, settlement_id: ids.settlement, kind: params.p_kind,
            target_cents: params.p_target_cents, amount_cents: params.p_amount_cents,
            idempotency_key: `synthetic-${key}`, stripe_object_id: null, uncertain: false, request_started_at: new Date().toISOString() }
          actions.set(key, action)
        }
        assert.equal(action.amount_cents, params.p_amount_cents, 'A claimed action must retain exactly its immutable amount')
        settlement.lease_token = params.p_lease_token; settlement.lease_expires_at = new Date(Date.now() + 300000).toISOString()
        if (params.p_kind === 'transfer' && settlement.transfer_amount_cents === null) {
          settlement.transfer_amount_cents = action.amount_cents; settlement.pretransfer_refunded_cents = settlement.amount_refunded_cents
        }
        return { data: { action: clone(action) }, error: null }
      }
      assert.equal(name, 'finish_settlement_action')
      if (finishFailure) { finishFailure = false; return { data: null, error: { code: '08006' } } }
      if (settlement.lease_token !== params.p_lease_token) return { data: false, error: null }
      const action = [...actions.values()].find(row => row.id === params.p_action_id)
      assert.ok(action); action.stripe_object_id ??= params.p_object_id; action.uncertain = params.p_uncertain
      if (params.p_object_id && action.kind === 'transfer') settlement.stripe_transfer_id = params.p_object_id
      if (params.p_object_id && action.kind === 'reversal') {
        settlement.amount_reversed_cents = Math.max(settlement.amount_reversed_cents, action.target_cents)
        if (!settlement.transfer_reversal_ids.includes(params.p_object_id)) settlement.transfer_reversal_ids.push(params.p_object_id)
      }
      settlement.lease_token = null; settlement.lease_expires_at = null
      settlement.state = params.p_object_id ? action.kind === 'transfer' ? 'settled' : 'refund_pending' : 'failed'
      return { data: true, error: null }
    },
  }
  const provider = {
    paymentIntents: { retrieve: async id => { assert.equal(id, intent.id); return clone(intent) } },
    charges: { retrieve: async id => { assert.equal(id, charge.id); return clone(charge) } },
    checkout: { sessions: { retrieve: async id => { assert.equal(id, session.id); return clone(session) } } },
    invoices: { retrieve: async id => { assert.equal(id, invoice.id); return clone(invoice) } },
    subscriptions: { retrieve: async id => { assert.equal(id, subscription.id); return clone(subscription) } },
    invoicePayments: { list: async parameters => {
      assert.equal(parameters.invoice, invoice.id)
      return { has_more: false, data: [{ status: 'paid', amount_paid: 500, payment: { type: 'payment_intent', payment_intent: intent.id } }] }
    } },
    disputes: {
      retrieve: async id => { const dispute = disputes.find(row => row.id === id); assert.ok(dispute); return clone(dispute) },
      list: parameters => ({ autoPagingToArray: async () => {
        assert.equal(parameters.charge, charge.id)
        return disputes.filter(row => row.charge === charge.id).map(clone)
      } }),
    },
    refunds: { list: () => ({ autoPagingToArray: async () => clone(refunds) }) },
    transfers: {
      list: () => ({ autoPagingToArray: async () => {
        if (transferDiscoveryFailure) throw { type: 'StripeConnectionError', code: 'api_connection_error' }
        if (hiddenTransfers) return []
        return [...transfers.values()].map(clone)
      } }),
      retrieve: async id => { assert.ok(transfers.has(id)); return clone(transfers.get(id)) },
      async create(parameters, requestOptions) {
        calls.transferPosts.push(clone({ parameters, requestOptions }))
        if (beforeTransfer) { const callback = beforeTransfer; beforeTransfer = null; await callback() }
        if (transferFailure === 'before') throw { type: 'StripeInvalidRequestError', code: 'balance_insufficient' }
        const existing = [...transfers.values()].find(row => row.key === requestOptions.idempotencyKey)
        const transfer = existing ?? { id: `tr_synthetic${transfers.size}`, amount: parameters.amount, amount_reversed: 0,
          currency: parameters.currency, livemode: false, destination: parameters.destination,
          source_transaction: parameters.source_transaction, transfer_group: parameters.transfer_group,
          metadata: clone(parameters.metadata), key: requestOptions.idempotencyKey }
        transfers.set(transfer.id, transfer)
        if (transferFailure === 'after') { transferFailure = null; throw { type: 'StripeConnectionError', code: 'api_connection_error' } }
        return clone(transfer)
      },
      listReversals: id => ({ autoPagingToArray: async () => [...reversals.values()].filter(row => row.transfer === id).map(clone) }),
      async createReversal(id, parameters, requestOptions) {
        calls.reversalPosts.push(clone({ id, parameters, requestOptions }))
        assert.ok(transfers.has(id))
        if (reversalFailure === 'before') throw { type: 'StripeInvalidRequestError', code: 'balance_insufficient' }
        if (reversalFailure === 'uncertain') throw { type: 'StripeConnectionError', code: 'api_connection_error' }
        const existing = [...reversals.values()].find(row => row.key === requestOptions.idempotencyKey)
        let reversal = existing
        if (!reversal) {
          const transfer = transfers.get(id)
          assert.ok(parameters.amount > 0 && parameters.amount <= transfer.amount - transfer.amount_reversed)
          reversal = { id: `trr_synthetic${reversals.size}`, transfer: id, currency: 'eur', amount: parameters.amount,
            metadata: clone(parameters.metadata), key: requestOptions.idempotencyKey }
          reversals.set(reversal.id, reversal); transfer.amount_reversed += reversal.amount
        }
        if (reversalFailure === 'after') { reversalFailure = null; throw { type: 'StripeConnectionError', code: 'api_connection_error' } }
        return clone(reversal)
      },
    },
  }
  class ConnectReadinessError extends Error { constructor(code) { super(code); this.code = code } }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/stripe/settlement.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => {
    if (name === 'node:crypto') return { randomUUID: () => 'ffffffff-ffff-4fff-8fff-ffffffffffff' }
    if (name === '@/lib/stripe/server') return { stripe: provider }
    if (name === '@/lib/stripe/platformFee') return { calculateArdorePlatformFee: amount => Math.round(amount / 10) }
    assert.equal(name, '@/lib/stripe/connect-readiness')
    return { ConnectReadinessError, configuredStripeLivemode: () => false,
      async requirePayoutReadyCoach(database, creatorId) {
        assert.equal(database, service); assert.equal(creatorId, order.creator_id); calls.readiness.push(creatorId)
        if (!ready) throw new ConnectReadinessError('connect_account_not_ready')
        return { accountId: readyAccount, livemode: false }
      } }
  }, loaded.exports, loaded)
  return { library: loaded.exports, service, provider, order, intent, charge, session, invoice, subscription, transfers, reversals, actions, refunds, purchases, disputes, calls,
    settlement: () => settlement, setReady(value) { ready = value }, changeAccount(value) { readyAccount = value },
    transferFailure(value) { transferFailure = value }, reversalFailure(value) { reversalFailure = value },
    loseDiscovery(value) { transferDiscoveryFailure = value }, failFinish() { finishFailure = true },
    hideTransfers(value) { hiddenTransfers = value },
    beforeTransfer(callback) { beforeTransfer = callback },
    refund(amount, status = 'succeeded') { refunds.push({ id: `re_synthetic${refunds.length}`, charge: charge.id, payment_intent: intent.id, currency: 'eur', amount, status }); charge.amount_refunded = refunds.filter(row => row.status === 'succeeded').reduce((sum, row) => sum + row.amount, 0) },
    record() { return loaded.exports.recordSuccessfulSettlement({ service, orderId: order.id, paymentIntentId: intent.id, sessionId: session.id, provider }) },
    settle() { return loaded.exports.settlePayment({ service, settlementId: ids.settlement, provider }) },
    prepare(amount) { return loaded.exports.prepareSettlementRefund({ service, paymentIntentId: intent.id, targetRefundedCents: amount, refundKey: 'synthetic-safe-refund', provider }) },
    reconcile() { return loaded.exports.reconcileSettlementRefund({ service, paymentIntentId: intent.id, provider }) },
    checkout() { return loaded.exports.reconcileSettlementCheckout({ service, sessionId: session.id, provider }) },
    invoicePayment() { return loaded.exports.reconcileSettlementInvoice({ service, invoiceId: invoice.id, provider }) },
    dispute(status) {
      charge.disputed = true
      const dispute = { id: `du_synthetic${disputes.length}`, charge: charge.id, payment_intent: intent.id,
        livemode: false, currency: 'eur', amount: 500, status }
      disputes.push(dispute); return dispute
    },
    disputeEvent(dispute, eventType = 'charge.dispute.created') {
      return loaded.exports.reconcileSettlementProviderEvent({ service, provider,
        event: { type: eventType, livemode: false, data: { object: { id: dispute.id, status: 'won',
          charge: 'ch_untrustedPayload', payment_intent: 'pi_untrustedPayload' } } } })
    },
  }
}

test('captured payment settles exactly one correct coach net and one earnings record', async () => {
  const f = fixture(); await f.record(); await f.record(); await f.settle(); await f.settle()
  assert.equal(f.transfers.size, 1); assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.entitlements, 1)
  const transfer = [...f.transfers.values()][0]
  assert.equal(transfer.amount, 450); assert.equal(transfer.destination, 'acct_syntheticReady')
  assert.equal(transfer.source_transaction, f.charge.id)
  assert.equal(f.settlement().gross_cents, 500); assert.equal(f.settlement().platform_fee_cents, 50)
})

test('definitive transfer rejection retries the exact key and amount without duplicate earnings', async () => {
  const f = fixture({ transferFailure: 'before' }); await f.record()
  await assert.rejects(f.settle(), { code: 'balance_insufficient' })
  assert.equal(f.transfers.size, 0); assert.equal(f.settlement().state, 'failed')
  f.transferFailure(null); await f.settle(); await f.settle()
  assert.equal(f.transfers.size, 1); assert.equal(f.calls.entitlements, 1)
  assert.deepEqual(f.calls.transferPosts[0], f.calls.transferPosts[1])
})

test('lost transfer response is discovered by exact private identity without another POST', async () => {
  const f = fixture({ transferFailure: 'after' }); await f.record(); await f.settle(); await f.settle()
  assert.equal(f.transfers.size, 1); assert.equal(f.calls.transferPosts.length, 1)
  assert.equal(f.settlement().stripe_transfer_id, [...f.transfers.keys()][0])
})

test('coach restriction and account reassignment hold settlement without money movement', async () => {
  for (const change of [f => f.setReady(false), f => f.changeAccount('acct_other')]) {
    const f = fixture(); await f.record(); change(f)
    assert.equal((await f.settle()).state, 'held')
    assert.equal(f.calls.transferPosts.length, 0); assert.equal(f.transfers.size, 0)
    f.setReady(true); f.changeAccount('acct_syntheticReady'); await f.settle()
    assert.equal(f.transfers.size, 1)
  }
})

test('full refund latch prevents future transfer even before provider refund appears', async () => {
  const f = fixture(); await f.record(); await f.prepare(500); await f.settle()
  assert.equal(f.calls.transferPosts.length, 0); assert.equal(f.settlement().refund_requested_cents, 500)
})

test('full refund reverses only exact coach net once, including repeated refund callbacks', async () => {
  const f = fixture(); await f.record(); await f.settle(); await f.prepare(500); await f.prepare(500)
  f.refund(500); await f.reconcile(); await f.reconcile(); await f.settle()
  assert.equal(f.calls.reversalPosts.length, 1); assert.equal(f.reversals.size, 1)
  assert.equal([...f.transfers.values()][0].amount_reversed, 450)
  assert.equal(f.settlement().state, 'refunded'); assert.equal(f.calls.transferPosts.length, 1)
})

test('partial refunds reverse cumulative proportional coach net without exceeding original transfer', async () => {
  const f = fixture(); await f.record(); await f.settle()
  f.refund(100); await f.reconcile(); await f.reconcile()
  assert.equal([...f.transfers.values()][0].amount_reversed, 90)
  f.refund(400); await f.reconcile(); await f.reconcile()
  assert.equal([...f.transfers.values()][0].amount_reversed, 450)
  assert.equal(f.calls.reversalPosts.length, 2)
  await assert.rejects(f.prepare(501), { code: 'refund_target_invalid' })
  assert.equal(f.calls.reversalPosts.length, 2)
})

test('provider response loss after full reversal cannot create a duplicate reversal', async () => {
  const f = fixture({ reversalFailure: 'after' }); await f.record(); await f.settle()
  await assert.rejects(f.prepare(500)); await f.prepare(500)
  assert.equal(f.reversals.size, 1); assert.equal(f.calls.reversalPosts.length, 1)
})

for (const [name, mutate] of [
  ['wrong order', f => { f.intent.metadata.ardore_order_id = 'foreign' }],
  ['wrong buyer', f => { f.intent.metadata.buyer_id = ids.coach }],
  ['wrong coach', f => { f.intent.metadata.creator_id = ids.buyer }],
  ['wrong gross', f => { f.intent.amount_received = 1000 }],
  ['wrong currency', f => { f.charge.currency = 'usd' }],
  ['wrong captured amount', f => { f.charge.amount_captured = 1000 }],
  ['destination architecture', f => { f.intent.transfer_data = { destination: 'acct_other' } }],
  ['unpaid', f => { f.intent.status = 'requires_payment_method' }],
  ['foreign charge', f => { f.charge.payment_intent = 'pi_other' }],
]) test(`${name} cannot establish or transfer a settlement`, async () => {
  const f = fixture(); mutate(f)
  await assert.rejects(f.record())
  assert.equal(f.settlement(), null); assert.equal(f.calls.transferPosts.length, 0)
})

test('historical payment without private settlement returns null and causes no money movement', async () => {
  const f = fixture()
  assert.equal(await f.library.getSettlementRefundContext({ service: f.service, paymentIntentId: 'pi_historical', provider: f.provider }), null)
  assert.equal(f.calls.transferPosts.length, 0); assert.equal(f.calls.reversalPosts.length, 0)
})

test('partial refund after definite transfer failure cannot silently reuse the old larger transfer amount', async () => {
  const f = fixture({ transferFailure: 'before' }); await f.record()
  await assert.rejects(f.settle(), { code: 'balance_insufficient' })
  f.transferFailure(null); f.refund(100); await f.reconcile()
  await f.settle().catch(() => {})
  assert.equal(f.transfers.size, 0, 'An immutable old transfer must be held/reconciled once refund changed its amount')
  assert.equal(f.calls.transferPosts.length, 1, 'No second money movement may reuse the previous unreduced amount')
})

test('partial reversal response loss followed by another refund reconciles fresh provider totals before the next delta', async () => {
  const f = fixture({ reversalFailure: 'after' }); await f.record(); await f.settle(); f.refund(100)
  await assert.rejects(f.reconcile(), { code: 'api_connection_error' })
  assert.equal([...f.transfers.values()][0].amount_reversed, 90)
  f.refund(100); await f.reconcile(); await f.reconcile()
  assert.equal([...f.transfers.values()][0].amount_reversed, 180)
  assert.equal(f.calls.reversalPosts.length, 2)
})

test('unknown accepted transfer blocks refund until exact provider transfer can be recovered', async () => {
  const f = fixture({ transferFailure: 'after' }); await f.record()
  f.beforeTransfer(() => f.loseDiscovery(true))
  await assert.rejects(f.settle(), { code: 'api_connection_error' })
  assert.equal(f.transfers.size, 1); assert.equal(f.settlement().stripe_transfer_id, null)
  await assert.rejects(f.prepare(500))
  assert.equal(f.reversals.size, 0)
  f.loseDiscovery(false); await f.prepare(500); await f.prepare(500)
  assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.reversalPosts.length, 1)
  assert.equal([...f.transfers.values()][0].amount_reversed, 450)
})

test('full refund after a definitely rejected transfer reaches refunded state without inventing a reversal', async () => {
  const f = fixture({ transferFailure: 'before' }); await f.record()
  await assert.rejects(f.settle(), { code: 'balance_insufficient' })
  assert.equal(f.actions.get('transfer:0').uncertain, false)
  await f.prepare(500); f.refund(500); await f.reconcile(); await f.settle()
  assert.equal(f.settlement().state, 'refunded')
  assert.equal(f.transfers.size, 0); assert.equal(f.reversals.size, 0)
  assert.equal(f.calls.transferPosts.length, 1)
})

test('completed full reversal response loss adopts the proven action ID and clears uncertainty', async () => {
  const f = fixture({ reversalFailure: 'after' }); await f.record(); await f.settle()
  await assert.rejects(f.prepare(500)); assert.equal(f.actions.get('reversal:450').uncertain, true)
  await f.prepare(500)
  assert.equal(f.actions.get('reversal:450').uncertain, false)
  assert.equal(f.actions.get('reversal:450').stripe_object_id, [...f.reversals.keys()][0])
  assert.equal(f.settlement().amount_reversed_cents, 450)
  assert.equal(f.calls.reversalPosts.length, 1)
})

test('concurrent workers produce one transfer while a competing lease fails retryably', async () => {
  const f = fixture(); await f.record()
  const results = await Promise.allSettled([f.settle(), f.settle(), f.settle()])
  assert.ok(results.some(result => result.status === 'fulfilled'))
  for (const result of results.filter(result => result.status === 'rejected')) assert.equal(result.reason.code, 'settlement_busy')
  await f.settle()
  assert.equal(f.transfers.size, 1); assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.entitlements, 1)
})

test('refund already recorded before first transfer reduces net correctly and bounds the later full reversal', async () => {
  const f = fixture(); await f.record(); f.refund(100); await f.reconcile(); await f.settle()
  assert.equal([...f.transfers.values()][0].amount, 360)
  assert.equal(f.settlement().pretransfer_refunded_cents, 100)
  await f.prepare(500); f.refund(400); await f.reconcile()
  assert.equal([...f.transfers.values()][0].amount_reversed, 360)
  assert.equal(f.calls.reversalPosts.length, 1)
  assert.equal(f.settlement().state, 'refunded')
})

test('accepted private transfer with altered destination or amount cannot be silently adopted', async () => {
  for (const mutate of [transfer => { transfer.destination = 'acct_foreign' }, transfer => { transfer.amount = 900 }]) {
    const f = fixture({ transferFailure: 'after' }); await f.record()
    f.beforeTransfer(() => f.loseDiscovery(true)); await assert.rejects(f.settle())
    mutate([...f.transfers.values()][0]); f.loseDiscovery(false)
    await assert.rejects(f.prepare(500), { code: 'settlement_transfer_mismatch' })
    assert.equal(f.settlement().stripe_transfer_id, null)
    assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.reversalPosts.length, 0)
  }
})

test('later coach restriction cannot erase uncertainty from a prior accepted transfer response loss', async () => {
  const f = fixture({ transferFailure: 'after' }); await f.record()
  f.beforeTransfer(() => f.loseDiscovery(true)); await assert.rejects(f.settle())
  assert.equal(f.actions.get('transfer:0').uncertain, true)
  f.loseDiscovery(false); f.hideTransfers(true); f.setReady(false)
  assert.equal((await f.settle()).state, 'held')
  assert.equal(f.actions.get('transfer:0').uncertain, true, 'A read-only eligibility failure proves nothing about the previous money movement')
  await assert.rejects(f.prepare(500), { code: 'transfer_result_unknown' })
  assert.equal(f.reversals.size, 0)
  f.hideTransfers(false); await f.prepare(500)
  assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.reversalPosts.length, 1)
})

test('coach becomes payout-ready after more than 23 hours and never-posted action can settle safely', async () => {
  const f = fixture({ ready: false }); await f.record(); await f.settle()
  const action = f.actions.get('transfer:0')
  assert.equal(action.uncertain, false); assert.equal(f.calls.transferPosts.length, 0)
  action.request_started_at = new Date(Date.now() - 48 * 3600000).toISOString()
  f.setReady(true); await f.settle(); await f.settle()
  assert.equal(f.transfers.size, 1); assert.equal(f.calls.transferPosts.length, 1)
})

test('definite failed transfer older than provider key retention can retry with durable no-movement proof', async () => {
  const f = fixture({ transferFailure: 'before' }); await f.record(); await assert.rejects(f.settle())
  const action = f.actions.get('transfer:0')
  assert.equal(action.uncertain, false); action.request_started_at = new Date(Date.now() - 48 * 3600000).toISOString()
  f.transferFailure(null); await f.settle(); await f.settle()
  assert.equal(f.transfers.size, 1); assert.deepEqual(f.calls.transferPosts[0], f.calls.transferPosts[1])
})

test('old uncertain accepted transfer is never posted again after key retention and is adopted once discoverable', async () => {
  const f = fixture({ transferFailure: 'after' }); await f.record()
  f.beforeTransfer(() => f.loseDiscovery(true)); await assert.rejects(f.settle())
  f.actions.get('transfer:0').request_started_at = new Date(Date.now() - 48 * 3600000).toISOString()
  f.loseDiscovery(false); f.hideTransfers(true)
  await assert.rejects(f.settle(), { code: 'transfer_result_unknown' })
  assert.equal(f.actions.get('transfer:0').uncertain, true); assert.equal(f.calls.transferPosts.length, 1)
  f.hideTransfers(false); await f.settle()
  assert.equal(f.settlement().stripe_transfer_id, [...f.transfers.keys()][0]); assert.equal(f.calls.transferPosts.length, 1)
})

test('an unresolved old reversal never loses uncertainty when its retry is blocked before Stripe POST', async () => {
  const f = fixture({ reversalFailure: 'uncertain' }); await f.record(); await f.settle()
  await assert.rejects(f.prepare(100), /api_connection_error/)
  const action = f.actions.get('reversal:90')
  assert.equal(action.uncertain, true)
  action.request_started_at = new Date(Date.now() - 48 * 3600000).toISOString()
  f.reversalFailure(null)
  await assert.rejects(f.prepare(100), /reversal_result_unknown/)
  assert.equal(action.uncertain, true, 'A rejected read-only retry cannot prove an earlier Stripe mutation failed')
  await assert.rejects(f.prepare(100), /reversal_result_unknown/)
  assert.equal(f.calls.reversalPosts.length, 1, 'An expired uncertain reversal must never reuse a forgotten provider key')
})

test('a read-only provider permission error cannot clear an earlier uncertain reversal mutation', async () => {
  const f = fixture({ reversalFailure: 'uncertain' }); await f.record(); await f.settle()
  await assert.rejects(f.prepare(100), /api_connection_error/)
  const action = f.actions.get('reversal:90')
  assert.equal(action.uncertain, true)
  const list = f.provider.transfers.listReversals
  let reads = 0
  f.provider.transfers.listReversals = id => ({ autoPagingToArray: async () => {
    if (++reads === 4) throw { type: 'StripePermissionError', code: 'permission_denied' }
    return list(id).autoPagingToArray()
  } })
  await assert.rejects(f.prepare(100), /permission_denied/)
  assert.equal(action.uncertain, true, 'Read permission failure says nothing about a prior accepted reversal')
  assert.equal(f.calls.reversalPosts.length, 1)
})

function retiredEventFixture({ retired = ['pi_retiredSynthetic'], error = null } = {}) {
  const f = fixture(), reads = []
  const service = {
    from(table) {
      assert.equal(table, 'retired_stripe_test_runs')
      let objectId
      return {
        select(columns) { assert.equal(columns, 'id'); return this },
        contains(column, values) {
          assert.equal(column, 'object_ids'); assert.equal(values.length, 1)
          objectId = values[0]; reads.push(objectId); return this
        },
        limit(count) { assert.equal(count, 1); return this },
        async maybeSingle() { return { data: retired.includes(objectId) ? { id: 'retired-run-id' } : null, error } },
      }
    },
  }
  return { reads, check: event => f.library.isRetiredStripeTestEvent({ service, event }) }
}

test('only an exact privately retired object ID may bypass a signed TEST event', async () => {
  const f = retiredEventFixture()
  assert.equal(await f.check({ livemode: false, data: { object: { id: 'pi_retiredSynthetic' } } }), true)
  assert.equal(await f.check({ livemode: false, data: { object: { id: 'pi_retiredSynthetic_extra' } } }), false)
  assert.equal(await f.check({ livemode: false, data: { object: { id: 'pi_otherSynthetic', metadata: {
    synthetic: 'true', retired: 'true', ardore_order_id: ids.order, ardore_settlement_id: ids.settlement,
  } } } }), false)
  assert.deepEqual(f.reads, ['pi_retiredSynthetic', 'pi_retiredSynthetic_extra', 'pi_otherSynthetic'])
})

test('live or unknown-mode events and metadata-only objects never use fixture tombstones', async () => {
  const f = retiredEventFixture()
  for (const livemode of [true, undefined, null, 0, 'false']) {
    assert.equal(await f.check({ livemode, data: { object: { id: 'pi_retiredSynthetic' } } }), false)
  }
  assert.equal(await f.check({ livemode: false, data: { object: { metadata: { id: 'pi_retiredSynthetic', retired: 'true' } } } }), false)
  assert.equal(await f.check({ livemode: false, data: { object: { id: '' } } }), false)
  assert.deepEqual(f.reads, [])
})

test('fixture tombstone lookup failure is retryable and cannot acknowledge an unproven event', async () => {
  const f = retiredEventFixture({ error: { code: '08006', message: 'private database details' } })
  await assert.rejects(f.check({ livemode: false, data: { object: { id: 'pi_retiredSynthetic' } } }), error => {
    assert.equal(error.code, 'retired_fixture_check_failed')
    assert.equal(error.message, 'retired_fixture_check_failed')
    return true
  })
})

test('partial product refund observed before fulfillment still grants the existing entitlement and settles only remaining net', async () => {
  const f = fixture({ kind: 'products' }); f.refund(100)
  const result = await f.checkout()
  assert.equal(result.handled, true); assert.equal(result.retryNeeded, undefined)
  assert.equal(f.calls.entitlements, 1); assert.equal(f.purchases.length, 1)
  assert.equal(f.purchases[0].payment_status, 'partially_refunded'); assert.equal(f.purchases[0].amount_refunded, 1)
  assert.equal(f.transfers.size, 1); assert.equal([...f.transfers.values()][0].amount, 360)
  assert.equal(f.settlement().fulfillment_state, 'fulfilled'); assert.equal(f.settlement().state, 'settled')
  await f.checkout(); await f.reconcile()
  assert.equal(f.calls.entitlements, 1); assert.equal(f.calls.transferPosts.length, 1)
  assert.equal(f.purchases[0].payment_status, 'partially_refunded')
})

test('partial subscription refund observed before a paid invoice preserves one entitlement cycle and remaining net', async () => {
  const f = fixture({ kind: 'subscription' }); f.refund(100)
  const result = await f.invoicePayment()
  assert.equal(result.handled, true); assert.equal(result.retryNeeded, undefined)
  assert.equal(f.calls.entitlements, 1); assert.equal(f.transfers.size, 1)
  assert.equal([...f.transfers.values()][0].amount, 360)
  assert.equal(f.settlement().stripe_invoice_id, f.invoice.id)
  const fulfillment = f.calls.rpcs.find(call => call.name === 'fulfill_payment_order')
  assert.equal(fulfillment.params.p_period_end, new Date(1900000000 * 1000).toISOString())
  await f.invoicePayment(); await f.reconcile()
  assert.equal(f.calls.entitlements, 1); assert.equal(f.calls.transferPosts.length, 1)
})

for (const kind of ['products', 'subscription']) {
  test(`fully refunded ${kind} payment observed before fulfillment never grants access or transfers`, async () => {
    const f = fixture({ kind }); f.refund(500)
    const result = await (kind === 'products' ? f.checkout() : f.invoicePayment())
    assert.equal(result.handled, true); assert.equal(f.calls.entitlements, 0)
    assert.equal(f.calls.transferPosts.length, 0); assert.equal(f.calls.reversalPosts.length, 0)
    assert.equal(f.settlement().fulfillment_state, 'refunded'); assert.equal(f.settlement().state, 'refunded')
  })
}

test('an older in-flight charge snapshot cannot revive a fully refunded product or discard reversal history', async () => {
  const f = fixture({ kind: 'products' }); await f.checkout(); f.refund(500)
  await f.prepare(500); await f.reconcile()
  assert.equal(f.purchases[0].payment_status, 'refunded')
  const provenReversals = [...f.settlement().transfer_reversal_ids]
  f.provider.charges.retrieve = async id => {
    assert.equal(id, f.charge.id)
    return { ...structuredClone(f.charge), amount_refunded: 0 }
  }
  await f.reconcile(); await f.settle()
  assert.equal(f.settlement().amount_refunded_cents, 500)
  assert.equal(f.settlement().state, 'refunded'); assert.equal(f.settlement().fulfillment_state, 'refunded')
  assert.deepEqual(f.settlement().transfer_reversal_ids, provenReversals)
  assert.equal(f.purchases[0].payment_status, 'refunded'); assert.equal(f.purchases[0].amount_refunded, 5)
  assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.reversalPosts.length, 1)
})

test('fresh dispute status protects product access and ignores stale or foreign dispute-event payload fields', async () => {
  const f = fixture({ kind: 'products' }); await f.checkout()
  const dispute = f.dispute('needs_response')
  const result = await f.disputeEvent(dispute)
  assert.equal(result.handled, true); assert.equal(f.purchases[0].payment_status, 'disputed')
  await f.reconcile(); assert.equal(f.purchases[0].payment_status, 'disputed')
  dispute.status = 'lost'
  await f.disputeEvent(dispute, 'charge.dispute.closed')
  assert.equal(f.purchases[0].payment_status, 'chargeback')
  await f.disputeEvent(dispute)
  assert.equal(f.purchases[0].payment_status, 'chargeback', 'A late created event cannot override the authoritative lost dispute')
  dispute.status = 'won'
  await f.disputeEvent(dispute, 'charge.dispute.closed')
  assert.equal(f.purchases[0].payment_status, 'paid')
  assert.equal(f.calls.transferPosts.length, 1); assert.equal(f.calls.entitlements, 1)
})

test('unresolved or lost dispute before fulfillment holds money and won dispute can recover exactly once', async () => {
  const f = fixture({ kind: 'products' }); const dispute = f.dispute('under_review')
  await f.checkout()
  assert.equal(f.calls.entitlements, 0); assert.equal(f.calls.transferPosts.length, 0)
  dispute.status = 'lost'; await f.checkout()
  assert.equal(f.calls.entitlements, 0); assert.equal(f.calls.transferPosts.length, 0)
  dispute.status = 'won'; await f.checkout(); await f.checkout()
  assert.equal(f.calls.entitlements, 1); assert.equal(f.calls.transferPosts.length, 1)
  assert.equal(f.purchases[0].payment_status, 'paid')
})

test('missing authoritative dispute rows fail closed despite a successful charge', async () => {
  const f = fixture({ kind: 'products' }); f.charge.disputed = true
  await f.checkout(); await f.checkout()
  assert.equal(f.calls.entitlements, 0); assert.equal(f.calls.transferPosts.length, 0)
})

test('a foreign-mode dispute cannot mutate product authority or authorize settlement', async () => {
  const f = fixture({ kind: 'products' }); await f.checkout()
  const dispute = f.dispute('needs_response'); dispute.livemode = true
  await assert.rejects(f.disputeEvent(dispute))
  assert.equal(f.purchases[0].payment_status, 'paid')
  assert.equal(f.calls.transferPosts.length, 1)
})

test('a stale nondisputed charge snapshot cannot restore disputed or chargeback product access', async () => {
  for (const status of ['needs_response', 'lost']) {
    const f = fixture({ kind: 'products' }); await f.checkout()
    const dispute = f.dispute(status); await f.disputeEvent(dispute)
    const protectedStatus = status === 'lost' ? 'chargeback' : 'disputed'
    assert.equal(f.purchases[0].payment_status, protectedStatus)
    f.provider.charges.retrieve = async id => {
      assert.equal(id, f.charge.id)
      return { ...structuredClone(f.charge), disputed: false }
    }
    await f.reconcile()
    assert.equal(f.purchases[0].payment_status, protectedStatus)
  }
})

for (const kind of ['products', 'subscription']) {
  test(`authoritative won dispute event resumes held ${kind} payment without duplicate fulfillment or transfer`, async () => {
    const f = fixture({ kind }); const dispute = f.dispute('under_review')
    await (kind === 'products' ? f.checkout() : f.invoicePayment())
    assert.equal(f.calls.entitlements, 0); assert.equal(f.calls.transferPosts.length, 0)
    dispute.status = 'won'
    const result = await f.disputeEvent(dispute, 'charge.dispute.closed')
    assert.equal(result.handled, true); assert.equal(result.retryNeeded, undefined)
    assert.equal(f.calls.entitlements, 1); assert.equal(f.calls.transferPosts.length, 1)
    await f.disputeEvent(dispute, 'charge.dispute.closed')
    assert.equal(f.calls.entitlements, 1); assert.equal(f.calls.transferPosts.length, 1)
  })
}

for (const cents of [0, 400]) test(`expired ${cents}-cent coupon checkout releases the hold without fulfillment or charge`, async () => {
  const f = fixture({kind:'products'})
  f.order.gross_cents = cents
  f.order.reference.discountRedemptionId = ids.order
  f.session.amount_total = cents
  f.session.status = 'expired'
  f.session.payment_status = 'unpaid'
  f.session.payment_intent = null
  assert.deepEqual(await f.checkout(), {handled:true})
  assert.equal(f.calls.entitlements,0)
  assert.equal(f.calls.transferPosts.length,0)
  assert.equal(f.calls.rpcs.filter(row=>row.name==='release_discount_redemption').length,1)
})
