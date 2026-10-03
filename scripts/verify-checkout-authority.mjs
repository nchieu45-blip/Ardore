import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import { connectReadinessFixture } from './fixtures/connect-readiness.mjs'

const require = createRequire(import.meta.url)

function loadRoute(path, overrides) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule,
    { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic', NEXT_PUBLIC_APP_URL: 'https://www.ardore-health.com' } },
  )
  return loadedModule.exports
}

const buyer = { id: 'synthetic-buyer', email: 'delivered@resend.dev' }
const makeProduct = (id, creatorId, price, published = true) => ({
  id, creator_id: creatorId, price, is_published: published, title: id, type: 'pdf',
  creator: { is_demo: false, stripe_account_id: null, stripe_account_active: false },
})
const makeDiscount = creatorId => ({
  id: 'synthetic-discount', creator_id: creatorId, active: true, type: 'percent', value: 100,
  applies_to: 'all', starts_at: null, ends_at: null, max_redemptions: null, redemption_count: 0,
  target_product_id: null, target_tier_id: null,
})

function productFixture(products, discount = null, readinessFailure = null) {
  const sessions = []
  const sessionOptions = []
  const orders = []
  const registrations = []
  const readinessChecks = []
  const database = {
    auth: { getUser: async () => ({ data: { user: buyer } }) },
    from(table) {
      assert.ok(['products', 'discounts'].includes(table))
      const filters = []
      return {
        select() { return this },
        eq(key, value) { filters.push([key, value]); return this },
        in(key, value) { filters.push([key, value]); return this },
        update() { return this },
        single: async () => ({ data: discount, error: null }),
        then(resolve, reject) {
          const rows = table === 'products'
            ? products.filter(product => filters.every(([key, value]) => Array.isArray(value) ? value.includes(product[key]) : product[key] === value))
            : []
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        },
      }
    },
  }
  const route = loadRoute('../src/app/api/stripe/checkout/route.ts', {
    '@/lib/supabase/server': { createClient: async () => database, createServiceClient: async () => database },
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { create: async (data, options) => {
      sessions.push(data); sessionOptions.push(options)
      return { id: 'cs_synthetic', url: 'https://checkout.stripe.com/synthetic' }
    } } } } },
    '@/lib/stripe/settlement': {
      isRetiredStripeTestEvent: async () => false,
      async createSettlementOrder(input) { assert.equal(input.service, database); orders.push(input); return { id: 'synthetic-order' } },
      async registerSettlementCheckout(input) { assert.equal(input.service, database); registrations.push(input) },
    },
    '@/lib/stripe/platformFee': { calculateArdorePlatformFee: cents => Math.round(cents / 10) },
    '@/lib/stripe/connect-readiness': connectReadinessFixture({ failure: readinessFailure, onCheck(service, creatorId) {
      assert.equal(service, database); readinessChecks.push(creatorId)
    } }),
  })
  return {
    sessions, sessionOptions, orders, registrations, readinessChecks,
    run: body => route.POST({ json: async () => ({ withdrawalConsent: true, ...body }) }),
  }
}

test('missing or inaccessible product IDs cannot enter paid entitlement metadata', async () => {
  const state = productFixture([makeProduct('visible', 'coach-a', 1)])
  const response = await state.run({ items: [{ productId: 'visible' }, { productId: 'hidden' }] })
  assert.equal(response.status, 404)
  assert.deepEqual(state.sessions, [])
})

test('unpublished owner products cannot be smuggled into checkout metadata', async () => {
  const state = productFixture([makeProduct('visible', 'coach-a', 1), makeProduct('draft', 'coach-a', 99, false)])
  assert.equal((await state.run({ items: [{ productId: 'visible' }, { productId: 'draft' }] })).status, 404)
  assert.deepEqual(state.sessions, [])
})

test('valid checkout bills each metadata product using its current coach-controlled price', async () => {
  const state = productFixture([makeProduct('first', 'coach-a', 27.49), makeProduct('second', 'coach-a', 69.95)])
  assert.equal((await state.run({ items: [{ productId: 'second' }, { productId: 'first' }, { productId: 'second' }] })).status, 200)
  assert.equal(state.sessions[0].metadata.product_ids, 'second,first')
  assert.deepEqual(state.sessions[0].line_items.map(item => item.price_data.unit_amount), [6995, 2749])
})

test('another coach discount cannot reduce product checkout price', async () => {
  const state = productFixture([makeProduct('visible', 'coach-a', 29)], makeDiscount('coach-b'))
  assert.equal((await state.run({ productId: 'visible', discountId: 'synthetic-discount' })).status, 200)
  assert.equal(state.sessions[0].line_items[0].price_data.unit_amount, 2900)
})

test('mixed-coach cart cannot collect a platform-only payment with no coach settlement', async () => {
  const state = productFixture([makeProduct('first', 'coach-a', 29), makeProduct('second', 'coach-b', 49)], makeDiscount('coach-a'))
  assert.equal((await state.run({ items: [{ productId: 'first' }, { productId: 'second' }], discountId: 'synthetic-discount' })).status, 409)
  assert.deepEqual(state.sessions, [])
  assert.deepEqual(state.readinessChecks, [])
})

test('legitimate own-coach product discount remains usable', async () => {
  const discount = { ...makeDiscount('coach-a'), value: 20 }
  const state = productFixture([makeProduct('visible', 'coach-a', 29)], discount)
  assert.equal((await state.run({ productId: 'visible', discountId: 'synthetic-discount' })).status, 200)
  assert.equal(state.sessions[0].line_items[0].price_data.unit_amount, 2320)
})

function coachingFixture(discount, priceCents = 8000, subscription = null, readinessFailure = null) {
  const bookings = []
  const sessions = []
  const confirmations = []
  const database = {
    auth: { getUser: async () => ({ data: { user: buyer } }) },
    from(table) {
      assert.ok(['coaching_offers', 'discounts', 'creator_profiles', 'bookings', 'subscriptions'].includes(table))
      let inserted = false
      return {
        select() { return this }, eq() { return this }, update() { return this }, in() { return this }, gte() { return this },
        insert(data) { assert.equal(table, 'bookings'); inserted = true; bookings.push(data); return this },
        async maybeSingle() { return { data: null, error: null } },
        async single() {
          const data = table === 'coaching_offers'
            ? { is_enabled: true, price_cents: priceCents, duration_minutes: 60 }
            : table === 'discounts' ? discount
              : table === 'creator_profiles' ? { display_name: 'Synthetic coach', stripe_account_id: null, stripe_account_active: false }
                : table === 'subscriptions' ? subscription : inserted ? { id: 'synthetic-booking' } : null
          return { data, error: null }
        },
        then(resolve, reject) { return Promise.resolve({ error: null, count: 0 }).then(resolve, reject) },
      }
    },
  }
  const route = loadRoute('../src/app/api/coaching/book/route.ts', {
    '@/lib/supabase/server': { createClient: async () => database, createServiceClient: async () => database },
    '@/lib/coaching-booking': {
      isValidCoachingDuration: minutes => minutes === 60,
      validateCoachingSlot: async () => ({ ok: true, scheduledAt: '2026-10-05T12:00:00.000Z', bufferMinutes: 0 }),
    },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking: async id => confirmations.push(id) },
    '@/lib/coaching-slots': { berlinDateTimeToIso: () => '2026-10-05T12:00:00.000Z' },
    '@/lib/coaching-checkout': { COACHING_RESERVATION_MINUTES: 31, startOrResumeCoachingCheckout: async ({ bookingId, buyerId }) => {
      assert.equal(bookingId, 'synthetic-booking'); assert.equal(buyerId, buyer.id)
      sessions.push({ line_items: [{ price_data: { unit_amount: bookings.at(-1).price_cents } }] })
      return { status: 200, bookingId, checkoutUrl: 'https://checkout.stripe.com/synthetic' }
    } },
    '@/lib/subscription-entitlement': loadRoute('../src/lib/subscription-entitlement.ts', {}),
    '@/lib/stripe/connect-readiness': connectReadinessFixture({ failure: readinessFailure }),
    '@/lib/stripe/platformFee': { calculateArdorePlatformFee: cents => Math.round(cents / 10) },
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { create: async data => { sessions.push(data); return { id: 'synthetic-session', url: 'https://checkout.stripe.com/synthetic' } } } } } },
  })
  return {
    bookings, sessions, confirmations,
    run: () => route.POST({ json: async () => ({ creatorId: 'coach-a', date: '2026-10-05', time: '14:00', name: 'Synthetic buyer', email: buyer.email, discountId: discount?.id, subscriptionId: subscription?.id }) }),
  }
}

test('foreign 100 percent session discount cannot grant unpaid coaching entitlement', async () => {
  const state = coachingFixture(makeDiscount('coach-b'))
  assert.equal((await state.run()).status, 200)
  assert.equal(state.bookings[0].price_cents, 8000)
  assert.equal(state.bookings[0].status, 'pending_payment')
  assert.equal(state.bookings[0].payment_status, 'pending')
  assert.equal(state.sessions[0].line_items[0].price_data.unit_amount, 8000)
  assert.deepEqual(state.confirmations, [])
})

test('paid product checkout freezes commercial amounts and settles separately to a freshly verified coach', async () => {
  const state = productFixture([makeProduct('visible', 'coach-a', 27.49)])
  assert.equal((await state.run({ productId: 'visible', stripe_account_id: 'acct_attacker', application_fee_amount: 0 })).status, 200)
  assert.deepEqual(state.readinessChecks, ['coach-a'])
  assert.equal(state.sessions[0].payment_intent_data.transfer_data, undefined)
  assert.equal(state.sessions[0].payment_intent_data.application_fee_amount, undefined)
  assert.deepEqual(state.sessions[0].payment_intent_data.metadata, state.sessions[0].metadata)
  assert.equal(state.sessions[0].metadata.ardore_order_id, 'synthetic-order')
  assert.equal(state.sessions[0].payment_intent_data.transfer_group, 'ardore-order-synthetic-order')
  assert.deepEqual(state.sessionOptions, [{ idempotencyKey: 'ardore-order-checkout-synthetic-order-v1' }])
  assert.deepEqual({ ...state.orders[0], service: 'service', reference: { ...state.orders[0].reference, withdrawalConsentAt: 'timestamp' } }, {
    service: 'service', kind: 'products', buyerId: buyer.id, creatorId: 'coach-a',
    accountId: 'acct_syntheticReady', grossCents: 2749, livemode: false,
    reference: { items: [{ productId: 'visible', amountCents: 2749 }], withdrawalConsentAt: 'timestamp', withdrawalConsentVersion: 'widerruf-v1' },
  })
  assert.deepEqual(state.registrations.map(input => ({ orderId: input.orderId, sessionId: input.sessionId })), [{ orderId: 'synthetic-order', sessionId: 'cs_synthetic' }])
})

test('free coach-priced products do not require payout eligibility or create monetary Stripe fields', async () => {
  const state = productFixture([makeProduct('free', 'coach-a', 0)], null, { code: 'connect_account_missing', status: 409 })
  assert.equal((await state.run({ productId: 'free' })).status, 200)
  assert.deepEqual(state.readinessChecks, [])
  assert.equal(state.orders[0].accountId, null)
  assert.equal(state.orders[0].grossCents, 0)
  assert.deepEqual(state.orders[0].reference.items, [{ productId: 'free', amountCents: 0 }])
  assert.equal(state.sessions[0].payment_intent_data, undefined)
  assert.equal(state.sessions[0].line_items[0].price_data.unit_amount, 0)
})

for (const failure of [
  { code: 'connect_account_missing', status: 409 },
  { code: 'connect_account_not_ready', status: 409 },
  { code: 'connect_mode_mismatch', status: 409 },
  { code: 'connect_provider_unavailable', status: 503 },
]) {
  test(`paid checkout is blocked for ${failure.code}, without inserting a booking or collecting money`, async () => {
    const product = productFixture([makeProduct('visible', 'coach-a', 29)], null, failure)
    assert.equal((await product.run({ productId: 'visible' })).status, failure.status)
    assert.deepEqual(product.sessions, [])
    const coaching = coachingFixture(null, 8000, null, failure)
    assert.equal((await coaching.run()).status, failure.status)
    assert.deepEqual(coaching.bookings, [])
    assert.deepEqual(coaching.sessions, [])
    const free = coachingFixture(null, 0, null, failure)
    assert.equal((await free.run()).status, 200)
    assert.equal(free.bookings[0].payment_status, 'not_required')
  })
}

test('coach can still legitimately offer 100 percent discount on their own service', async () => {
  const state = coachingFixture(makeDiscount('coach-a'))
  assert.equal((await state.run()).status, 200)
  assert.equal(state.bookings[0].price_cents, 0)
  assert.equal(state.bookings[0].status, 'confirmed')
  assert.equal(state.bookings[0].payment_status, 'not_required')
  assert.deepEqual(state.sessions, [])
  assert.deepEqual(state.confirmations, ['synthetic-booking'])
})

test('product or subscription-targeted discount cannot grant free coaching entitlement', async () => {
  for (const target of [{ target_product_id: 'synthetic-product' }, { target_tier_id: 'synthetic-tier' }]) {
    const state = coachingFixture({ ...makeDiscount('coach-a'), ...target })
    assert.equal((await state.run()).status, 200)
    assert.equal(state.bookings[0].price_cents, 8000)
    assert.equal(state.bookings[0].payment_status, 'pending')
    assert.deepEqual(state.confirmations, [])
  }
})

test('zero coach-controlled offer price remains a valid free booking', async () => {
  const state = coachingFixture(null, 0)
  assert.equal((await state.run()).status, 200)
  assert.equal(state.bookings[0].price_cents, 0)
  assert.equal(state.bookings[0].payment_status, 'not_required')
  assert.deepEqual(state.confirmations, ['synthetic-booking'])
})

const activeSubscription = () => ({
  id: 'synthetic-subscription', buyer_id: buyer.id, creator_id: 'coach-a', status: 'active',
  current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
  stripe_subscription_id: 'sub_synthetic', stripe_livemode: true,
  subscription_tiers: { creator_id: 'coach-a', included_video_sessions: 2, video_session_period: 'month', included_session_duration_minutes: 60 },
})

test('test, expired, canceled, or foreign-tier subscriptions cannot grant included coaching sessions', async () => {
  const variants = [
    { ...activeSubscription(), stripe_livemode: false },
    { ...activeSubscription(), current_period_end: '2000-01-01T00:00:00.000Z' },
    { ...activeSubscription(), status: 'canceled' },
    { ...activeSubscription(), subscription_tiers: { ...activeSubscription().subscription_tiers, creator_id: 'coach-b' } },
  ]
  for (const subscription of variants) {
    const state = coachingFixture(null, 8000, subscription)
    assert.equal((await state.run()).status, 200)
    assert.equal(state.bookings[0].payment_status, 'pending')
    assert.equal(state.bookings[0].is_subscription_session, false)
    assert.equal(state.bookings[0].price_cents, 8000)
    assert.deepEqual(state.confirmations, [])
  }
})

test('trusted active live-paid and server-issued free subscriptions retain included coaching benefits', async () => {
  const variants = [
    activeSubscription(),
    { ...activeSubscription(), stripe_subscription_id: 'free_synthetic', stripe_livemode: null },
  ]
  for (const subscription of variants) {
    const state = coachingFixture(null, 8000, subscription)
    assert.equal((await state.run()).status, 200)
    assert.equal(state.bookings[0].payment_status, 'not_required')
    assert.equal(state.bookings[0].is_subscription_session, true)
    assert.equal(state.bookings[0].subscription_id, subscription.id)
    assert.equal(state.bookings[0].price_cents, 0)
    assert.deepEqual(state.sessions, [])
    assert.deepEqual(state.confirmations, ['synthetic-booking'])
  }
})
