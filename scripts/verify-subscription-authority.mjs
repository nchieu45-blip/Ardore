import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import { connectReadinessFixture } from './fixtures/connect-readiness.mjs'

const require = createRequire(import.meta.url)
const buyerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const creatorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tierId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const otherId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function load(path, overrides = {}, environment = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', 'console', output)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule, { env: environment }, { error() {} },
  )
  return loadedModule.exports
}

const entitlement = load('../src/lib/subscription-entitlement.ts')

function subscriptionFixture({ price = 25, active = true, discountCreatorId = creatorId, existing = null, readinessFailure = null } = {}) {
  const writes = []
  const checkouts = []
  const checkoutOptions = []
  const orders = []
  const registrations = []
  const notified = []
  const readinessChecks = []
  const tier = {
    id: tierId, creator_id: creatorId, name: 'Coach-controlled offer',
    price_monthly: price, is_active: active, stripe_price_id: 'price_untrusted_cache', creator: null,
  }
  const discount = {
    id: otherId, creator_id: discountCreatorId, type: 'percent', value: 20, active: true,
    starts_at: null, ends_at: null, max_redemptions: null, redemption_count: 0,
    applies_to: 'subscriptions', target_product_id: null, target_tier_id: null,
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: buyerId, email: 'delivered@resend.dev' } } }) },
    from(table) {
      const filters = {}
      return {
        select() { return this },
        eq(key, value) { filters[key] = value; return this },
        async single() {
          const row = table === 'subscription_tiers' ? tier : discount
          return { data: Object.entries(filters).every(([key, value]) => row[key] === value) ? row : null, error: null }
        },
        async maybeSingle() { assert.equal(table, 'subscriptions'); return { data: existing, error: null } },
        insert() { throw new Error('Browser client must not issue entitlement') },
        update() { throw new Error('Checkout must not write coach commercial configuration') },
      }
    },
  }
  const service = {
    from(table) {
      return {
        async insert(row) { assert.equal(table, 'subscriptions'); writes.push(row); return { error: null } },
        update(row) { assert.equal(table, 'discounts'); writes.push(row); return this },
        eq() { return this },
        then(resolve, reject) { return Promise.resolve({ error: null }).then(resolve, reject) },
      }
    },
  }
  const route = load('../src/app/api/stripe/subscription/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => service },
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { create: async (input, options) => {
      checkouts.push(input); checkoutOptions.push(options)
      return { id: 'cs_synthetic', url: 'https://checkout.stripe.com/synthetic', subscription: null }
    } } } } },
    '@/lib/stripe/settlement': {
      isRetiredStripeTestEvent: async () => false,
      async createSettlementOrder(input) { assert.equal(input.service, service); orders.push(input); return { id: 'synthetic-order' } },
      async registerSettlementCheckout(input) { assert.equal(input.service, service); registrations.push(input) },
    },
    '@/lib/stripe/platformFee': { ARDORE_PLATFORM_FEE_PERCENT: 10 },
    '@/app/api/webhooks/stripe/route': { notifyNewSubscriber: async (database, buyer, creator, selectedTier) => {
      assert.equal(database, service); notified.push({ buyer, creator, tier: selectedTier })
    } },
    '@/lib/app-url': { appOrigin: () => 'https://www.ardore-health.com' },
    '@/lib/subscription-entitlement': entitlement,
    '@/lib/stripe/connect-readiness': connectReadinessFixture({ failure: readinessFailure, onCheck(database, coach) {
      assert.equal(database, service); readinessChecks.push(coach)
    } }),
  })
  return {
    writes, checkouts, checkoutOptions, orders, registrations, notified, readinessChecks,
    run: input => route.POST(new Request('https://www.ardore-health.com/api/stripe/subscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tierId, creatorId, ...input }),
    })),
  }
}

test('a legitimate coach-controlled free tier issues only server-scoped entitlement', async () => {
  const state = subscriptionFixture({ price: 0 })
  const response = await state.run({ buyer_id: otherId, status: 'active', stripe_livemode: true })
  assert.equal(response.status, 200)
  assert.equal(state.writes.length, 1)
  assert.deepEqual({ ...state.writes[0], stripe_subscription_id: 'generated', current_period_end: 'future' }, {
    buyer_id: buyerId, creator_id: creatorId, tier_id: tierId,
    stripe_subscription_id: 'generated', stripe_livemode: null, status: 'active', current_period_end: 'future',
  })
  assert.match(state.writes[0].stripe_subscription_id, /^free_\w/)
  assert.ok(Date.parse(state.writes[0].current_period_end) > Date.now())
  assert.deepEqual(state.notified, [{ buyer: buyerId, creator: creatorId, tier: tierId }])
  assert.equal(state.checkouts.length, 0)
})

test('paid subscription freezes the coach price and settlement owner without automatic destination charges', async () => {
  const state = subscriptionFixture()
  assert.equal((await state.run({ stripe_account_id: 'acct_attacker', application_fee_percent: 0 })).status, 200)
  assert.deepEqual(state.readinessChecks, [creatorId])
  assert.deepEqual(state.checkouts[0].subscription_data, {
    metadata: { ardore_order_id: 'synthetic-order', tier_id: tierId, buyer_id: buyerId, creator_id: creatorId },
  })
  assert.deepEqual(state.orders.map(input => ({ ...input, service: 'service' })), [{
    service: 'service',
    kind: 'subscription', buyerId, creatorId, accountId: 'acct_syntheticReady',
    grossCents: 2500, livemode: false, reference: { tierId },
  }])
  assert.deepEqual(state.checkoutOptions, [{ idempotencyKey: 'ardore-order-checkout-synthetic-order-v1' }])
  assert.deepEqual(state.registrations.map(input => ({ orderId: input.orderId, sessionId: input.sessionId, subscriptionId: input.subscriptionId })), [{ orderId: 'synthetic-order', sessionId: 'cs_synthetic', subscriptionId: undefined }])
})

for (const failure of [
  { code: 'connect_account_missing', status: 409 },
  { code: 'connect_account_not_ready', status: 409 },
  { code: 'connect_mode_mismatch', status: 409 },
  { code: 'connect_provider_unavailable', status: 503 },
]) {
  test(`subscription checkout blocks ${failure.code}, while legitimate free tiers remain available`, async () => {
    const paid = subscriptionFixture({ readinessFailure: failure })
    assert.equal((await paid.run()).status, failure.status)
    assert.deepEqual(paid.writes, []); assert.deepEqual(paid.checkouts, [])
    const free = subscriptionFixture({ price: 0, readinessFailure: failure })
    assert.equal((await free.run()).status, 200)
    assert.equal(free.writes.length, 1); assert.deepEqual(free.checkouts, [])
    assert.deepEqual(free.readinessChecks, [])
  })
}

test('free tier from another coach and disabled tiers cannot issue entitlement', async () => {
  for (const [state, input] of [
    [subscriptionFixture({ price: 0 }), { creatorId: otherId }],
    [subscriptionFixture({ price: 0, active: false }), {}],
  ]) {
    const response = await state.run(input)
    assert.equal(response.status, 404)
    assert.deepEqual(state.writes, [])
    assert.deepEqual(state.checkouts, [])
  }
})

test('checkout honors each current coach price and name without trusting or changing cached Stripe IDs', async () => {
  for (const price of [25, 73.45]) {
    const state = subscriptionFixture({ price })
    assert.equal((await state.run({ status: 'active', amount: 0, price: 0 })).status, 200)
    assert.equal(state.checkouts[0].line_items[0].price_data.unit_amount, Math.round(price * 100))
    assert.equal(state.checkouts[0].line_items[0].price_data.product_data.name, 'Coach-controlled offer')
    assert.equal(state.checkouts[0].line_items[0].price, undefined)
    assert.deepEqual(state.checkouts[0].metadata, { ardore_order_id: 'synthetic-order', tier_id: tierId, buyer_id: buyerId, creator_id: creatorId })
    assert.deepEqual(state.writes, [])
  }
})

test('only this coach’s eligible discount can reduce its checkout charge', async () => {
  const owned = subscriptionFixture()
  assert.equal((await owned.run({ discountId: otherId })).status, 200)
  assert.equal(owned.checkouts[0].line_items[0].price_data.unit_amount, 2000)
  const foreign = subscriptionFixture({ discountCreatorId: buyerId })
  assert.equal((await foreign.run({ discountId: otherId })).status, 200)
  assert.equal(foreign.checkouts[0].line_items[0].price_data.unit_amount, 2500)
  assert.deepEqual(foreign.writes, [])
})

test('malformed subscription input cannot reach checkout or entitlement writes', async () => {
  const state = subscriptionFixture({ price: 0 })
  assert.equal((await state.run({ tierId: 'not-an-id' })).status, 400)
  assert.deepEqual(state.writes, [])
  assert.deepEqual(state.checkouts, [])
})

test('only future active live-paid or server-free subscriptions with matching tier ownership grant access', () => {
  const now = Date.now()
  const row = {
    creator_id: creatorId, status: 'active', current_period_end: new Date(now + 60_000).toISOString(),
    stripe_subscription_id: 'sub_synthetic', stripe_livemode: true, tier: { creator_id: creatorId },
  }
  assert.equal(entitlement.hasActiveSubscriptionEntitlement(row, now), true)
  assert.equal(entitlement.hasActiveSubscriptionEntitlement({ ...row, stripe_livemode: null, stripe_subscription_id: 'free_synthetic' }, now), true)
  for (const changes of [
    { status: 'canceled' }, { status: 'past_due' }, { status: 'trialing' },
    { current_period_end: new Date(now).toISOString() }, { current_period_end: 'invalid' },
    { stripe_livemode: false }, { stripe_livemode: null },
    { tier: { creator_id: otherId } }, { tier: null },
  ]) {
    assert.equal(entitlement.hasActiveSubscriptionEntitlement({ ...row, ...changes }, now), false)
  }
  assert.equal(entitlement.hasActiveSubscriptionEntitlement({ ...row, tier: undefined, subscription_tiers: [{ creator_id: creatorId }] }, now), true)
})

function webhookFixture({ type = 'checkout.session.completed', mismatch = false, updateError = false, status = 'active', freshStatus = status, settlementResult = null } = {}) {
  const saved = []
  const reconciliations = []
  const creatorReads = []
  const releasedEvents = []
  const completedEvents = []
  let claimToken
  const period = Math.floor(Date.now() / 1000) + 3600
  const subscription = { id: 'sub_synthetic', status, livemode: false, items: { data: [{ current_period_end: period }] } }
  const freshSubscription = { ...subscription, status: freshStatus }
  const event = {
    id: 'evt_synthetic', livemode: false, type,
    data: { object: type.startsWith('customer.subscription.') ? subscription : {
      id: type.startsWith('invoice.') ? 'in_synthetic' : 'cs_synthetic', mode: 'subscription', subscription: subscription.id,
      metadata: { tier_id: tierId, creator_id: creatorId, buyer_id: buyerId,
        ...(settlementResult ? { ardore_order_id: 'synthetic-order' } : {}) },
    } },
  }
  const service = {
    async rpc(name, params) {
      assert.equal(params.p_event_id, event.id)
      if (name === 'claim_stripe_webhook_event') {
        claimToken = params.p_lease_token
        return { data: { claimed: true, processed: false }, error: null }
      }
      assert.equal(params.p_lease_token, claimToken)
      if (name === 'release_stripe_webhook_event') releasedEvents.push(event.id)
      else { assert.equal(name, 'complete_stripe_webhook_event'); completedEvents.push(event.id) }
      return { data: true, error: null }
    },
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    from(table) {
      if (table === 'creator_profiles') creatorReads.push(table)
      const query = {
        action: 'select', select() { return this }, eq() { return this },
        async insert() { assert.equal(table, 'stripe_webhook_events'); return { error: null } },
        async single() {
          return { data: table === 'subscription_tiers' ? { id: tierId, creator_id: mismatch ? otherId : creatorId } : null, error: null }
        },
        async upsert(row) { assert.equal(table, 'subscriptions'); saved.push(row); return { error: null } },
        update(row) { assert.equal(table, 'subscriptions'); saved.push(row); return this },
        delete() { assert.equal(table, 'stripe_webhook_events'); releasedEvents.push(event.id); return this },
        then(resolve, reject) {
          return Promise.resolve({ error: table === 'subscriptions' && updateError ? { code: 'synthetic-db-error' } : null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const route = load('../src/app/api/webhooks/stripe/route.ts', {
    '@/lib/supabase/server': { createServiceClient: async () => service },
    '@/lib/stripe/server': { stripe: {
      webhooks: { constructEvent: () => event }, subscriptions: { retrieve: async () => freshSubscription },
    } },
    '@/lib/email/send': { sendPurchaseReceipt() { throw new Error('Unexpected receipt') }, sendNewSubscriberNotification() { throw new Error('Unexpected email') } },
    '@/lib/notifications': { createNotification() { throw new Error('Unexpected notification') } },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking() { throw new Error('Unexpected coaching booking') } },
    '@/lib/coaching-refund': { reconcileCoachingRefund() { throw new Error('Unexpected coaching refund') } },
    '@/lib/coaching-payment-reconciliation': { reconcileCoachingPaymentReconciliation() { throw new Error('Unexpected payment reconciliation') } },
    '@/lib/coaching-payment-lifecycle': { reconcileCoachingCheckout() { throw new Error('Unexpected coaching lifecycle') } },
    '@/lib/stripe/settlement': {
      isRetiredStripeTestEvent: async () => false,
      async reconcileSettlementCheckout(input) {
        assert.equal(input.service, service); assert.equal(input.sessionId, 'cs_synthetic')
        reconciliations.push('checkout'); return settlementResult ?? { handled: false }
      },
      async reconcileSettlementInvoice(input) {
        assert.equal(input.service, service); assert.equal(input.invoiceId, 'in_synthetic')
        reconciliations.push('invoice'); return settlementResult ?? { handled: false }
      },
      async reconcileSettlementProviderEvent(input) {
        assert.equal(input.service, service); assert.equal(input.event, event)
        reconciliations.push('provider'); return settlementResult ?? { handled: false }
      },
    },
  }, { STRIPE_SECRET_KEY: 'sk_test_synthetic' })
  return {
    saved, releasedEvents, completedEvents, period, reconciliations, creatorReads,
    run: () => route.POST({ text: async () => '{}', headers: new Headers({ 'stripe-signature': 'synthetic' }) }),
  }
}

test('a trusted Stripe subscription checkout binds tier ownership and uses current item billing periods', async () => {
  const state = webhookFixture()
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.completedEvents, ['evt_synthetic'])
  assert.deepEqual(state.saved, [{
    buyer_id: buyerId, creator_id: creatorId, tier_id: tierId, stripe_subscription_id: 'sub_synthetic',
    stripe_livemode: false, status: 'active', current_period_end: new Date(state.period * 1000).toISOString(),
  }])
  const mismatched = webhookFixture({ mismatch: true })
  assert.equal((await mismatched.run()).status, 500)
  assert.deepEqual(mismatched.saved, [])
  assert.deepEqual(mismatched.releasedEvents, ['evt_synthetic'])
  assert.deepEqual(mismatched.completedEvents, [])
})

test('Stripe paused, unpaid and incomplete lifecycle states never become active entitlement', async () => {
  for (const status of ['paused', 'unpaid', 'incomplete', 'incomplete_expired']) {
    const state = webhookFixture({ type: 'customer.subscription.updated', status })
    assert.equal((await state.run()).status, 200)
    assert.notEqual(state.saved[0].status, 'active')
    assert.equal(state.saved[0].current_period_end, new Date(state.period * 1000).toISOString())
  }
})

test('failed Stripe lifecycle updates release the event for retry instead of silently keeping access', async () => {
  for (const type of ['customer.subscription.updated', 'customer.subscription.deleted']) {
    const state = webhookFixture({ type, updateError: true })
    assert.equal((await state.run()).status, 500)
    assert.deepEqual(state.releasedEvents, ['evt_synthetic'])
    assert.deepEqual(state.completedEvents, [])
  }
})

test('historical subscription lifecycle uses fresh Stripe state rather than delayed event payloads', async () => {
  const state = webhookFixture({ type: 'customer.subscription.updated', status: 'active', freshStatus: 'canceled' })
  assert.equal((await state.run()).status, 200)
  assert.equal(state.saved[0].status, 'canceled')
})

test('owned subscription checkouts and paid invoices delegate entitlement and settlement to the trusted ledger', async () => {
  for (const type of ['checkout.session.completed', 'invoice.paid', 'invoice.payment_succeeded']) {
    const state = webhookFixture({ type, settlementResult: {
      handled: true, newlyFulfilled: true, kind: 'subscription', buyerId, creatorId, tierId, notifySubscriber: true,
    } })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.reconciliations, [type.startsWith('invoice.') ? 'invoice' : 'checkout'])
    assert.deepEqual(state.saved, [])
    assert.equal(state.creatorReads.length, 1)
  }
})

test('subscription renewals and duplicate ledger observations never repeat new-subscriber notifications', async () => {
  for (const changes of [{ newlyFulfilled: false, notifySubscriber: true }, { newlyFulfilled: true, notifySubscriber: false }]) {
    const state = webhookFixture({ type: 'invoice.paid', settlementResult: {
      handled: true, kind: 'subscription', buyerId, creatorId, tierId, ...changes,
    } })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.saved, [])
    assert.deepEqual(state.creatorReads, [])
  }
})

test('owned subscription status events do not overwrite paid invoice periods with stale event snapshots', async () => {
  for (const type of ['customer.subscription.updated', 'customer.subscription.deleted', 'invoice.payment_failed']) {
    const state = webhookFixture({ type, settlementResult: { handled: true } })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.reconciliations, ['provider'])
    assert.deepEqual(state.saved, [])
  }
})
