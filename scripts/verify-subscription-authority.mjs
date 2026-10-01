import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

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

function subscriptionFixture({ price = 25, active = true, discountCreatorId = creatorId, existing = null } = {}) {
  const writes = []
  const checkouts = []
  const notified = []
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
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { create: async input => {
      checkouts.push(input); return { url: 'https://checkout.stripe.com/synthetic' }
    } } } } },
    '@/lib/stripe/platformFee': { ARDORE_PLATFORM_FEE_PERCENT: 10 },
    '@/app/api/webhooks/stripe/route': { notifyNewSubscriber: async (database, buyer, creator, selectedTier) => {
      assert.equal(database, service); notified.push({ buyer, creator, tier: selectedTier })
    } },
    '@/lib/app-url': { appOrigin: () => 'https://www.ardore-health.com' },
    '@/lib/subscription-entitlement': entitlement,
  })
  return {
    writes, checkouts, notified,
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
    assert.deepEqual(state.checkouts[0].metadata, { tier_id: tierId, buyer_id: buyerId, creator_id: creatorId })
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

function webhookFixture({ type = 'checkout.session.completed', mismatch = false, updateError = false, status = 'active' } = {}) {
  const saved = []
  const releasedEvents = []
  const period = Math.floor(Date.now() / 1000) + 3600
  const subscription = { id: 'sub_synthetic', status, livemode: false, items: { data: [{ current_period_end: period }] } }
  const event = {
    id: 'evt_synthetic', livemode: false, type,
    data: { object: type.startsWith('customer.subscription.') ? subscription : {
      mode: 'subscription', subscription: subscription.id,
      metadata: { tier_id: tierId, creator_id: creatorId, buyer_id: buyerId },
    } },
  }
  const service = {
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    from(table) {
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
      webhooks: { constructEvent: () => event }, subscriptions: { retrieve: async () => subscription },
    } },
    '@/lib/email/send': { sendPurchaseReceipt() { throw new Error('Unexpected receipt') }, sendNewSubscriberNotification() { throw new Error('Unexpected email') } },
    '@/lib/notifications': { createNotification() { throw new Error('Unexpected notification') } },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking() { throw new Error('Unexpected coaching booking') } },
  }, { STRIPE_SECRET_KEY: 'sk_test_synthetic' })
  return {
    saved, releasedEvents, period,
    run: () => route.POST({ text: async () => '{}', headers: new Headers({ 'stripe-signature': 'synthetic' }) }),
  }
}

test('a trusted Stripe subscription checkout binds tier ownership and uses current item billing periods', async () => {
  const state = webhookFixture()
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.saved, [{
    buyer_id: buyerId, creator_id: creatorId, tier_id: tierId, stripe_subscription_id: 'sub_synthetic',
    stripe_livemode: false, status: 'active', current_period_end: new Date(state.period * 1000).toISOString(),
  }])
  const mismatched = webhookFixture({ mismatch: true })
  assert.equal((await mismatched.run()).status, 500)
  assert.deepEqual(mismatched.saved, [])
  assert.deepEqual(mismatched.releasedEvents, ['evt_synthetic'])
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
  }
})
