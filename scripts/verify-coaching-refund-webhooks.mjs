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

function fixture({ booking: changes = {}, reconciliationFailure = false, chargeRefunded = true,
  captureMetadata = { checkout_type: 'coaching_session' }, chargeReadFailure = false } = {}) {
  const booking = {
    id: 'booking-synthetic', buyer_id: 'buyer-synthetic', creator_id: 'creator-synthetic',
    status: 'cancelled', payment_status: 'paid', refund_status: 'pending',
    stripe_payment_intent_id: 'pi_synthetic', stripe_livemode: false, price_cents: 4100,
    ...changes,
  }
  const ledger = new Set()
  const writes = []
  const reconciliations = []
  const retrievedCharges = []
  let confirmed = 0
  let event
  let failReconciliation = reconciliationFailure
  let failChargeRead = chargeReadFailure
  const service = {
    from(table) {
      assert.ok(['bookings', 'stripe_webhook_events', 'purchases'].includes(table))
      let action = 'select'
      let update
      const filters = {}
      const matches = row => Object.entries(filters).every(([key, value]) => row[key] === value)
      const execute = () => {
        if (table === 'stripe_webhook_events') {
          if (action === 'delete') ledger.delete(filters.event_id)
          return { data: null, error: null }
        }
        if (table === 'purchases') return { data: [], error: null }
        const rows = matches(booking) ? [booking] : []
        if (action === 'update' && rows.length) {
          writes.push({ ...update })
          Object.assign(booking, update)
        }
        return { data: rows, error: null }
      }
      return {
        select() { return this }, eq(key, value) { filters[key] = value; return this },
        update(row) { action = 'update'; update = row; return this },
        delete() { action = 'delete'; return this },
        async insert(row) {
          assert.equal(table, 'stripe_webhook_events')
          if (ledger.has(row.event_id)) return { error: { code: '23505' } }
          ledger.add(row.event_id)
          return { error: null }
        },
        async single() { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null } },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) },
      }
    },
  }
  const overrides = {
    '@/lib/stripe/server': { stripe: {
      webhooks: { constructEvent: () => event },
      charges: { retrieve: async id => {
        retrievedCharges.push(id)
        if (failChargeRead) { failChargeRead = false; throw new Error('Synthetic charge retrieval outage') }
        return { id, metadata: captureMetadata, payment_intent: 'pi_synthetic', refunded: chargeRefunded, amount_refunded: chargeRefunded ? 4100 : 0 }
      } },
      refunds: { create() { throw new Error('Webhook route must never directly create a refund') } },
    } },
    '@/lib/supabase/server': { createServiceClient: async () => service },
    '@/lib/coaching-refund': { reconcileCoachingRefund: async input => {
      assert.equal(input.service, service)
      reconciliations.push({ paymentIntentId: input.paymentIntentId, stripeLivemode: input.stripeLivemode,
        ...(input.resumeCapture !== undefined ? { resumeCapture: input.resumeCapture } : {}) })
      if (failReconciliation) { failReconciliation = false; throw new Error('Synthetic provider outage') }
      // The actual provider/RPC reconciler has its own regression tests. This
      // boundary spy intentionally makes no booking writes from event data. The
      // explicit resumeCapture path is permitted only by the actual reconciler's
      // durable pending-capture cancellation checks, never by the event itself.
      return { refundStatus: 'pending' }
    } },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking: async id => {
      assert.equal(id, booking.id); confirmed += 1
    } },
    '@/lib/email/send': { sendPurchaseReceipt() { throw new Error('Unexpected receipt') }, sendNewSubscriberNotification() { throw new Error('Unexpected email') } },
    '@/lib/notifications': { createNotification() { throw new Error('Unexpected notification') } },
  }
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', 'console', compiled)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule, { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic' } }, { error() {} },
  )
  return {
    booking, ledger, writes, reconciliations, retrievedCharges,
    confirmed: () => confirmed,
    run(type, object, id = `evt_${type}`) {
      event = { id, type, livemode: false, data: { object } }
      return loadedModule.exports.POST({ text: async () => '{}', headers: new Headers({ 'stripe-signature': 'synthetic' }) })
    },
  }
}

test('every refund lifecycle notification delegates fresh reconciliation without writing payload status', async () => {
  const state = fixture()
  for (const type of ['refund.created', 'refund.updated', 'refund.failed', 'charge.refunded']) {
    const object = type === 'charge.refunded'
      ? { id: 'ch_synthetic', payment_intent: 'pi_synthetic', refunded: true, amount_refunded: 4100 }
      : { id: 're_synthetic', payment_intent: 'pi_synthetic', status: type === 'refund.failed' ? 'failed' : 'succeeded' }
    assert.equal((await state.run(type, object)).status, 200)
  }
  assert.deepEqual(state.reconciliations, Array(4).fill({ paymentIntentId: 'pi_synthetic', stripeLivemode: false }))
  assert.deepEqual(state.writes, [])
  assert.equal(state.booking.status, 'cancelled')
  assert.equal(state.booking.payment_status, 'paid')
  assert.equal(state.booking.refund_status, 'pending')
})

test('same-event webhook retries perform no additional reconciliation or refund', async () => {
  const state = fixture()
  const object = { id: 're_synthetic', payment_intent: 'pi_synthetic', status: 'pending' }
  assert.equal((await state.run('refund.created', object, 'evt_same')).status, 200)
  const retry = await state.run('refund.created', object, 'evt_same')
  assert.equal(retry.status, 200)
  assert.equal((await retry.json()).duplicate, true)
  assert.equal(state.reconciliations.length, 1)
  assert.deepEqual(state.writes, [])
})

test('provider failure releases the event for retry and never falsely marks a refund succeeded', async () => {
  const state = fixture({ reconciliationFailure: true })
  const object = { id: 're_synthetic', payment_intent: 'pi_synthetic', status: 'succeeded' }
  assert.equal((await state.run('refund.updated', object, 'evt_retry')).status, 500)
  assert.equal(state.ledger.has('evt_retry'), false)
  assert.equal(state.booking.refund_status, 'pending')
  assert.equal(state.booking.payment_status, 'paid')
  assert.equal((await state.run('refund.updated', object, 'evt_retry')).status, 200)
  assert.equal(state.ledger.has('evt_retry'), true)
  assert.equal(state.reconciliations.length, 2)
  assert.deepEqual(state.writes, [])
})

test('a refund notification without a payment intent resolves its charge before reconciliation', async () => {
  const state = fixture()
  assert.equal((await state.run('refund.failed', { id: 're_synthetic', charge: 'ch_synthetic' })).status, 200)
  assert.deepEqual(state.retrievedCharges, ['ch_synthetic'])
  assert.deepEqual(state.reconciliations, [{ paymentIntentId: 'pi_synthetic', stripeLivemode: false }])
})

test('coaching payment confirmation snapshots the actual paid checkout amount once', async () => {
  const state = fixture({ booking: { status: 'pending_payment', payment_status: 'pending', refund_status: 'not_requested' } })
  const session = {
    id: 'cs_synthetic', mode: 'payment', payment_status: 'paid', currency: 'eur', amount_total: 4100,
    payment_intent: 'pi_synthetic',
    metadata: { checkout_type: 'coaching_session', booking_id: 'booking-synthetic', buyer_id: 'buyer-synthetic', creator_id: 'creator-synthetic' },
  }
  assert.equal((await state.run('checkout.session.completed', session, 'evt_paid')).status, 200)
  assert.equal(state.booking.amount_paid_cents, 4100)
  assert.equal(state.booking.status, 'confirmed')
  assert.equal(state.confirmed(), 1)
  assert.equal((await state.run('checkout.session.completed', session, 'evt_paid_repeat')).status, 200)
  assert.equal(state.writes.length, 1)
  assert.equal(state.confirmed(), 1)
})

test('a stale canceled intent cannot overwrite a paid or refunded booking', async () => {
  for (const payment_status of ['paid', 'partially_refunded', 'refunded']) {
    const state = fixture({ booking: { payment_status } })
    assert.equal((await state.run('payment_intent.canceled', { id: 'pi_synthetic' })).status, 200)
    assert.deepEqual(state.writes, [])
    assert.equal(state.booking.payment_status, payment_status)
    assert.equal(state.booking.status, 'cancelled')
  }
})

test('refund and chargeback notifications cannot resurrect or replace cancelled booking status', async () => {
  const state = fixture({ booking: { payment_status: 'disputed' } })
  assert.equal((await state.run('charge.dispute.closed', { payment_intent: 'pi_synthetic', status: 'lost' })).status, 200)
  assert.equal(state.booking.payment_status, 'chargeback')
  assert.equal(state.booking.status, 'cancelled')
})

test('dispute restoration uses fresh charge refund state instead of restoring paid entitlement', async () => {
  const state = fixture({ booking: { payment_status: 'disputed' } })
  assert.equal((await state.run('charge.dispute.closed', { payment_intent: 'pi_synthetic', status: 'won', charge: 'ch_synthetic' })).status, 200)
  assert.deepEqual(state.retrievedCharges, ['ch_synthetic'])
  assert.equal(state.reconciliations.length, 1)
  assert.deepEqual(state.writes, [])
})

test('a won dispute cannot restore paid entitlement over pending, failed, or successful cancellation refunds', async () => {
  for (const refund_status of ['pending', 'succeeded', 'failed', 'not_requested']) {
    const state = fixture({ booking: { payment_status: 'disputed', refund_status }, chargeRefunded: false })
    assert.equal((await state.run('charge.dispute.closed', { payment_intent: 'pi_synthetic', status: 'won', charge: 'ch_synthetic' })).status, 200)
    assert.deepEqual(state.writes, [])
    assert.equal(state.booking.status, 'cancelled')
    assert.equal(state.booking.payment_status, 'disputed')
  }
  const active = fixture({ booking: { status: 'confirmed', payment_status: 'disputed', refund_status: 'not_requested' }, chargeRefunded: false })
  assert.equal((await active.run('charge.dispute.closed', { payment_intent: 'pi_synthetic', status: 'won', charge: 'ch_synthetic' })).status, 200)
  assert.equal(active.booking.payment_status, 'paid')
  assert.equal(active.booking.status, 'confirmed')
})

test('a malformed won-dispute event without a current charge cannot restore paid entitlement', async () => {
  const state = fixture({ booking: { status: 'confirmed', payment_status: 'disputed', refund_status: 'not_requested' } })
  assert.equal((await state.run('charge.dispute.closed', { payment_intent: 'pi_synthetic', status: 'won' })).status, 500)
  assert.deepEqual(state.writes, [])
  assert.equal(state.booking.payment_status, 'disputed')
})

function captureEvent(type, metadata = { checkout_type: 'coaching_session', booking_id: 'booking-synthetic' }) {
  if (type === 'charge.updated') return { id: 'ch_capture', payment_intent: 'pi_synthetic', metadata }
  if (type === 'transfer.created') return { id: 'tr_capture', source_transaction: 'ch_capture' }
  return { id: 'fee_capture', originating_transaction: 'ch_capture' }
}

for (const type of ['charge.updated', 'transfer.created', 'application_fee.created']) {
  test(`${type} resumes the trusted pending-capture path without writes from event data`, async () => {
    const state = fixture()
    assert.equal((await state.run(type, captureEvent(type))).status, 200)
    assert.deepEqual(state.reconciliations, [{ paymentIntentId: 'pi_synthetic', stripeLivemode: false, resumeCapture: true }])
    assert.deepEqual(state.retrievedCharges, type === 'charge.updated' ? [] : ['ch_capture'])
    assert.deepEqual(state.writes, [])
    assert.equal(state.booking.status, 'cancelled')
    assert.equal(state.booking.payment_status, 'paid')
  })

  test(`${type} repeated deliveries resume once and use the existing claim`, async () => {
    const state = fixture()
    const object = captureEvent(type)
    assert.equal((await state.run(type, object, 'evt_capture_repeat')).status, 200)
    const replay = await state.run(type, object, 'evt_capture_repeat')
    assert.equal(replay.status, 200)
    assert.equal((await replay.json()).duplicate, true)
    assert.equal(state.reconciliations.length, 1)
    assert.deepEqual(state.writes, [])
  })

  test(`${type} reconciliation failure releases the event and retries safely`, async () => {
    const state = fixture({ reconciliationFailure: true })
    const object = captureEvent(type)
    assert.equal((await state.run(type, object, 'evt_capture_retry')).status, 500)
    assert.equal(state.ledger.has('evt_capture_retry'), false)
    assert.equal((await state.run(type, object, 'evt_capture_retry')).status, 200)
    assert.equal(state.reconciliations.length, 2)
    assert.equal(state.reconciliations.every(call => call.resumeCapture === true), true)
    assert.deepEqual(state.writes, [])
  })

  test(`${type} ignores unrelated purchases and payments without coaching metadata`, async () => {
    for (const metadata of [{}, { checkout_type: 'product_purchase' }]) {
      const state = fixture({ captureMetadata: metadata })
      assert.equal((await state.run(type, captureEvent(type, metadata))).status, 200)
      assert.deepEqual(state.reconciliations, [])
      assert.deepEqual(state.writes, [])
    }
  })
}

test('capture continuation resolves expanded charge and payment references safely', async () => {
  const transfer = fixture()
  assert.equal((await transfer.run('transfer.created', { id: 'tr_capture', source_transaction: { id: 'ch_capture' } })).status, 200)
  assert.deepEqual(transfer.retrievedCharges, ['ch_capture'])
  const fee = fixture()
  assert.equal((await fee.run('application_fee.created', { id: 'fee_capture', originating_transaction: { id: 'ch_capture' } })).status, 200)
  assert.deepEqual(fee.retrievedCharges, ['ch_capture'])
  const charge = fixture()
  assert.equal((await charge.run('charge.updated', { id: 'ch_capture', payment_intent: { id: 'pi_synthetic' }, metadata: { checkout_type: 'coaching_session' } })).status, 200)
  assert.deepEqual(charge.reconciliations, [{ paymentIntentId: 'pi_synthetic', stripeLivemode: false, resumeCapture: true }])
})

test('capture events with no attributable charge or payment cannot resume cancellation', async () => {
  for (const [type, object] of [
    ['transfer.created', { id: 'tr_other', source_transaction: null }],
    ['application_fee.created', { id: 'fee_other', originating_transaction: null }],
    ['charge.updated', { id: 'ch_other', payment_intent: null, metadata: { checkout_type: 'coaching_session' } }],
  ]) {
    const state = fixture()
    assert.equal((await state.run(type, object)).status, 200)
    assert.deepEqual(state.reconciliations, [])
    assert.deepEqual(state.writes, [])
  }
})

test('capture source-charge retrieval errors release event claim rather than swallow failures', async () => {
  for (const type of ['transfer.created', 'application_fee.created']) {
    const state = fixture({ chargeReadFailure: true })
    const object = captureEvent(type)
    assert.equal((await state.run(type, object, 'evt_capture_read_retry')).status, 500)
    assert.equal(state.ledger.has('evt_capture_read_retry'), false)
    assert.deepEqual(state.reconciliations, [])
    assert.equal((await state.run(type, object, 'evt_capture_read_retry')).status, 200)
    assert.equal(state.reconciliations.length, 1)
  }
})
