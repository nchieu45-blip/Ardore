import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const buyerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const creatorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const attemptId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const nextAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

function load(path, overrides, logs = []) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', 'console', compiled)(
    name => name in overrides ? overrides[name] : require(name), loadedModule.exports, loadedModule,
    { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic' } }, { error: (...items) => logs.push(items) },
  )
  return loadedModule.exports
}

function fixture({ legacy = false, slotTaken = false, bookingChanges = {}, attemptChanges = {} } = {}) {
  const booking = {
    id: bookingId, buyer_id: buyerId, creator_id: creatorId, price_cents: 500,
    status: 'pending_payment', payment_status: 'pending', stripe_livemode: false,
    stripe_checkout_session_id: 'cs_synthetic', current_payment_attempt_id: attemptId, fulfilled_payment_attempt_id: null,
    reservation_expires_at: new Date(Date.now() - 1000).toISOString(),
    ...bookingChanges,
  }
  const attempt = {
    id: attemptId, booking_id: bookingId, buyer_id: buyerId, creator_id: creatorId,
    price_cents: 500, stripe_livemode: false, stripe_checkout_session_id: 'cs_synthetic',
    stripe_payment_intent_id: null, destination_account_id: null, application_fee_cents: 0,
    legacy_checkout: legacy, provider_state: 'creating', fulfillment_state: 'not_fulfilled',
    ...attemptChanges,
  }
  const metadata = {
    checkout_type: 'coaching_session', booking_id: bookingId, buyer_id: buyerId, creator_id: creatorId,
    ...(legacy ? {} : { payment_attempt_id: attemptId }),
  }
  const session = {
    id: 'cs_synthetic', livemode: false, mode: 'payment', currency: 'eur', amount_total: 500,
    status: 'open', payment_status: 'unpaid', payment_intent: 'pi_synthetic', metadata: { ...metadata },
    expires_at: Math.floor(Date.now() / 1000) + 1800,
  }
  const intent = {
    id: 'pi_synthetic', livemode: false, currency: 'eur', amount: 500, amount_received: 0,
    status: 'requires_payment_method', latest_charge: null, metadata: { ...metadata },
    transfer_data: null, application_fee_amount: null, last_payment_error: null,
  }
  const charge = {
    id: 'ch_synthetic', payment_intent: intent.id, livemode: false, currency: 'eur', paid: true,
    captured: true, disputed: false, amount_captured: 500, amount_refunded: 0,
    metadata: { ...metadata }, transfer_data: null,
  }
  const sessions = new Map([[session.id, session]])
  const intents = new Map([[intent.id, intent]])
  const charges = new Map([[charge.id, charge]])
  const attempts = new Map([[attempt.id, attempt]])
  const claims = new Map()
  const observations = []
  const reconciliations = []
  const cancellationReconciliations = []
  const providerReads = []
  const logs = []
  let confirmations = 0
  let providerFailure = null
  let readBarrier = null
  let observationError = null
  let recoveredSessionId = null
  let recoveryError = null
  const recoveries = []
  const legacyRegistrations = []
  const service = {
    from(table) {
      assert.ok(['bookings', 'coaching_payment_attempts', 'purchases'].includes(table), table)
      const filters = []
      const execute = () => {
        const rows = table === 'bookings' ? [booking] : table === 'coaching_payment_attempts' ? [...attempts.values()] : []
        return rows.filter(row => filters.every(testRow => testRow(row)))
      }
      return {
        select() { return this }, eq(key, value) { filters.push(row => row[key] === value); return this },
        lte(key, value) { filters.push(row => row[key] <= value); return this },
        order() { return this }, limit() { return this }, update() { assert.equal(table, 'purchases'); return this },
        async maybeSingle() { return { data: execute()[0] ?? null, error: null } },
        then(resolve, reject) { return Promise.resolve({ data: execute(), error: null }).then(resolve, reject) },
      }
    },
    async rpc(name, params) {
      if (name === 'claim_stripe_webhook_event') {
        const current = claims.get(params.p_event_id)
        if (current?.processed) return { data: { claimed: false, processed: true, busy: false }, error: null }
        if (current && !current.expired) return { data: { claimed: false, processed: false, busy: true }, error: null }
        claims.set(params.p_event_id, { token: params.p_lease_token, processed: false, expired: false })
        return { data: { claimed: true, processed: false, busy: false }, error: null }
      }
      if (name === 'complete_stripe_webhook_event' || name === 'release_stripe_webhook_event') {
        const current = claims.get(params.p_event_id)
        if (!current || current.token !== params.p_lease_token) return { data: false, error: null }
        if (name === 'complete_stripe_webhook_event') current.processed = true
        else { current.token = null; current.expired = true }
        return { data: true, error: null }
      }
      if (name === 'register_legacy_coaching_payment_attempt') {
        assert.equal(params.p_booking_id, booking.id)
        assert.equal(params.p_session_id, booking.stripe_checkout_session_id)
        assert.equal(params.p_livemode, booking.stripe_livemode)
        assert.equal(legacy, true)
        legacyRegistrations.push(params)
        attempts.set(attempt.id, attempt)
        return { data: { booking, attempt, created: true }, error: null }
      }
      assert.equal(name, 'observe_coaching_payment_attempt')
      if (observationError) { const error = observationError; observationError = null; return { data: null, error } }
      const active = attempts.get(params.p_attempt_id)
      assert.ok(active)
      const observed = params.p_observation
      assert.equal(observed.session_id, active.stripe_checkout_session_id)
      assert.equal(observed.amount_total, active.price_cents)
      assert.equal(observed.buyer_id, active.buyer_id)
      assert.equal(observed.creator_id, active.creator_id)
      assert.equal(observed.livemode, active.stripe_livemode)
      observations.push(structuredClone(params))
      const current = booking.current_payment_attempt_id === active.id
      let newlyConfirmed = false
      let needsReconciliation = false
      // This boundary fixture models the atomic RPC contract. Its real SQL
      // exclusion, state machine, and role grants have separate database tests.
      if (active.provider_state !== 'paid' || observed.provider_state === 'paid') active.provider_state = observed.provider_state
      if (observed.provider_state === 'paid') {
        active.stripe_payment_intent_id = observed.payment_intent_id
        if (active.fulfillment_state === 'paid_confirmed') {
          // A repeated observation must not provision another booking.
        } else if ((booking.fulfilled_payment_attempt_id && booking.fulfilled_payment_attempt_id !== active.id)
          || (booking.status === 'confirmed' && booking.payment_status === 'paid')
          || ['cancelled', 'completed', 'refunded'].includes(booking.status) || slotTaken || observed.force_reconciliation_reason) {
          active.fulfillment_state = 'reconciliation_pending'
          needsReconciliation = true
          if (current) { booking.status = 'cancelled'; booking.payment_status = 'paid' }
        } else {
          booking.status = 'confirmed'; booking.payment_status = 'paid'
          booking.fulfilled_payment_attempt_id = active.id
          active.fulfillment_state = 'paid_confirmed'; newlyConfirmed = true
        }
      } else if (current && !booking.fulfilled_payment_attempt_id && booking.payment_status !== 'paid'
        && !['paid_confirmed', 'reconciliation_pending', 'reconciled'].includes(active.fulfillment_state)) {
        if (observed.provider_state === 'expired') { booking.status = 'expired'; booking.payment_status = 'expired' }
        else if (observed.provider_state === 'failed') { booking.status = 'payment_failed'; booking.payment_status = 'failed' }
        else if (observed.provider_state === 'canceled') { booking.status = 'payment_failed'; booking.payment_status = 'reversed' }
        else { booking.status = 'pending_payment'; booking.payment_status = observed.provider_error_code ? 'failed' : 'pending' }
      }
      return { data: { booking: structuredClone(booking), attempt: structuredClone(active), applied: true,
        newly_confirmed: newlyConfirmed, needs_reconciliation: needsReconciliation }, error: null }
    },
  }
  const provider = {
    webhooks: { constructEvent: payload => JSON.parse(payload) },
    checkout: { sessions: {
      retrieve: async id => {
        providerReads.push({ kind: 'session', id })
        if (readBarrier) await readBarrier
        if (providerFailure) { const error = providerFailure; providerFailure = null; throw error }
        assert.ok(sessions.has(id)); return structuredClone(sessions.get(id))
      },
      list: async ({ payment_intent }) => ({ data: [...sessions.values()].filter(row => row.payment_intent === payment_intent).map(row => structuredClone(row)) }),
    } },
    paymentIntents: { retrieve: async id => { providerReads.push({ kind: 'intent', id }); assert.ok(intents.has(id)); return structuredClone(intents.get(id)) } },
    charges: { retrieve: async id => { providerReads.push({ kind: 'charge', id }); assert.ok(charges.has(id)); return structuredClone(charges.get(id)) } },
  }
  const refund = {
    processCoachingPaymentReconciliation: async ({ service: database, attemptId: id }) => {
      assert.equal(database, service)
      if (!reconciliations.includes(id)) reconciliations.push(id)
      return { state: 'succeeded' }
    },
    reconcileCoachingPaymentReconciliation: async () => null,
    reconcileCoachingRefund: async input => { cancellationReconciliations.push(input); return null },
  }
  const confirmation = { provisionConfirmedCoachingBooking: async id => { assert.equal(id, booking.id); confirmations += 1 } }
  const helper = load('../src/lib/coaching-payment-lifecycle.ts', {
    '@/lib/stripe/server': { stripe: provider }, '@/lib/coaching-payment-reconciliation': refund,
    '@/lib/coaching-confirmation': confirmation,
    '@/lib/coaching-checkout-recovery': { recoverCreatingCoachingCheckout: async input => {
      recoveries.push(input)
      if (recoveryError) throw recoveryError
      return { sessionId: recoveredSessionId, unresolved: !recoveredSessionId, noSessionProven: false }
    } },
  }, logs)
  const route = load('../src/app/api/webhooks/stripe/route.ts', {
    '@/lib/stripe/server': { stripe: provider }, '@/lib/supabase/server': { createServiceClient: async () => service },
    '@/lib/coaching-refund': refund, '@/lib/coaching-payment-reconciliation': refund, '@/lib/coaching-payment-lifecycle': helper,
    '@/lib/email/send': {}, '@/lib/notifications': {},
  }, logs)
  return {
    booking, attempt, session, intent, charge, sessions, intents, charges, attempts, claims,
    observations, reconciliations, providerReads, recoveries, legacyRegistrations, logs, helper, confirmations: () => confirmations,
    paid() { session.status = 'complete'; session.payment_status = 'paid'; intent.status = 'succeeded'; intent.amount_received = 500; intent.latest_charge = charge.id },
    failProvider(error = { code: 'api_connection_error', message: 'private-provider-data' }) { providerFailure = error },
    failObservation(error = { code: '40001' }) { observationError = error },
    barrier(promise) { readBarrier = promise },
    recoverSession(id) { recoveredSessionId = id },
    failRecovery(error) { recoveryError = error },
    run(type, object = type.startsWith('payment_intent.') ? intent : session, id = `evt_${type}`, mode = false) {
      const event = { id, type, livemode: mode, data: { object: structuredClone(object) } }
      return route.POST({ text: async () => JSON.stringify(event), headers: new Headers({ 'stripe-signature': 'synthetic' }) })
    },
    reconcile: (id = session.id) => helper.reconcileCoachingCheckout({ service, sessionId: id, stripeLivemode: false }),
    timeouts: () => helper.reconcileExpiredCoachingReservations({ service }),
  }
}

test('captured payment confirms once, recording the provider amount and exact identities', async () => {
  const state = fixture(); state.paid()
  assert.equal((await state.run('checkout.session.completed')).status, 200)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 1)
  const observed = state.observations[0].p_observation
  assert.equal(observed.amount_paid_cents, 500)
  assert.equal(observed.payment_intent_id, 'pi_synthetic')
  assert.equal(observed.provider_state, 'paid')
  assert.ok(state.providerReads.some(row => row.kind === 'charge'))
})

test('completed but unpaid asynchronous checkout never confirms or releases its held slot', async () => {
  const state = fixture(); state.session.status = 'complete'; state.intent.status = 'processing'
  assert.equal((await state.run('checkout.session.completed')).status, 200)
  assert.equal(state.booking.status, 'pending_payment')
  assert.equal(state.observations[0].p_observation.provider_state, 'processing')
  assert.equal(state.confirmations(), 0)
})

test('an open Checkout card failure is retryable and keeps the slot held', async () => {
  const state = fixture(); state.intent.last_payment_error = { code: 'card_declined' }
  assert.equal((await state.run('payment_intent.payment_failed')).status, 200)
  assert.equal(state.booking.status, 'pending_payment')
  assert.equal(state.booking.payment_status, 'failed')
  assert.equal(state.observations[0].p_observation.provider_state, 'open')
  assert.equal(state.observations[0].p_observation.provider_error_code, 'payment_failed')
  assert.equal(state.confirmations(), 0)
})

test('a card failure followed by payment in the same Checkout confirms the same booking', async () => {
  const state = fixture(); state.intent.last_payment_error = { code: 'card_declined' }
  await state.run('payment_intent.payment_failed'); state.paid()
  assert.equal((await state.run('checkout.session.completed')).status, 200)
  assert.equal(state.booking.id, bookingId)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 1)
})

for (const [eventType, sessionStatus, intentStatus, expected] of [
  ['checkout.session.expired', 'expired', 'requires_payment_method', 'expired'],
  ['checkout.session.async_payment_failed', 'complete', 'requires_payment_method', 'payment_failed'],
  ['payment_intent.canceled', 'expired', 'canceled', 'payment_failed'],
]) {
  test(`${eventType} releases a current unfulfilled attempt only after a terminal provider read`, async () => {
    const state = fixture(); state.session.status = sessionStatus; state.intent.status = intentStatus
    assert.equal((await state.run(eventType)).status, 200)
    assert.equal(state.booking.status, expected)
    assert.equal(state.confirmations(), 0)
    assert.equal(state.reconciliations.length, 0)
  })
}

for (const status of ['payment_failed', 'expired']) {
  test(`delayed success restores ${status} booking when its slot is available`, async () => {
    const state = fixture({ bookingChanges: { status, payment_status: status === 'expired' ? 'expired' : 'failed' } }); state.paid()
    assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 200)
    assert.equal(state.booking.status, 'confirmed')
    assert.equal(state.confirmations(), 1)
    assert.equal(state.reconciliations.length, 0)
  })
}

test('delayed success after a slot is occupied delegates durable full reconciliation and never confirms', async () => {
  const state = fixture({ slotTaken: true, bookingChanges: { status: 'expired', payment_status: 'expired' } }); state.paid()
  assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 200)
  assert.equal(state.booking.status, 'cancelled')
  assert.equal(state.confirmations(), 0)
  assert.deepEqual(state.reconciliations, [attemptId])
  assert.equal(state.attempt.fulfillment_state, 'reconciliation_pending')
})

test('duplicate completed event and distinct success events provision no duplicate entitlement', async () => {
  const state = fixture(); state.paid()
  const first = await state.run('checkout.session.completed', state.session, 'evt_same')
  const duplicate = await state.run('checkout.session.completed', state.session, 'evt_same')
  const equivalent = await state.run('checkout.session.async_payment_succeeded', state.session, 'evt_other')
  assert.equal(first.status, 200); assert.equal(duplicate.status, 200); assert.equal(equivalent.status, 200)
  assert.equal((await duplicate.json()).duplicate, true)
  assert.equal(state.observations.length, 2)
  assert.equal(state.confirmations(), 1)
})

test('duplicate failed event is a no-op and a stale failed event observes current success', async () => {
  const state = fixture(); state.intent.last_payment_error = { code: 'card_declined' }
  const staleIntent = structuredClone(state.intent)
  await state.run('payment_intent.payment_failed', staleIntent, 'evt_failed')
  const duplicate = await state.run('payment_intent.payment_failed', staleIntent, 'evt_failed')
  assert.equal((await duplicate.json()).duplicate, true)
  state.paid()
  assert.equal((await state.run('payment_intent.payment_failed', staleIntent, 'evt_late_failed')).status, 200)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 1)
})

test('failure, expiration, and canceled payloads arriving after success cannot downgrade the booking', async () => {
  const state = fixture(); const staleSession = structuredClone(state.session); const staleIntent = structuredClone(state.intent)
  state.paid(); await state.run('checkout.session.completed', state.session, 'evt_first')
  for (const type of ['checkout.session.expired', 'checkout.session.async_payment_failed', 'payment_intent.payment_failed', 'payment_intent.canceled']) {
    assert.equal((await state.run(type, type.startsWith('checkout.') ? staleSession : staleIntent)).status, 200)
    assert.equal(state.booking.status, 'confirmed')
    assert.equal(state.booking.payment_status, 'paid')
  }
  assert.equal(state.confirmations(), 1)
})

test('a successful obsolete attempt cannot replace the retry winner and is reconciled separately', async () => {
  const state = fixture({ bookingChanges: { current_payment_attempt_id: nextAttemptId, status: 'confirmed', payment_status: 'paid' } }); state.paid()
  assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 200)
  assert.equal(state.booking.current_payment_attempt_id, nextAttemptId)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 0)
  assert.deepEqual(state.reconciliations, [attemptId])
})

test('an obsolete failure does not affect a newer retry reservation', async () => {
  const state = fixture({ bookingChanges: { current_payment_attempt_id: nextAttemptId } })
  state.session.status = 'expired'
  assert.equal((await state.run('checkout.session.expired')).status, 200)
  assert.equal(state.booking.status, 'pending_payment')
  assert.equal(state.booking.payment_status, 'pending')
})

test('replayed conflict success events retain one reconciliation claim', async () => {
  const state = fixture({ slotTaken: true }); state.paid()
  for (let index = 0; index < 3; index += 1) assert.equal((await state.run('checkout.session.async_payment_succeeded', state.session, `evt_conflict_${index}`)).status, 200)
  assert.deepEqual(state.reconciliations, [attemptId])
  assert.equal(state.confirmations(), 0)
})

test('a captured charge already refunded before fulfillment is reconciled instead of granted', async () => {
  const state = fixture(); state.paid(); state.charge.amount_refunded = 500
  assert.equal((await state.run('checkout.session.completed')).status, 200)
  assert.equal(state.observations[0].p_observation.force_reconciliation_reason, 'payment_already_refunded')
  assert.equal(state.confirmations(), 0)
  assert.deepEqual(state.reconciliations, [attemptId])
})

test('PaymentIntent success resolves its owned Session even if the completed webhook was missed', async () => {
  const state = fixture(); state.paid()
  assert.equal((await state.run('payment_intent.succeeded')).status, 200)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 1)
})

test('provider outage releases the lease, emits only a machine code, and permits delivery retry', async () => {
  const state = fixture(); state.paid(); state.failProvider()
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_retry')).status, 500)
  assert.equal(state.claims.get('evt_retry')?.processed, false)
  assert.equal(state.claims.get('evt_retry')?.expired, true)
  assert.equal(state.confirmations(), 0)
  assert.deepEqual(state.logs, [['[stripe-webhook] processing failed', 'api_connection_error']])
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_retry')).status, 200)
  assert.equal(state.confirmations(), 1)
})

test('database observation failure cannot mark an event processed or grant entitlement', async () => {
  const state = fixture(); state.paid(); state.failObservation()
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_database')).status, 500)
  assert.equal(state.claims.get('evt_database')?.processed, false)
  assert.equal(state.claims.get('evt_database')?.expired, true)
  assert.equal(state.booking.status, 'pending_payment')
  assert.equal(state.confirmations(), 0)
})

test('an in-flight duplicate receives a retryable response and cannot steal the lease', async () => {
  const state = fixture(); state.paid()
  state.claims.set('evt_busy', { token: 'other-token', processed: false, expired: false })
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_busy')).status, 503)
  assert.equal(state.providerReads.length, 0)
  assert.equal(state.claims.get('evt_busy').token, 'other-token')
})

test('an abandoned expired lease can be reclaimed and completed', async () => {
  const state = fixture(); state.paid()
  state.claims.set('evt_abandoned', { token: 'old-token', processed: false, expired: true })
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_abandoned')).status, 200)
  assert.equal(state.claims.get('evt_abandoned').processed, true)
  assert.equal(state.confirmations(), 1)
})

test('provider mode mismatch is rejected before claiming or reading any provider resources', async () => {
  const state = fixture(); state.paid()
  assert.equal((await state.run('checkout.session.completed', state.session, 'evt_live', true)).status, 400)
  assert.equal(state.claims.size, 0)
  assert.equal(state.providerReads.length, 0)
})

for (const [description, change] of [
  ['buyer metadata', state => { state.session.metadata.buyer_id = 'foreign-buyer' }],
  ['creator metadata', state => { state.session.metadata.creator_id = 'foreign-creator' }],
  ['Checkout amount', state => { state.session.amount_total = 600 }],
  ['Checkout currency', state => { state.session.currency = 'usd' }],
  ['attempt booking identity', state => { state.attempt.booking_id = 'foreign-booking' }],
  ['attempt stored Session identity', state => { state.attempt.stripe_checkout_session_id = 'cs_foreign' }],
  ['attempt stored Intent identity', state => { state.attempt.stripe_payment_intent_id = 'pi_foreign' }],
  ['Intent attempt metadata', state => { state.intent.metadata.payment_attempt_id = nextAttemptId }],
  ['Intent destination snapshot', state => { state.intent.transfer_data = { destination: 'acct_foreign' } }],
  ['Intent fee snapshot', state => { state.intent.application_fee_amount = 50 }],
  ['Charge buyer metadata', state => { state.charge.metadata.buyer_id = 'foreign-buyer' }],
  ['Charge captured amount', state => { state.charge.amount_captured = 400 }],
  ['Charge currency', state => { state.charge.currency = 'usd' }],
  ['Charge dispute', state => { state.charge.disputed = true }],
]) {
  test(`mismatched ${description} cannot fulfill or refund an unrelated payment`, async () => {
    const state = fixture(); state.paid(); change(state)
    assert.equal((await state.run('checkout.session.completed')).status, 500)
    assert.equal(state.observations.length, 0)
    assert.equal(state.confirmations(), 0)
    assert.equal(state.reconciliations.length, 0)
  })
}

test('legacy Checkout registers only the exact existing stored Session without broad backfill', async () => {
  const state = fixture({ legacy: true }); state.attempts.clear(); state.paid()
  assert.equal((await state.run('checkout.session.completed')).status, 200)
  assert.equal(state.confirmations(), 1)
  assert.equal(state.legacyRegistrations.length, 1)
  const foreign = fixture({ legacy: true, bookingChanges: { stripe_checkout_session_id: 'cs_other' } }); foreign.paid()
  foreign.attempts.clear()
  assert.equal((await foreign.run('checkout.session.completed')).status, 500)
  assert.equal(foreign.observations.length, 0)
})

test('a recorded legacy delayed success can fulfill the original booking after retry replaces its current Session', async () => {
  const state = fixture({ legacy: true, bookingChanges: { stripe_checkout_session_id: 'cs_retry', current_payment_attempt_id: nextAttemptId } }); state.paid()
  assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 200)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.booking.fulfilled_payment_attempt_id, attemptId)
  assert.equal(state.confirmations(), 1)
  assert.equal(state.legacyRegistrations.length, 0)
})

test('a recorded legacy delayed success is reconciled independently when a retry already fulfilled the booking', async () => {
  const state = fixture({ legacy: true, bookingChanges: {
    stripe_checkout_session_id: 'cs_retry', current_payment_attempt_id: nextAttemptId,
    fulfilled_payment_attempt_id: nextAttemptId, status: 'confirmed', payment_status: 'paid',
  } }); state.paid()
  assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 200)
  assert.deepEqual(state.reconciliations, [attemptId])
  assert.equal(state.booking.fulfilled_payment_attempt_id, nextAttemptId)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmations(), 0)
})

for (const field of ['booking_id', 'buyer_id', 'creator_id', 'legacy_checkout']) {
  test(`a legacy Session cannot reuse a recorded attempt with the wrong ${field}`, async () => {
    const state = fixture({ legacy: true, bookingChanges: { stripe_checkout_session_id: 'cs_retry', current_payment_attempt_id: nextAttemptId } }); state.paid()
    state.attempt[field] = field === 'legacy_checkout' ? false : 'foreign-identity'
    assert.equal((await state.run('checkout.session.async_payment_succeeded')).status, 500)
    assert.equal(state.observations.length, 0)
    assert.equal(state.reconciliations.length, 0)
    assert.equal(state.confirmations(), 0)
  })
}

test('timeout polling verifies provider expiration and never releases a processing payment', async () => {
  const expired = fixture(); expired.session.status = 'expired'
  assert.equal((await expired.timeouts()).released, 1)
  assert.equal(expired.booking.status, 'expired')
  const processing = fixture(); processing.session.status = 'complete'; processing.intent.status = 'processing'
  assert.equal((await processing.timeouts()).released, 0)
  assert.equal(processing.booking.status, 'pending_payment')
})

test('timeout polling recovers successful payment and records missing checkout identity as unresolved', async () => {
  const paid = fixture(); paid.paid()
  assert.equal((await paid.timeouts()).confirmed, 1)
  assert.equal(paid.booking.status, 'confirmed')
  const missing = fixture({ bookingChanges: { stripe_checkout_session_id: null } })
  assert.equal((await missing.timeouts()).unresolved, 1)
  assert.equal(missing.providerReads.length, 0)
  assert.equal(missing.recoveries.length, 1)
})

test('timeout polling recovers a Checkout created before process interruption using only its durable attempt', async () => {
  const state = fixture({ bookingChanges: { stripe_checkout_session_id: null } })
  state.recoverSession(state.session.id); state.session.status = 'expired'
  const result = await state.timeouts()
  assert.equal(result.released, 1)
  assert.equal(result.failed, 0)
  assert.equal(state.recoveries[0].attemptId, attemptId)
  assert.equal(state.recoveries[0].bookingId, bookingId)
})

test('timeout provider failure preserves the hold and reports a retryable failure count without private data', async () => {
  const state = fixture(); state.failProvider()
  const result = await state.timeouts()
  assert.equal(result.failed, 1)
  assert.equal(result.released, 0)
  assert.equal(state.booking.status, 'pending_payment')
  assert.deepEqual(state.logs, [['[coaching-reservation] reconciliation failed', 'api_connection_error']])
})

test('timeout creation discovery failure preserves the hold rather than claiming no provider payment exists', async () => {
  const state = fixture({ bookingChanges: { stripe_checkout_session_id: null } })
  state.failRecovery({ code: 'api_connection_error', message: 'private-provider-data' })
  const result = await state.timeouts()
  assert.equal(result.failed, 1)
  assert.equal(result.released, 0)
  assert.equal(state.booking.status, 'pending_payment')
})
