import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { connectReadinessFixture } from './fixtures/connect-readiness.mjs'

const require = createRequire(import.meta.url)
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic'
function load(path, overrides, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'fetch', 'window', compiled)(
    name => name in overrides ? overrides[name] : require(name), loadedModule.exports, loadedModule, globals.fetch, globals.window,
  )
  return loadedModule.exports
}

const future = hours => new Date(Date.now() + hours * 3_600_000).toISOString()
function fixture({ existing = false, sessionStatus = 'open', intentStatus = null, bookingChanges = {}, attemptChanges = {},
  createError = null, registerError = false, claimError = null, reconcileConflict = false, readinessFailure = null } = {}) {
  const booking = { id: 'booking-synthetic', buyer_id: 'buyer-synthetic', creator_id: 'coach-synthetic',
    buyer_email: 'delivered@resend.dev', scheduled_at: future(72), duration_minutes: 60, price_cents: 500,
    status: 'pending_payment', payment_status: 'pending', cancellation_policy_hours: 24, stripe_livemode: false,
    refund_status: 'not_requested', is_subscription_session: false, current_payment_attempt_id: existing ? 'attempt-old' : null,
    stripe_checkout_session_id: existing ? 'cs_old' : null, ...bookingChanges }
  const attempts = []
  const makeAttempt = id => ({ id, booking_id: booking.id, provider_state: 'creating',
    stripe_checkout_session_id: null, stripe_payment_intent_id: null, checkout_url: null, stripe_livemode: false,
    checkout_idempotency_key: `ardore-coaching-checkout-${id}-v1`, reservation_expires_at: future(0.52), created_at: new Date().toISOString(),
    price_cents: 500, destination_account_id: 'acct_syntheticReady', application_fee_cents: 50 })
  const providerSessions = new Map()
  const intents = new Map()
  const createCalls = []; const effects = []; const providerKeys = new Map()
  const settlementOrders = new Map(); const settlementCheckouts = new Map()
  if (existing) {
    attempts.push({ ...makeAttempt('attempt-old'), provider_state: 'open', stripe_checkout_session_id: 'cs_old', ...attemptChanges })
    providerSessions.set('cs_old', { id: 'cs_old', status: sessionStatus, payment_status: intentStatus === 'succeeded' ? 'paid' : 'unpaid',
      url: sessionStatus === 'open' ? 'https://checkout.stripe.com/synthetic-old' : null,
      payment_intent: intentStatus ? 'pi_old' : null, expires_at: Math.floor(Date.now() / 1000) + 1800,
      metadata: { booking_id: booking.id, payment_attempt_id: 'attempt-old' } })
    if (intentStatus) intents.set('pi_old', { id: 'pi_old', status: intentStatus, amount_received: intentStatus === 'succeeded' ? 500 : 0 })
  }
  let registerFails = registerError; let creationFails = createError
  const provider = {
    checkout: { sessions: {
      async retrieve(id) { effects.push(`retrieve:${id}`); assert.ok(providerSessions.has(id)); return structuredClone(providerSessions.get(id)) },
      async expire(id) { effects.push(`expire:${id}`); providerSessions.get(id).status = 'expired' },
      async create(params, options) {
        createCalls.push({ params: structuredClone(params), options: { ...options } }); effects.push('create')
        const key = options.idempotencyKey
        if (!providerKeys.has(key)) {
          if (creationFails?.type === 'StripeInvalidRequestError') { const error = creationFails; creationFails = null; throw error }
          const session = { id: `cs_new_${providerKeys.size}`, status: 'open', url: 'https://checkout.stripe.com/synthetic-new', metadata: params.metadata,
            expires_at: params.expires_at, payment_intent: null }
          providerKeys.set(key, session); providerSessions.set(session.id, session)
        }
        if (creationFails) { const error = creationFails; creationFails = null; throw error }
        return structuredClone(providerKeys.get(key))
      },
      list() { return { async *[Symbol.asyncIterator]() { for (const session of providerSessions.values()) yield session } } },
    } },
    paymentIntents: {
      async retrieve(id) { effects.push(`intent-read:${id}`); return structuredClone(intents.get(id)) },
      async cancel(id) { effects.push(`intent-cancel:${id}`); intents.get(id).status = 'canceled' },
    },
  }
  const service = {
    from(table) {
      const filters = []
      return {
        select() { return this }, eq(name, value) { filters.push([name, value]); return this },
        async single() {
          if (table === 'bookings') return { data: filters.every(([name, value]) => booking[name] === value) ? structuredClone(booking) : null }
          if (table === 'coaching_payment_attempts') return { data: structuredClone(attempts.find(row => filters.every(([name, value]) => row[name] === value))) }
          assert.equal(table, 'creator_profiles')
          return { data: { display_name: 'Changed commercial name', stripe_account_id: 'acct_live_not_used_in_test', stripe_account_active: true } }
        },
      }
    },
    async rpc(name, args) {
      effects.push(name)
      if (name === 'begin_coaching_payment_attempt') {
        if (claimError) return { data: { error: claimError } }
        const existingAttempt = attempts.find(row => row.id === booking.current_payment_attempt_id)
        if (existingAttempt && ['creating', 'open', 'processing'].includes(existingAttempt.provider_state)) return { data: { booking: structuredClone(booking), attempt: structuredClone(existingAttempt), created: false } }
        if (existingAttempt) assert.equal(args.p_replace_attempt_id, existingAttempt.id)
        const attempt = { ...makeAttempt(`attempt-${attempts.length + 1}`), reservation_expires_at: args.p_expires_at,
          destination_account_id: args.p_destination_account_id, application_fee_cents: args.p_application_fee_cents,
          charge_architecture: args.p_charge_architecture }
        attempts.push(attempt); booking.current_payment_attempt_id = attempt.id; booking.status = 'pending_payment'; booking.payment_status = 'pending'
        return { data: { booking: structuredClone(booking), attempt: structuredClone(attempt), created: true } }
      }
      const attempt = attempts.find(row => row.id === args.p_attempt_id)
      assert.ok(attempt)
      if (name === 'register_coaching_checkout') {
        if (registerFails) { registerFails = false; return { error: { code: 'synthetic-write-error' } } }
        attempt.stripe_checkout_session_id = args.p_session_id; attempt.checkout_url = args.p_session_url; attempt.provider_state = 'open'
        booking.stripe_checkout_session_id = args.p_session_id
        return { data: { booking: structuredClone(booking), attempt: structuredClone(attempt), registered: true } }
      }
      assert.equal(name, 'fail_coaching_checkout_creation')
      attempt.provider_state = 'failed'; booking.status = 'payment_failed'; booking.payment_status = 'failed'
      return { data: { booking: structuredClone(booking), attempt: structuredClone(attempt) } }
    },
  }
  const reconcile = async ({ sessionId }) => {
    effects.push('reconcile')
    const session = providerSessions.get(sessionId)
    const attempt = attempts.find(row => row.stripe_checkout_session_id === sessionId)
    const intent = session.payment_intent ? intents.get(session.payment_intent) : null
    let state = intent?.status === 'succeeded' ? 'paid' : intent?.status === 'processing' ? 'processing'
      : intent?.status === 'canceled' ? 'canceled' : session.status === 'expired' ? 'expired'
        : session.status === 'complete' ? 'failed' : 'open'
    attempt.provider_state = state
    if (state === 'paid') {
      booking.status = reconcileConflict ? 'cancelled' : 'confirmed'; booking.payment_status = 'paid'
      if (reconcileConflict) booking.refund_status = 'pending'
    } else if (['failed', 'expired', 'canceled'].includes(state)) {
      booking.status = state === 'failed' ? 'payment_failed' : state === 'expired' ? 'expired' : 'reversed'
      booking.payment_status = state === 'canceled' ? 'reversed' : state
    }
    return { booking: structuredClone(booking), attempt: structuredClone(attempt), providerState: state, needs_reconciliation: reconcileConflict && state === 'paid' }
  }
  const helper = load('src/lib/coaching-checkout.ts', {
    '@/lib/stripe/server': { stripe: provider }, '@/lib/stripe/platformFee': { calculateArdorePlatformFee: cents => Math.round(cents / 10) },
    '@/lib/coaching-payment-lifecycle': { reconcileCoachingCheckout: reconcile },
    '@/lib/coaching-checkout-recovery': load('src/lib/coaching-checkout-recovery.ts', { '@/lib/stripe/server': { stripe: provider } }),
    '@/lib/stripe/connect-readiness': connectReadinessFixture({ failure: readinessFailure }),
    '@/lib/stripe/settlement': {
      isRetiredStripeTestEvent: async () => false,
      async createSettlementOrder(parameters) {
        assert.equal(parameters.service, service)
        const order = { ...parameters }; delete order.service
        if (settlementOrders.has(order.id)) assert.deepEqual(order, settlementOrders.get(order.id))
        settlementOrders.set(order.id, order); effects.push('settlement-order')
        return order
      },
      async registerSettlementCheckout({ service: database, orderId, sessionId }) {
        assert.equal(database, service); assert.ok(settlementOrders.has(orderId))
        if (settlementCheckouts.has(orderId)) assert.equal(settlementCheckouts.get(orderId), sessionId)
        settlementCheckouts.set(orderId, sessionId); effects.push('settlement-checkout')
      },
    },
  })
  return { booking, attempts, providerSessions, intents, createCalls, effects, providerKeys, settlementOrders, settlementCheckouts,
    run: (buyerId = booking.buyer_id) => helper.startOrResumeCoachingCheckout({ service, provider, bookingId: booking.id, buyerId }) }
}

test('checkout uses agreed booking amount, cutoff and attempt idempotency without reading mutable coach pricing', async () => {
  const state = fixture()
  const result = await state.run()
  assert.equal(result.status, 200); assert.equal(result.cancellationPolicyHours, 24)
  const { params, options } = state.createCalls[0]
  assert.equal(params.line_items[0].price_data.unit_amount, 500)
  assert.equal(params.metadata.payment_attempt_id, state.attempts[0].id)
  assert.equal(params.payment_intent_data.metadata.payment_attempt_id, state.attempts[0].id)
  assert.equal(options.idempotencyKey, state.attempts[0].checkout_idempotency_key)
  assert.equal(params.payment_intent_data.transfer_data, undefined, 'No transfer occurs before captured payment and fulfillment')
  assert.equal(params.payment_intent_data.application_fee_amount, undefined)
  assert.equal(params.metadata.ardore_order_id, state.attempts[0].id)
  assert.equal(params.payment_intent_data.transfer_group, `ardore-order-${state.attempts[0].id}`)
  assert.equal(state.attempts[0].destination_account_id, 'acct_syntheticReady')
  assert.equal(state.attempts[0].application_fee_cents, 50)
  const order = state.settlementOrders.get(state.attempts[0].id)
  assert.equal(order.grossCents, 500); assert.equal(order.accountId, 'acct_syntheticReady')
  assert.deepEqual(order.reference, { bookingId: state.booking.id, attemptId: state.attempts[0].id })
  assert.ok(state.effects.indexOf('settlement-order') < state.effects.indexOf('create'))
  assert.equal(state.settlementCheckouts.get(state.attempts[0].id), 'cs_new_0')
  assert.equal(state.booking.price_cents, 500); assert.equal(state.booking.cancellation_policy_hours, 24)
})

test('parallel checkout retries reuse one durable attempt and one provider session', async () => {
  const state = fixture()
  const results = await Promise.all([state.run(), state.run(), state.run()])
  assert.ok(results.every(result => result.status === 200))
  assert.equal(state.attempts.length, 1); assert.equal(state.providerKeys.size, 1)
  assert.equal(new Set(state.createCalls.map(call => call.options.idempotencyKey)).size, 1)
})

test('card failure inside an open checkout resumes the same URL without releasing its slot', async () => {
  const state = fixture({ existing: true, intentStatus: 'requires_payment_method', bookingChanges: { payment_status: 'failed' } })
  assert.equal((await state.run()).checkoutUrl, 'https://checkout.stripe.com/synthetic-old')
  assert.equal(state.booking.status, 'pending_payment'); assert.equal(state.attempts.length, 1)
  assert.equal(state.createCalls.length, 0); assert.ok(!state.effects.some(effect => effect.startsWith('intent-cancel')))
})

test('processing payment never creates another checkout or releases the hold', async () => {
  const state = fixture({ existing: true, sessionStatus: 'complete', intentStatus: 'processing' })
  const result = await state.run()
  assert.equal(result.status, 202); assert.equal(result.paymentPending, true); assert.equal(result.checkoutUrl, undefined)
  assert.equal(state.createCalls.length, 0); assert.equal(state.booking.status, 'pending_payment')
})

test('provider success encountered during retry confirms once without another charge', async () => {
  const state = fixture({ existing: true, sessionStatus: 'complete', intentStatus: 'succeeded' })
  assert.equal((await state.run()).confirmed, true)
  assert.equal(state.booking.status, 'confirmed'); assert.equal(state.createCalls.length, 0)
  assert.equal((await state.run()).confirmed, true); assert.equal(state.attempts.length, 1)
})

test('paid slot conflict exposes reconciliation rather than another checkout', async () => {
  const state = fixture({ existing: true, sessionStatus: 'complete', intentStatus: 'succeeded', reconcileConflict: true })
  const result = await state.run()
  assert.equal(result.status, 202); assert.equal(result.refundStatus, 'pending'); assert.equal(state.createCalls.length, 0)
})

test('expired checkout with no intent reacquires the same booking through an atomic claim', async () => {
  const state = fixture({ existing: true, sessionStatus: 'expired' })
  assert.equal((await state.run()).status, 200)
  assert.equal(state.attempts.length, 2); assert.equal(state.booking.id, 'booking-synthetic'); assert.equal(state.booking.price_cents, 500)
})

test('failed closed Checkout retries without using the forbidden direct PaymentIntent cancellation API', async () => {
  const state = fixture({ existing: true, sessionStatus: 'complete', intentStatus: 'requires_payment_method' })
  assert.equal((await state.run()).status, 200)
  assert.equal(state.intents.get('pi_old').status, 'requires_payment_method')
  assert.ok(!state.effects.some(effect => effect.startsWith('intent-cancel:')))
  assert.equal(state.attempts.length, 2)
  assert.equal(state.attempts[0].stripe_checkout_session_id, 'cs_old')
  assert.equal(state.attempts[0].provider_state, 'failed')
})

test('expired Checkout-owned intent is never directly canceled, and unresolved action cannot create another charge', async () => {
  const expired = fixture({ existing: true, sessionStatus: 'expired', intentStatus: 'requires_payment_method' })
  assert.equal((await expired.run()).status, 200)
  assert.equal(expired.attempts.length, 2)
  assert.ok(!expired.effects.some(effect => effect.startsWith('intent-cancel:')))
  for (const intentStatus of ['processing', 'requires_capture', 'requires_action', 'requires_confirmation']) {
    const unresolved = fixture({ existing: true, sessionStatus: 'complete', intentStatus })
    assert.equal((await unresolved.run()).status, 202)
    assert.equal(unresolved.createCalls.length, 0)
    assert.ok(!unresolved.effects.some(effect => effect.startsWith('intent-cancel:')))
  }
})

test('slot loss during retry refuses checkout before any provider charge can be created', async () => {
  const state = fixture({ existing: true, sessionStatus: 'expired', claimError: 'slot_unavailable' })
  const result = await state.run()
  assert.equal(result.status, 409); assert.match(result.error, /inzwischen belegt/)
  assert.equal(state.createCalls.length, 0); assert.equal(state.attempts.length, 1)
})

test('lost provider response keeps the hold and retries the same idempotency key', async () => {
  const state = fixture({ createError: { type: 'StripeConnectionError' } })
  assert.equal((await state.run()).status, 503)
  assert.equal(state.attempts[0].provider_state, 'creating'); assert.equal(state.booking.status, 'pending_payment')
  assert.ok(!state.effects.includes('fail_coaching_checkout_creation'))
  assert.equal((await state.run()).status, 200)
  assert.equal(state.attempts.length, 1); assert.equal(state.providerKeys.size, 1)
  assert.equal(state.createCalls[0].options.idempotencyKey, state.createCalls[1].options.idempotencyKey)
  assert.deepEqual(state.createCalls[0].params, state.createCalls[1].params)
})

test('lost database registration cannot release a payable session or create a duplicate', async () => {
  const state = fixture({ registerError: true })
  assert.equal((await state.run()).status, 503); assert.equal(state.booking.status, 'pending_payment')
  assert.equal((await state.run()).status, 200); assert.equal(state.providerKeys.size, 1); assert.equal(state.attempts.length, 1)
  assert.ok(!state.effects.includes('fail_coaching_checkout_creation'))
})

test('definitive first provider rejection marks a failed booking without pretending success', async () => {
  const state = fixture({ createError: { type: 'StripeInvalidRequestError', code: 'parameter_invalid' } })
  assert.equal((await state.run()).status, 503); assert.equal(state.booking.status, 'payment_failed')
  assert.equal(state.providerKeys.size, 0); assert.equal(state.attempts[0].provider_state, 'failed')
  assert.equal((await state.run()).status, 200); assert.equal(state.attempts.length, 2)
})

test('foreign buyer cannot read a checkout URL or make a provider request', async () => {
  const state = fixture({ existing: true })
  assert.equal((await state.run('another-buyer')).status, 404)
  assert.deepEqual(state.effects, []); assert.equal(state.createCalls.length, 0)
})

test('canceled, completed, free, past and wrong-mode bookings cannot be charged', async () => {
  for (const bookingChanges of [{ status: 'cancelled' }, { status: 'completed' }, { price_cents: 0, payment_status: 'not_required' },
    { scheduled_at: future(-1) }, { stripe_livemode: true }]) {
    const state = fixture({ bookingChanges })
    assert.equal((await state.run()).status, 409); assert.equal(state.createCalls.length, 0); assert.equal(state.attempts.length, 0)
  }
})

test('historical unknown creation result is not recreated after provider idempotency retention', async () => {
  const state = fixture({ existing: true, attemptChanges: { stripe_checkout_session_id: null, provider_state: 'creating', created_at: future(-25) } })
  state.providerSessions.clear()
  assert.equal((await state.run()).status, 503); assert.equal(state.createCalls.length, 0)
  assert.equal(state.booking.status, 'pending_payment')
})

for (const failure of [
  { code: 'connect_account_missing', status: 409 },
  { code: 'connect_account_not_ready', status: 409 },
  { code: 'connect_mode_mismatch', status: 409 },
  { code: 'connect_provider_unavailable', status: 503 },
]) {
  test(`new and open coaching checkouts fail closed for ${failure.code}`, async () => {
    for (const existing of [false, true]) {
      const state = fixture({ existing, readinessFailure: failure })
      assert.equal((await state.run()).status, failure.status)
      assert.equal(state.createCalls.length, 0)
      assert.ok(!state.effects.includes('begin_coaching_payment_attempt'))
    }
  })
}

test('reassigned Connect account cannot redirect an existing creating or open coaching attempt', async () => {
  for (const attemptChanges of [
    { destination_account_id: 'acct_previousCoach' },
    { destination_account_id: 'acct_previousCoach', stripe_checkout_session_id: null, provider_state: 'creating' },
  ]) {
    const state = fixture({ existing: true, attemptChanges })
    assert.equal((await state.run()).status, 409)
    assert.equal(state.createCalls.length, 0)
    assert.equal(state.attempts[0].destination_account_id, 'acct_previousCoach')
  }
})

test('a previously successful provider payment can still reconcile if the coach is now restricted', async () => {
  const state = fixture({ existing: true, intentStatus: 'succeeded', sessionStatus: 'complete',
    readinessFailure: { code: 'connect_account_not_ready', status: 409 } })
  assert.equal((await state.run()).confirmed, true)
  assert.equal(state.createCalls.length, 0)
  assert.equal(state.booking.payment_status, 'paid')
})

function clientHarness(response) {
  const state = []; const refs = []; let index = 0; let refIndex = 0; let requests = 0; let refreshes = 0; let assigned = null
  const Client = load('src/components/BookingPaymentActions.tsx', {
    react: { ...React, useRef: initial => { const slot = refIndex++; return refs[slot] ??= { current: initial } },
      useState: initial => { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], value => { state[slot] = value }] } },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++ } }) },
  }, { fetch: async (path, options) => { requests++; assert.equal(path, '/api/coaching/retry'); assert.deepEqual(JSON.parse(options.body), { bookingId: 'booking-synthetic' }); if (response instanceof Error) throw response; return response },
    window: { location: { assign: value => { assigned = value } } } }).default
  const render = () => { index = 0; refIndex = 0; return Client({ bookingId: 'booking-synthetic', status: 'payment_failed' }) }
  const submit = () => React.Children.toArray(render().props.children)[0].props.onClick()
  return { render, submit, get requests() { return requests }, get refreshes() { return refreshes }, get assigned() { return assigned } }
}

test('retry UI sends only booking identity and forwards the owned Checkout URL', async () => {
  const harness = clientHarness({ ok: true, json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/synthetic' }) })
  await harness.submit()
  assert.equal(harness.requests, 1); assert.equal(harness.assigned, 'https://checkout.stripe.com/synthetic')
})

test('retry UI shows processing and reconciliation without announcing a successful payment', async () => {
  for (const extra of [{ paymentPending: true }, { refundStatus: 'pending' }]) {
    const harness = clientHarness({ ok: true, status: 202, json: async () => extra })
    await harness.submit()
    const html = renderToStaticMarkup(harness.render())
    assert.match(html, /role="status"/); assert.match(html, /keine weitere Zahlung/)
    assert.doesNotMatch(html, /wurde bestätigt/); assert.equal(harness.refreshes, 1); assert.equal(harness.assigned, null)
  }
})

test('retry UI surfaces slot loss and network errors with a retryable button', async () => {
  for (const response of [{ ok: false, json: async () => ({ error: 'Dieser Termin ist inzwischen belegt.' }) }, new Error('Synthetic offline')]) {
    const harness = clientHarness(response); await harness.submit()
    const html = renderToStaticMarkup(harness.render())
    assert.match(html, /role="alert"/); assert.doesNotMatch(html, /disabled=""|wurde bestätigt/)
  }
})

test('technical payment reconciliation clearly distinguishes pending, failed and provider-confirmed refunds', () => {
  const ui = load('src/components/BookingPaymentActions.tsx', {
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
  })
  const show = state => renderToStaticMarkup(React.createElement(ui.BookingPaymentReconciliationStatus, { state }))
  assert.match(show('pending'), /role="status".*keiner bestätigten Session.*noch nicht bestätigt/)
  assert.match(show('failed'), /role="alert".*noch nicht abgeschlossen.*keine weitere Zahlung/)
  assert.match(show('succeeded'), /role="status".*Stripe die Erstattung bestätigt/)
  assert.doesNotMatch(show('pending'), /Stripe die Erstattung bestätigt|kostenlose Stornierung/)
  assert.equal(show('not_requested'), '')
})

function requestFixture(existing = null) {
  const rows = existing ? [{ id: 'booking-existing', creator_id: 'coach-synthetic', buyer_id: 'buyer-synthetic',
    scheduled_at: '2027-01-05T12:00:00+00:00', buyer_name: 'Synthetic buyer', buyer_email: 'delivered@resend.dev', notes: null,
    status: 'pending_payment', payment_status: 'pending', cancellation_policy_hours: 24,
    booking_request_key: 'b0f85747-69c9-4d2d-b3a8-79dca7ac3671', ...existing }] : []
  let provisions = 0; let resumed = 0; let offerReads = 0
  const service = {
    auth: { getUser: async () => ({ data: { user: { id: 'buyer-synthetic', email: 'delivered@resend.dev' } } }) },
    from(table) {
      const filters = []
      let inserted = null
      return {
        select() { return this }, eq(name, value) { filters.push([name, value]); return this },
        insert(data) { assert.equal(table, 'bookings'); inserted = { id: `booking-${rows.length}`, ...data }; rows.push(inserted); return this },
        async maybeSingle() { assert.equal(table, 'bookings'); return { data: rows.find(row => filters.every(([name, value]) => row[name] === value)) ?? null } },
        async single() {
          if (table === 'coaching_offers') { offerReads++; return { data: { is_enabled: true, price_cents: 500, duration_minutes: 60, cancellation_policy_hours: 24 } } }
          if (table === 'creator_profiles') return { data: { display_name: 'Synthetic coach', stripe_account_id: null, stripe_account_active: false } }
          assert.equal(table, 'bookings'); return { data: inserted }
        },
      }
    },
  }
  const route = load('src/app/api/coaching/book/route.ts', {
    '@/lib/supabase/server': { createClient: async () => service, createServiceClient: async () => service },
    '@/lib/coaching-slots': { berlinDateTimeToIso: () => '2027-01-05T12:00:00.000Z' },
    '@/lib/coaching-booking': { isValidCoachingDuration: () => true, validateCoachingSlot: async () => ({ ok: true, scheduledAt: '2027-01-05T12:00:00.000Z', bufferMinutes: 0 }) },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking: async () => { provisions++ } },
    '@/lib/subscription-entitlement': { hasActiveSubscriptionEntitlement: () => false },
    '@/lib/stripe/connect-readiness': connectReadinessFixture(),
    '@/lib/coaching-checkout': { COACHING_RESERVATION_MINUTES: 31, startOrResumeCoachingCheckout: async ({ bookingId, buyerId }) => {
      assert.equal(buyerId, 'buyer-synthetic'); resumed++; return { status: 200, bookingId, checkoutUrl: 'https://checkout.stripe.com/synthetic' }
    } },
  })
  const request = changes => route.POST({ json: async () => ({ requestId: 'b0f85747-69c9-4d2d-b3a8-79dca7ac3671',
    creatorId: 'coach-synthetic', date: '2027-01-05', time: '13:00', name: 'Synthetic buyer', email: 'delivered@resend.dev', expectedCancellationPolicyHours: 24, ...changes }) })
  return { rows, request, get provisions() { return provisions }, get resumed() { return resumed }, get offerReads() { return offerReads } }
}

test('same initial request UUID reuses its owned booking, including normalized timestamps', async () => {
  const fixture = requestFixture()
  const first = await fixture.request(); const second = await fixture.request()
  assert.equal(first.status, 200); assert.equal(second.status, 200)
  assert.equal((await first.json()).bookingId, (await second.json()).bookingId)
  assert.equal(fixture.rows.length, 1); assert.equal(fixture.offerReads, 1)
})

test('request replay reads frozen agreement before mutable offer settings', async () => {
  const fixture = requestFixture({})
  assert.equal((await fixture.request()).status, 200)
  assert.equal(fixture.offerReads, 0); assert.equal(fixture.rows.length, 1)
})

test('request UUID reused with different booking terms is refused', async () => {
  const fixture = requestFixture({})
  for (const changes of [{ creatorId: 'another-coach' }, { name: 'Different name' }, { notes: 'Different notes' }, { expectedCancellationPolicyHours: 48 }]) {
    assert.equal((await fixture.request(changes)).status, 409)
  }
  assert.equal(fixture.resumed, 0); assert.equal(fixture.rows.length, 1)
})

test('free booking replay does not send confirmation or grant entitlement again', async () => {
  const fixture = requestFixture({ status: 'confirmed', payment_status: 'not_required' })
  assert.equal((await fixture.request()).status, 200)
  assert.equal(fixture.provisions, 0); assert.equal(fixture.resumed, 0)
})

test('malformed request UUID cannot touch commercial data or create checkout', async () => {
  const fixture = requestFixture()
  assert.equal((await fixture.request({ requestId: 'not-a-uuid' })).status, 400)
  assert.equal(fixture.rows.length, 0); assert.equal(fixture.offerReads, 0); assert.equal(fixture.resumed, 0)
})

test('recovery registers only one exact trusted provider session without creating any new session', async () => {
  const attempt = { id: 'attempt-lost', booking_id: 'booking-synthetic', buyer_id: 'buyer-synthetic', creator_id: 'coach-synthetic',
    price_cents: 500, stripe_livemode: false, provider_state: 'creating', stripe_checkout_session_id: null, created_at: future(-25) }
  let registered = 0
  const service = { from: () => ({ select() { return this }, eq() { return this }, single: async () => ({ data: attempt }) }),
    rpc: async (name, args) => { assert.equal(name, 'register_coaching_checkout'); assert.equal(args.p_attempt_id, attempt.id); registered++; return { data: { registered: true } } } }
  const metadata = { checkout_type: 'coaching_session', payment_attempt_id: attempt.id, booking_id: attempt.booking_id, buyer_id: attempt.buyer_id, creator_id: attempt.creator_id }
  const correct = { id: 'cs_lost', livemode: false, mode: 'payment', currency: 'eur', amount_total: 500, metadata, url: null }
  const cases = [[correct], [], [correct, { ...correct, id: 'cs_duplicate' }], [{ ...correct, amount_total: 600 }]]
  for (const sessions of cases) {
    const provider = { checkout: { sessions: { list: () => ({ async *[Symbol.asyncIterator]() { for (const session of sessions) yield session } }) } } }
    const recovery = load('src/lib/coaching-checkout-recovery.ts', { '@/lib/stripe/server': { stripe: provider } })
    if (sessions[0]?.amount_total === 600) {
      await assert.rejects(recovery.recoverCreatingCoachingCheckout({ service, attemptId: attempt.id, provider }), /ownership mismatch/)
    } else {
      const result = await recovery.recoverCreatingCoachingCheckout({ service, attemptId: attempt.id, provider })
      assert.equal(result.sessionId, sessions.length === 1 ? correct.id : null)
      assert.equal(result.noSessionProven, false)
    }
  }
  assert.equal(registered, 1)
})
