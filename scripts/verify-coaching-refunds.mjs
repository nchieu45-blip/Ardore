import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/coaching-refund.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function fixture(options = {}) {
  const metadata = { checkout_type: 'coaching_session', booking_id: 'synthetic-booking', buyer_id: 'synthetic-buyer', creator_id: 'synthetic-creator' }
  const booking = { id: metadata.booking_id, buyer_id: metadata.buyer_id, creator_id: metadata.creator_id,
    price_cents: 4500, amount_paid_cents: 4500, stripe_payment_intent_id: 'pi_synthetic', stripe_livemode: false,
    status: 'cancelled', payment_status: 'paid', amount_refunded_cents: 0 }
  let request = options.noRequest ? null : { booking_id: booking.id, actor_user_id: 'synthetic-buyer', actor_role: options.actor ?? 'buyer',
    state: 'pending', amount_cents: null, stripe_refund_id: null, stripe_payment_intent_id: booking.stripe_payment_intent_id }
  const intent = { id: booking.stripe_payment_intent_id, latest_charge: 'ch_synthetic', status: 'succeeded', metadata,
    livemode: false, currency: 'eur', amount_received: 4500, transfer_data: options.destination ? { destination: 'acct_synthetic' } : null }
  const charge = { id: 'ch_synthetic', payment_intent: intent.id, amount: 4500, amount_captured: 4500, amount_refunded: 0,
    metadata, currency: 'eur', livemode: false, paid: true, captured: true, disputed: false,
    balance_transaction: 'txn_payment', transfer: options.destination ? 'tr_synthetic' : null,
    transfer_data: intent.transfer_data, application_fee: options.destination ? 'fee_synthetic' : null,
    transfer_group: null, source_transfer: null }
  const transfer = { id: 'tr_synthetic', amount: 4500, amount_reversed: 0, source_transaction: charge.id,
    destination: 'acct_synthetic', currency: 'eur', livemode: false }
  const applicationFee = { id: 'fee_synthetic', originating_transaction: charge.id, account: 'acct_synthetic',
    amount: 450, amount_refunded: 0, currency: 'eur', livemode: false, refunds: { data: [] } }
  const refunds = []
  const posts = []
  const rpcCalls = []
  let createFailure = options.createFailure
  let refundStatus = options.refundStatus ?? 'succeeded'

  function addRefund(amount, status = 'succeeded', own = false) {
    const refund = { id: `re_synthetic_${refunds.length + 1}`, charge: charge.id, payment_intent: intent.id, amount,
      currency: 'eur', status, metadata: own ? { booking_id: booking.id, ardore_refund_key: `ardore-booking-refund-${booking.id}-v1` } : {},
      transfer_reversal: options.destination ? `trr_synthetic_${refunds.length + 1}` : null,
      balance_transaction: 'txn_refund' }
    refunds.push(refund)
    charge.amount_refunded = refunds.filter(item => item.status === 'succeeded').reduce((sum, item) => sum + item.amount, 0)
    if (options.destination && !['failed', 'canceled'].includes(status)) {
      transfer.amount_reversed += amount
      applicationFee.amount_refunded += amount / 10
      applicationFee.refunds.data.push({ id: `fr_synthetic_${refunds.length}` })
    }
    return refund
  }
  const database = {
    from(table) {
      const query = { select() { return this }, eq() { return this }, async maybeSingle() {
        assert.ok(['bookings', 'booking_refunds'].includes(table))
        return { data: structuredClone(table === 'bookings' ? booking : request), error: null }
      } }
      return query
    },
    async rpc(name, parameters) {
      assert.equal(name, 'apply_coaching_refund_state')
      rpcCalls.push(structuredClone(parameters))
      if (parameters.p_state && request) {
        if (request.amount_cents !== null && parameters.p_state.amount_cents !== undefined
          && parameters.p_state.amount_cents !== null && request.amount_cents !== parameters.p_state.amount_cents) {
          return { error: { code: 'refund_amount_immutable' } }
        }
        request = { ...request, ...parameters.p_state }
      }
      if (parameters.p_payment_status) booking.payment_status = parameters.p_payment_status
      if (parameters.p_amount_refunded_cents !== null) booking.amount_refunded_cents = parameters.p_amount_refunded_cents
      if (parameters.p_amount_paid_cents !== null) booking.amount_paid_cents = parameters.p_amount_paid_cents
      return { data: { booking: structuredClone(booking), refund: structuredClone(request), applied: true }, error: null }
    },
  }
  const fakeStripe = {
    paymentIntents: { retrieve: async id => { assert.equal(id, intent.id); return structuredClone(intent) } },
    charges: { retrieve: async id => { assert.equal(id, charge.id); return structuredClone(charge) } },
    refunds: {
      list: parameters => { assert.equal(parameters.charge, charge.id); return { autoPagingToArray: async () => structuredClone(refunds) } },
      create: async (parameters, requestOptions) => {
        posts.push(structuredClone({ parameters, requestOptions }))
        if (createFailure === 'before') throw { code: 'balance_insufficient', message: 'Private provider account details' }
        const result = addRefund(parameters.amount, refundStatus, true)
        if (createFailure === 'after') throw { code: 'api_connection_error' }
        return structuredClone(result)
      },
    },
    transfers: { retrieve: async id => { assert.equal(id, transfer.id); return structuredClone(transfer) } },
    applicationFees: { retrieve: async id => { assert.equal(id, applicationFee.id); return structuredClone(applicationFee) } },
    balanceTransactions: { retrieve: async id => {
      if (options.feeReadFailure) throw new Error('Balance temporarily unavailable')
      return { currency: 'eur', fee_details: [{ type: 'stripe_fee', amount: id === 'txn_payment' ? 193 : 0 },
        { type: 'application_fee', amount: id === 'txn_payment' ? 450 : 0 }] }
    } },
  }
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(name => {
    assert.equal(name, '@/lib/stripe/server')
    return { stripe: fakeStripe }
  }, loadedModule.exports, loadedModule, { env: { STRIPE_SECRET_KEY: options.liveKey ? 'sk_live_synthetic' : 'sk_test_synthetic' } })
  return { booking, intent, charge, transfer, applicationFee, refunds, posts, rpcCalls, addRefund,
    request: () => request,
    setFailure: value => { createFailure = value }, setStatus: value => { refundStatus = value },
    process: () => loadedModule.exports.processCoachingRefund({ service: database, booking: structuredClone(booking), request: structuredClone(request) }),
    reconcile: (options = {}) => loadedModule.exports.reconcileCoachingRefund({ service: database, paymentIntentId: intent.id, stripeLivemode: false,
      resumeCapture: options.resumeCapture ?? false }) }
}

test('eligible customer receives every actually paid cent; fees never reduce refund', async () => {
  const f = fixture()
  const result = await f.process()
  assert.equal(result.state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.booking.payment_status, 'refunded')
  assert.equal(f.booking.amount_refunded_cents, 4500)
  assert.equal(f.booking.status, 'cancelled')
  assert.equal(f.request().processing_fee_cents, 193)
  assert.equal(f.request().processing_fee_cost_owner, 'platform')
  assert.equal(f.request().processing_fee_accounting_status, 'recorded')
})

test('coach-initiated cancellation records processing cost owner without changing customer refund', async () => {
  const f = fixture({ actor: 'creator' })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.request().processing_fee_cost_owner, 'coach')
})

test('repeated cancellations and webhook retries never POST another refund', async () => {
  const f = fixture()
  await f.process()
  await f.process()
  await f.reconcile()
  await f.reconcile()
  assert.equal(f.posts.length, 1)
  assert.equal(f.refunds.length, 1)
  assert.equal(f.posts[0].requestOptions.idempotencyKey, 'ardore-booking-refund-synthetic-booking-v1')
  assert.equal(f.request().stripe_refund_id, f.refunds[0].id)
})

test('metadata discovers accepted refund even after missing DB response and Stripe key expiry', async () => {
  const f = fixture()
  f.addRefund(4500, 'succeeded', true)
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts.length, 0)
})

test('pending refunds remain pending and payment is not falsely marked refunded', async () => {
  const f = fixture({ refundStatus: 'pending' })
  assert.equal((await f.process()).state, 'pending')
  assert.equal(f.booking.payment_status, 'paid')
  assert.equal(f.booking.amount_refunded_cents, 0)
  await f.process()
  assert.equal(f.posts.length, 1)
  f.refunds[0].status = 'succeeded'
  assert.equal((await f.reconcile()).state, 'succeeded')
  assert.equal(f.booking.payment_status, 'refunded')
})

test('failed Stripe API request records failure and a retry uses identical immutable parameters/key', async () => {
  const f = fixture({ createFailure: 'before' })
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.booking.payment_status, 'paid')
  assert.equal(f.request().last_error_code, 'balance_insufficient')
  assert.equal(f.request().amount_cents, 4500)
  assert.equal(f.refunds.length, 0)
  f.setFailure(null)
  assert.equal((await f.process()).state, 'succeeded')
  assert.deepEqual(f.posts[0], f.posts[1])
  assert.equal(f.refunds.length, 1)
})

test('timeout after successful refund reconciles it instead of declaring failure or refunding twice', async () => {
  const f = fixture({ createFailure: 'after' })
  assert.equal((await f.process()).state, 'succeeded')
  await f.process()
  assert.equal(f.posts.length, 1)
})

test('bank failed refund keeps original ID and never automatically creates a replacement', async () => {
  const f = fixture({ refundStatus: 'failed' })
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.booking.payment_status, 'paid')
  await f.process()
  await f.reconcile()
  assert.equal(f.posts.length, 1)
  assert.equal(f.request().stripe_refund_id, f.refunds[0].id)
})

test('destination refund atomically reverses only booking transfer and refunds application fee', async () => {
  const f = fixture({ destination: true })
  const result = await f.process()
  assert.equal(result.state, 'succeeded')
  assert.equal(result.transferStatus, 'succeeded')
  assert.equal(f.posts[0].parameters.reverse_transfer, true)
  assert.equal(f.posts[0].parameters.refund_application_fee, true)
  assert.equal(f.transfer.amount_reversed, 4500)
  assert.equal(f.applicationFee.amount_refunded, 450)
  assert.deepEqual(f.request().transfer_reversal_ids, ['trr_synthetic_1'])
  assert.deepEqual(f.request().application_fee_refund_ids, ['fr_synthetic_1'])
  await f.process()
  assert.equal(f.transfer.amount_reversed, f.transfer.amount)
})

test('a previous partial refund is deducted so total customer refund cannot exceed actual payment', async () => {
  const f = fixture({ destination: true })
  f.addRefund(1000)
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 3500)
  assert.equal(f.booking.amount_refunded_cents, 4500)
  assert.equal(f.transfer.amount_reversed, 4500)
})

test('unreconciled previous coach transfer blocks any further refund', async () => {
  const f = fixture({ destination: true })
  f.addRefund(1000)
  f.transfer.amount_reversed = 0
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.posts.length, 0)
  assert.equal(f.request().last_error_code, 'transfer_reconciliation_required')
})

test('pending external refund is reserved and cannot trigger another automatic refund', async () => {
  const f = fixture()
  f.addRefund(4500, 'pending')
  assert.equal((await f.process()).state, 'pending')
  assert.equal(f.posts.length, 0)
})

test('external refunds update entitlement payment status without manufacturing a cancellation ledger', async () => {
  const f = fixture({ noRequest: true })
  f.booking.status = 'completed'
  f.addRefund(4500)
  assert.equal((await f.reconcile()).state, 'succeeded')
  assert.equal(f.booking.payment_status, 'refunded')
  assert.equal(f.request(), null)
  assert.equal(f.posts.length, 0)
})

test('unknown processing fees stay pending and do not withhold successful customer refund', async () => {
  const f = fixture({ feeReadFailure: true })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.request().processing_fee_cents, null)
  assert.equal(f.request().processing_fee_accounting_status, 'pending')
})

for (const [name, mutate] of [
  ['different buyer', f => { f.intent.metadata = { ...f.intent.metadata, buyer_id: 'different' } }],
  ['different booking charge', f => { f.charge.metadata = { ...f.charge.metadata, booking_id: 'different' } }],
  ['wrong currency', f => { f.charge.currency = 'usd' }],
  ['more paid than booked', f => { f.charge.amount_captured = 5000; f.intent.amount_received = 5000 }],
  ['disputed charge', f => { f.charge.disputed = true }],
  ['wrong transfer owner', f => { f.transfer.source_transaction = 'ch_different' }],
  ['unknown separate-transfer architecture', f => {
    f.charge.transfer = null; f.charge.transfer_data = null; f.intent.transfer_data = null
    f.charge.application_fee = null; f.charge.transfer_group = 'unknown-group'
  }],
]) {
  test(`fails closed for ${name}`, async () => {
    const f = fixture({ destination: true })
    mutate(f)
    assert.equal((await f.process()).state, 'failed')
    assert.equal(f.posts.length, 0)
    assert.equal(f.booking.payment_status, 'paid')
  })
}

test('test-mode booking cannot be refunded with a live-mode key', async () => {
  const f = fixture({ liveKey: true })
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.posts.length, 0)
})

test('completed bookings cannot enter helper without an atomic cancellation claim', async () => {
  const f = fixture()
  f.booking.status = 'completed'
  await assert.rejects(f.process(), /unclaimed_refund_request/)
  assert.equal(f.posts.length, 0)
})

test('changed remaining amount after frozen attempt requires reconciliation, never a different refund', async () => {
  const f = fixture({ createFailure: 'before' })
  await f.process()
  f.addRefund(500)
  f.setFailure(null)
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.posts.length, 1)
  assert.equal(f.booking.amount_refunded_cents, 500)
})

test('destination charge can have an automatically assigned transfer group', async () => {
  const f = fixture({ destination: true })
  f.charge.transfer_group = 'group_pi_synthetic'
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.reverse_transfer, true)
})

test('missing stored refund ID fails closed rather than generating a replacement refund', async () => {
  const f = fixture()
  f.request().stripe_refund_id = 're_missing'
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.posts.length, 0)
  assert.equal(f.request().last_error_code, 'stored_refund_not_found')
})

function asyncDestinationFixture({ missingTransfer = true, missingFee = true } = {}) {
  const f = fixture({ destination: true })
  f.intent.capture_method = 'automatic_async'
  f.intent.application_fee_amount = 450
  if (missingTransfer) f.charge.transfer = null
  if (missingFee) f.charge.application_fee = null
  f.charge.balance_transaction = null
  return f
}

for (const missing of [
  { missingTransfer: true, missingFee: true },
  { missingTransfer: false, missingFee: true },
  { missingTransfer: true, missingFee: false },
]) {
  test(`async Connect capture waits for associated transfer/fee (${JSON.stringify(missing)})`, async () => {
    const f = asyncDestinationFixture(missing)
    assert.equal((await f.process()).state, 'pending')
    assert.equal(f.posts.length, 0)
    assert.equal(f.request().last_error_code, 'payment_capture_pending')
    assert.equal(f.request().transfer_status, 'pending')
    assert.equal(f.booking.payment_status, 'paid')
    assert.equal(f.booking.amount_refunded_cents, 0)
    // A provider webhook may resume only this already authorised claim.
    f.charge.transfer = 'tr_synthetic'
    f.charge.application_fee = 'fee_synthetic'
    f.charge.balance_transaction = 'txn_payment'
    assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
    assert.equal(f.posts.length, 1)
    assert.equal(f.posts[0].parameters.amount, 4500)
    assert.equal(f.posts[0].parameters.reverse_transfer, true)
    assert.equal(f.posts[0].parameters.refund_application_fee, true)
    await f.reconcile({ resumeCapture: true })
    await f.process()
    assert.equal(f.posts.length, 1)
  })
}

test('capture webhook cannot create a refund without a claim or for an uncancelled booking', async () => {
  const unclaimed = fixture({ noRequest: true, destination: true })
  await unclaimed.reconcile({ resumeCapture: true })
  assert.equal(unclaimed.posts.length, 0)
  const confirmed = fixture({ destination: true })
  confirmed.booking.status = 'confirmed'
  confirmed.request().last_error_code = 'payment_capture_pending'
  await confirmed.reconcile({ resumeCapture: true })
  assert.equal(confirmed.posts.length, 0)
})

test('capture webhook never replaces a failed provider refund or retries an unrelated failure', async () => {
  const f = fixture({ destination: true })
  const refund = f.addRefund(4500, 'failed', true)
  f.request().stripe_refund_id = refund.id
  f.request().last_error_code = 'payment_capture_pending'
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'failed')
  assert.equal(f.posts.length, 0)
  const other = fixture({ destination: true })
  other.request().state = 'failed'
  other.request().last_error_code = 'balance_insufficient'
  await other.reconcile({ resumeCapture: true })
  assert.equal(other.posts.length, 0)
})

test('waiting capture events preserve pending claim without a Stripe POST until both objects exist', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'pending')
  assert.equal(f.posts.length, 0)
  assert.equal(f.request().last_error_code, 'payment_capture_pending')
})

test('an async destination capture may have its automatic transfer group before transfer materializes', async () => {
  const f = asyncDestinationFixture()
  f.charge.transfer_group = 'group_pi_synthetic'
  assert.equal((await f.process()).state, 'pending')
  assert.equal(f.posts.length, 0)
  f.charge.transfer = 'tr_synthetic'
  f.charge.application_fee = 'fee_synthetic'
  f.charge.balance_transaction = 'txn_payment'
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  assert.equal(f.posts.length, 1)
})

test('synchronous missing fee/transfer and mismatched async ownership fail closed', async () => {
  const synchronous = fixture({ destination: true })
  synchronous.intent.capture_method = 'automatic'
  synchronous.intent.application_fee_amount = 450
  synchronous.charge.application_fee = null
  assert.equal((await synchronous.process()).state, 'failed')
  assert.equal(synchronous.posts.length, 0)
  const mismatched = asyncDestinationFixture()
  mismatched.intent.transfer_data = { destination: 'acct_foreign' }
  assert.equal((await mismatched.process()).state, 'failed')
  assert.equal(mismatched.posts.length, 0)
})
