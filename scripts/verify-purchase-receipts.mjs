import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/app/api/webhooks/stripe/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function fixture(duplicate = false, { settlementResult = null, eventType = 'checkout.session.completed', resultFailure = false } = {}) {
  const receipts = []
  const reconciliationCalls = []
  let claimToken
  let completed = 0
  let savedPurchases = []
  const products = [
    { id: 'product-a', price: 90, title: 'Product A', creator: { display_name: 'Synthetic creator' } },
    { id: 'product-b', price: 10, title: 'Product B', creator: { display_name: 'Synthetic creator' } },
  ]
  const event = {
    id: 'synthetic-event', type: eventType, livemode: false,
    data: { object: {
      id: 'synthetic-session', mode: 'payment', payment_status: 'paid',
      amount_total: 8000, payment_intent: 'synthetic-intent',
      metadata: { buyer_id: settlementResult ? 'stale-event-buyer' : 'synthetic-buyer', product_ids: 'product-a,product-b',
        ...(settlementResult ? { ardore_order_id: 'owned-order' } : {}) },
    } },
  }
  const database = {
    async rpc(name, params) {
      assert.equal(params.p_event_id, event.id)
      if (name === 'claim_stripe_webhook_event') {
        claimToken = params.p_lease_token
        return { data: { claimed: !duplicate, processed: duplicate }, error: null }
      }
      if (name === 'release_stripe_webhook_event') return { data: true, error: null }
      assert.equal(name, 'complete_stripe_webhook_event')
      assert.equal(params.p_lease_token, claimToken)
      completed += 1
      return { data: true, error: null }
    },
    auth: { admin: { getUserById: async id => {
      if (settlementResult) assert.equal(id, 'synthetic-buyer')
      return { data: { user: { email: 'delivered@resend.dev', user_metadata: {} } } }
    } } },
    from(table) {
      assert.ok(['stripe_webhook_events', 'products', 'purchases'].includes(table))
      const query = {
        select() { return this }, eq() { return this }, in() { return this },
        async insert() { return { error: duplicate ? { code: '23505' } : null } },
        async upsert(rows) { assert.equal(table, 'purchases'); savedPurchases = rows; return { error: null } },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'products' ? products : [], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const overrides = {
    '@/lib/stripe/server': { stripe: { webhooks: { constructEvent: () => event } } },
    '@/lib/supabase/server': { createServiceClient: async () => database },
    '@/lib/email/send': {
      sendPurchaseReceipt: async (to, data) => { assert.equal(to, 'delivered@resend.dev'); receipts.push(data) },
      sendNewSubscriberNotification: async () => { throw new Error('Unexpected subscription email') },
    },
    '@/lib/notifications': { createNotification: async () => { throw new Error('Unexpected notification') } },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking: async () => { throw new Error('Unexpected coaching confirmation') } },
    '@/lib/coaching-refund': { reconcileCoachingRefund: async () => {
      assert.ok(settlementResult && ['charge.refunded', 'refund.updated'].includes(eventType))
      reconciliationCalls.push('booking-refund')
    } },
    '@/lib/coaching-payment-reconciliation': { async reconcileCoachingPaymentReconciliation() {
      assert.ok(settlementResult && ['charge.refunded', 'refund.updated'].includes(eventType))
      reconciliationCalls.push('booking-reconciliation')
    } },
    '@/lib/coaching-payment-lifecycle': { reconcileCoachingCheckout() { throw new Error('Unexpected coaching lifecycle') } },
    '@/lib/stripe/settlement': {
      isRetiredStripeTestEvent: async () => false,
      async reconcileSettlementCheckout(input) {
        assert.equal(input.service, database); assert.equal(input.sessionId, 'synthetic-session')
        reconciliationCalls.push('checkout')
        if (resultFailure) throw new Error('synthetic-provider-failure')
        return settlementResult ?? { handled: false }
      },
      async reconcileSettlementInvoice() { return { handled: false } },
      async reconcileSettlementProviderEvent(input) {
        assert.equal(input.service, database); assert.equal(input.event, event)
        reconciliationCalls.push('provider')
        if (resultFailure) throw new Error('synthetic-provider-failure')
        return settlementResult ?? { handled: false }
      },
    },
  }
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule,
    { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic', NEXT_PUBLIC_APP_URL: 'https://www.ardore-health.com' } },
  )
  return {
    receipts, reconciliationCalls,
    purchases: () => savedPurchases,
    completed: () => completed,
    run: () => loadedModule.exports.POST({ text: async () => '{}', headers: new Headers({ 'stripe-signature': 'synthetic' }) }),
  }
}

test('discounted unequal-price purchases have receipts matching the saved per-product amounts', async () => {
  const state = fixture()
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.purchases().map(p => p.amount_paid), [72, 8])
  assert.deepEqual(state.receipts.map(p => p.amountPaid), [72, 8])
  assert.deepEqual(state.receipts.map(p => p.productTitle), ['Product A', 'Product B'])
  assert.equal(state.completed(), 1)
})

test('duplicate webhook delivery sends no additional receipts and writes no purchases', async () => {
  const state = fixture(true)
  const response = await state.run()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).duplicate, true)
  assert.deepEqual(state.purchases(), [])
  assert.deepEqual(state.receipts, [])
  assert.equal(state.completed(), 0)
})

test('owned product order receipts use frozen ledger amounts and trusted buyer rather than changed offer prices or event fields', async () => {
  const state = fixture(false, { settlementResult: {
    handled: true, newlyFulfilled: true, kind: 'products', buyerId: 'synthetic-buyer',
    items: [{ productId: 'product-a', amountCents: 6500 }, { productId: 'product-b', amountCents: 1500 }],
    withdrawalConsentAt: '2026-10-03T12:00:00.000Z',
  } })
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.reconciliationCalls, ['checkout'])
  assert.deepEqual(state.purchases(), [])
  assert.deepEqual(state.receipts.map(receipt => receipt.amountPaid), [65, 15])
  assert.ok(state.receipts.every(receipt => receipt.withdrawalConsentAt === '2026-10-03T12:00:00.000Z'))
})

test('already fulfilled owned order and unsettled owned checkout never fall back to legacy fulfillment or duplicate receipts', async () => {
  for (const result of [{ handled: true, newlyFulfilled: false }, { handled: true }]) {
    const state = fixture(false, { settlementResult: result })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.purchases(), []); assert.deepEqual(state.receipts, [])
  }
  const unresolved = fixture(false, { settlementResult: { handled: false } })
  assert.equal((await unresolved.run()).status, 500)
  assert.deepEqual(unresolved.purchases(), []); assert.deepEqual(unresolved.receipts, [])
  assert.equal(unresolved.completed(), 0)
})

test('owned payment-intent success can issue a receipt if it wins before the Checkout webhook', async () => {
  const state = fixture(false, { eventType: 'payment_intent.succeeded', settlementResult: {
    handled: true, newlyFulfilled: true, kind: 'products', buyerId: 'synthetic-buyer',
    items: [{ productId: 'product-a', amountCents: 8000 }],
  } })
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.reconciliationCalls, ['provider'])
  assert.deepEqual(state.purchases(), [])
  assert.deepEqual(state.receipts.map(receipt => receipt.amountPaid), [80])
})

test('owned expired Checkout reconciles current provider state without inventing product fulfillment', async () => {
  const state = fixture(false, { eventType: 'checkout.session.expired', settlementResult: { handled: true } })
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.reconciliationCalls, ['checkout'])
  assert.deepEqual(state.purchases(), []); assert.deepEqual(state.receipts, [])
})

test('provider failure on an owned Checkout leaves the webhook retryable without legacy fulfillment', async () => {
  const state = fixture(false, { settlementResult: { handled: true }, resultFailure: true })
  assert.equal((await state.run()).status, 500)
  assert.deepEqual(state.purchases(), []); assert.deepEqual(state.receipts, [])
  assert.equal(state.completed(), 0)
})

test('owned refund/charge events reconcile transfers before booking refund projections and never apply stale product amounts', async () => {
  for (const eventType of ['charge.refunded', 'refund.updated']) {
    const state = fixture(false, { eventType, settlementResult: { handled: true } })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.reconciliationCalls, ['provider', 'booking-refund', 'booking-reconciliation'])
    assert.deepEqual(state.purchases(), []); assert.deepEqual(state.receipts, [])
  }
})

test('failed owned refund reconciliation prevents stale historical projections and keeps the event retryable', async () => {
  const state = fixture(false, { eventType: 'charge.refunded', settlementResult: { handled: true }, resultFailure: true })
  assert.equal((await state.run()).status, 500)
  assert.deepEqual(state.reconciliationCalls, ['provider'])
  assert.deepEqual(state.purchases(), []); assert.deepEqual(state.receipts, [])
  assert.equal(state.completed(), 0)
})

test('fulfillment receipts are sent once before a recoverable transfer error releases the webhook for retry', async () => {
  const state = fixture(false, { settlementResult: {
    handled: true, newlyFulfilled: true, retryNeeded: true, kind: 'products', buyerId: 'synthetic-buyer',
    items: [{ productId: 'product-a', amountCents: 8000 }],
  } })
  assert.equal((await state.run()).status, 500)
  assert.deepEqual(state.receipts.map(receipt => receipt.amountPaid), [80])
  assert.equal(state.completed(), 0)
  const retry = fixture(false, { settlementResult: { handled: true, newlyFulfilled: false } })
  assert.equal((await retry.run()).status, 200)
  assert.deepEqual(retry.receipts, [])
})
