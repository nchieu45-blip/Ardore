import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/coaching-refund.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function fixture(options = {}) {
  const metadata = { checkout_type: 'coaching_session', booking_id: 'synthetic-booking', buyer_id: 'synthetic-buyer', creator_id: 'synthetic-creator',
    ...(options.target && !options.target.legacyCheckout ? { payment_attempt_id: options.target.attemptId } : {}),
    ...(options.separate ? { payment_attempt_id: options.target?.attemptId ?? 'synthetic-order', ardore_order_id: options.target?.attemptId ?? 'synthetic-order' } : {}) }
  const claimKey = options.target ? `ardore-coaching-reconciliation-${options.target.attemptId}-v1`
    : 'ardore-booking-refund-synthetic-booking-v1'
  const booking = { id: metadata.booking_id, buyer_id: metadata.buyer_id, creator_id: metadata.creator_id,
    price_cents: 4500, amount_paid_cents: 4500, stripe_payment_intent_id: 'pi_synthetic', stripe_livemode: false,
    status: 'cancelled', payment_status: 'paid', amount_refunded_cents: 0 }
  let request = options.noRequest ? null : { booking_id: booking.id, actor_user_id: 'synthetic-buyer', actor_role: options.actor ?? 'buyer',
    state: 'pending', amount_cents: null, stripe_refund_id: null, stripe_payment_intent_id: booking.stripe_payment_intent_id }
  const intent = { id: booking.stripe_payment_intent_id, latest_charge: 'ch_synthetic', status: 'succeeded', metadata,
    livemode: false, currency: 'eur', amount_received: 4500, transfer_data: options.destination ? { destination: 'acct_synthetic' } : null }
  if (options.separate) intent.transfer_group = `ardore-order-${metadata.ardore_order_id}`
  const charge = { id: 'ch_synthetic', payment_intent: intent.id, amount: 4500, amount_captured: 4500, amount_refunded: 0,
    metadata, currency: 'eur', livemode: false, paid: true, captured: true, disputed: false,
    balance_transaction: 'txn_payment', transfer: options.destination ? 'tr_synthetic' : null,
    transfer_data: intent.transfer_data, application_fee: options.destination ? 'fee_synthetic' : null,
    transfer_group: options.separate ? intent.transfer_group : null, source_transfer: null }
  const transfer = { id: 'tr_synthetic', amount: options.separate ? 4050 : 4500, amount_reversed: 0, source_transaction: charge.id,
    destination: 'acct_synthetic', currency: 'eur', livemode: false }
  const applicationFee = { id: 'fee_synthetic', originating_transaction: charge.id, account: 'acct_synthetic',
    amount: 450, amount_refunded: 0, currency: 'eur', livemode: false, refunds: { data: [] } }
  const refunds = []
  const posts = []
  const rpcCalls = []
  const settlementCalls = []
  const reversalIds = []
  let contextExists = !options.contextMissing
  const settlementContext = options.separate ? { settlementId: 'synthetic-ledger', orderId: metadata.ardore_order_id,
    kind: 'booking', buyerId: booking.buyer_id, creatorId: booking.creator_id, grossCents: 4500, livemode: false,
    reference: { bookingId: booking.id, attemptId: metadata.payment_attempt_id }, accountId: 'acct_synthetic',
    transferGroup: intent.transfer_group } : null
  let createFailure = options.createFailure
  let refundStatus = options.refundStatus ?? 'succeeded'
  let failedProviderReads = 0
  let failedPersistWrites = 0
  let failedPersistState
  let persistWriteError = { code: '08006' }

  function addRefund(amount, status = 'succeeded', own = false) {
    const refund = { id: `re_synthetic_${refunds.length + 1}`, charge: charge.id, payment_intent: intent.id, amount,
      currency: 'eur', status, metadata: own ? { booking_id: booking.id, ardore_refund_key: claimKey } : {},
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
      assert.equal(name, options.target ? 'apply_coaching_attempt_refund_state' : 'apply_coaching_refund_state')
      if (options.target) { assert.equal(parameters.p_attempt_id, options.target.attemptId); assert.equal(parameters.p_booking_id, undefined) }
      rpcCalls.push(structuredClone(parameters))
      if (failedPersistWrites > 0 && (!failedPersistState || parameters.p_state?.state === failedPersistState)) {
        failedPersistWrites -= 1
        return { data: null, error: persistWriteError }
      }
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
    paymentIntents: { retrieve: async id => {
      assert.equal(id, intent.id)
      if (failedProviderReads > 0) {
        failedProviderReads -= 1
        throw { code: 'api_connection_error', type: 'StripeConnectionError' }
      }
      return structuredClone(intent)
    } },
    charges: { retrieve: async id => { assert.equal(id, charge.id); return structuredClone(charge) } },
    refunds: {
      list: parameters => { assert.equal(parameters.charge, charge.id); return { autoPagingToArray: async () => structuredClone(refunds) } },
      create: async (parameters, requestOptions) => {
        if (options.separate && !options.separateNoTransfer) assert.equal(transfer.amount_reversed, transfer.amount, 'Coach funds must be reconciled before customer refund')
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
    if (name === '@/lib/stripe/server') return { stripe: fakeStripe }
    assert.equal(name, '@/lib/stripe/settlement')
    return {
      async getSettlementRefundContext({ service, paymentIntentId }) {
        assert.equal(service, database); assert.equal(paymentIntentId, intent.id)
        if (!contextExists || !settlementContext) return null
        return { ...structuredClone(settlementContext), transferId: options.separateNoTransfer ? null : transfer.id,
          transferAmount: options.separateNoTransfer ? 0 : transfer.amount,
          reversedAmount: options.separateNoTransfer ? 0 : transfer.amount_reversed, reversalIds: [...reversalIds] }
      },
      async recordSuccessfulSettlement({ service, orderId, paymentIntentId }) {
        assert.equal(service, database); assert.equal(orderId, settlementContext?.orderId); assert.equal(paymentIntentId, intent.id)
        settlementCalls.push('record'); contextExists = true
        return { id: 'synthetic-ledger' }
      },
      async prepareSettlementRefund({ service, paymentIntentId, targetRefundedCents, refundKey }) {
        assert.equal(service, database); assert.equal(paymentIntentId, intent.id); assert.equal(refundKey, claimKey)
        assert.equal(targetRefundedCents, 4500)
        settlementCalls.push('prepare')
        if (options.reversalFailure) throw { code: 'settlement_reversal_failed' }
        if (!options.separateNoTransfer && transfer.amount_reversed < transfer.amount) {
          transfer.amount_reversed = transfer.amount; reversalIds.push('trr_separate_synthetic')
        }
        return { settlementId: 'synthetic-ledger' }
      },
      async reconcileSettlementRefund({ service, paymentIntentId }) {
        assert.equal(service, database); assert.equal(paymentIntentId, intent.id)
        settlementCalls.push('reconcile')
        const reserved = refunds.filter(item => !['failed', 'canceled'].includes(item.status ?? '')).reduce((sum, item) => sum + item.amount, 0)
        const expected = Math.floor(transfer.amount * reserved / 4500)
        if (!options.separateNoTransfer && transfer.amount_reversed < expected) {
          transfer.amount_reversed = expected; reversalIds.push(`trr_separate_${reversalIds.length}`)
        }
      },
    }
  }, loadedModule.exports, loadedModule, { env: { STRIPE_SECRET_KEY: options.liveKey ? 'sk_live_synthetic' : 'sk_test_synthetic' } })
  return { booking, intent, charge, transfer, applicationFee, refunds, posts, rpcCalls, addRefund, settlementCalls, settlementContext, reversalIds,
    request: () => request,
    failProviderReads: count => { failedProviderReads = count },
    failPersistWrites: (count, state, error = { code: '08006' }) => {
      failedPersistWrites = count; failedPersistState = state; persistWriteError = error
    },
    setFailure: value => { createFailure = value }, setStatus: value => { refundStatus = value },
    process: () => loadedModule.exports.processCoachingRefund({ service: database, booking: structuredClone(booking), request: structuredClone(request), target: options.target }),
    reconcile: (settings = {}) => options.target
      ? loadedModule.exports.reconcileClaimedCoachingRefund({ service: database, booking: structuredClone(booking),
        request: structuredClone(request), target: options.target, resumeCapture: settings.resumeCapture ?? false })
      : loadedModule.exports.reconcileCoachingRefund({ service: database, paymentIntentId: intent.id, stripeLivemode: false,
        resumeCapture: settings.resumeCapture ?? false }) }
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

test('separate booking refund reverses exact coach net before full customer refund and stores reversal IDs', async () => {
  const f = fixture({ separate: true })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.posts[0].parameters.reverse_transfer, undefined)
  assert.equal(f.posts[0].parameters.refund_application_fee, undefined)
  assert.equal(f.transfer.amount_reversed, 4050)
  assert.deepEqual(f.request().transfer_reversal_ids, ['trr_separate_synthetic'])
  assert.equal(f.request().stripe_transfer_id, 'tr_synthetic')
  assert.equal(f.request().processing_fee_cost_owner, 'platform')
  await f.process(); await f.reconcile(); await f.reconcile()
  assert.equal(f.posts.length, 1); assert.equal(f.reversalIds.length, 1)
})

test('separate coach cancellation retains full customer refund and coach processing-cost accounting', async () => {
  const f = fixture({ separate: true, actor: 'creator' })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.request().processing_fee_cost_owner, 'coach')
  assert.equal(f.transfer.amount_reversed, 4050)
})

test('separate payment that never transferred is blocked from settlement before refunding safely', async () => {
  const f = fixture({ separate: true, separateNoTransfer: true })
  assert.equal((await f.process()).state, 'succeeded')
  assert.ok(f.settlementCalls.includes('prepare'))
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.request().transfer_status, 'not_required')
})

test('failed separate reversal prevents customer refund instead of leaving unreconciled coach funds', async () => {
  const f = fixture({ separate: true, reversalFailure: true })
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.posts.length, 0); assert.equal(f.transfer.amount_reversed, 0)
  assert.equal(f.booking.payment_status, 'paid')
})

test('separate refund Stripe failure can retry without reversing or refunding twice', async () => {
  const f = fixture({ separate: true, createFailure: 'before' })
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.transfer.amount_reversed, 4050); assert.equal(f.reversalIds.length, 1)
  f.setFailure(null)
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.refunds.length, 1); assert.equal(f.reversalIds.length, 1)
  assert.deepEqual(f.posts[0], f.posts[1])
})

test('separate refund subtracts prior partial refund while fully reconciling the coach transfer', async () => {
  const f = fixture({ separate: true }); f.addRefund(1000)
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 3500)
  assert.equal(f.booking.amount_refunded_cents, 4500); assert.equal(f.transfer.amount_reversed, 4050)
})

test('separate external refund webhook reconciles proportional net and full refund without customer refund POST', async () => {
  const f = fixture({ separate: true, noRequest: true }); f.addRefund(1000)
  await f.reconcile()
  assert.equal(f.transfer.amount_reversed, 900); assert.equal(f.booking.payment_status, 'partially_refunded')
  f.addRefund(3500); await f.reconcile(); await f.reconcile()
  assert.equal(f.transfer.amount_reversed, 4050); assert.equal(f.booking.payment_status, 'refunded')
  assert.equal(f.posts.length, 0)
})

test('separate cancellation racing missing payment ledger records only its trusted order before refund', async () => {
  const f = fixture({ separate: true, contextMissing: true })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.settlementCalls.filter(call => call === 'record').length, 1)
  assert.equal(f.posts.length, 1)
})

for (const [name, mutate] of [
  ['buyer', f => { f.settlementContext.buyerId = 'other-buyer' }],
  ['coach', f => { f.settlementContext.creatorId = 'other-coach' }],
  ['booking', f => { f.settlementContext.reference.bookingId = 'other-booking' }],
  ['attempt', f => { f.settlementContext.reference.attemptId = 'other-attempt' }],
  ['mode', f => { f.settlementContext.livemode = true }],
  ['gross', f => { f.settlementContext.grossCents = 5000 }],
  ['Charge group', f => { f.charge.transfer_group = 'unknown-group' }],
  ['Intent fee', f => { f.intent.application_fee_amount = 450 }],
  ['transfer destination', f => { f.transfer.destination = 'acct_other' }],
]) {
  test(`separate private ${name} mismatch fails closed before refund/reversal`, async () => {
    const f = fixture({ separate: true }); mutate(f)
    assert.equal((await f.process()).state, 'failed')
    assert.equal(f.posts.length, 0); assert.equal(f.transfer.amount_reversed, 0)
    assert.equal(f.settlementCalls.includes('prepare'), false)
  })
}

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

test('capture-resume Stripe GET outage preserves the claim and a later event refunds exactly once', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.failProviderReads(2)
  await assert.rejects(f.reconcile({ resumeCapture: true }), error => error.code === 'api_connection_error')
  assert.equal(f.request().state, 'pending')
  assert.equal(f.request().last_error_code, 'payment_capture_pending')
  assert.equal(f.posts.length, 0)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  await f.reconcile({ resumeCapture: true })
  assert.equal(f.posts.length, 1)
})

test('capture-resume freeze outage retains eligibility for a successful event retry', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.failPersistWrites(1, 'pending')
  await assert.rejects(f.reconcile({ resumeCapture: true }), error => error.code === '08006')
  assert.equal(f.request().state, 'pending')
  assert.equal(f.request().last_error_code, 'payment_capture_pending')
  assert.equal(f.posts.length, 0)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  await f.reconcile({ resumeCapture: true })
  assert.equal(f.posts.length, 1)
})

test('capture-resume persist outage after Stripe acceptance retries reconciliation without another refund', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.failPersistWrites(2, 'succeeded')
  await assert.rejects(f.reconcile({ resumeCapture: true }), error => error.code === '08006')
  assert.equal(f.request().state, 'pending')
  assert.equal(f.request().last_error_code, 'payment_capture_pending')
  assert.equal(f.request().amount_cents, 4500)
  assert.equal(f.posts.length, 1)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  await f.reconcile({ resumeCapture: true })
  assert.equal(f.posts.length, 1)
  assert.equal(f.refunds.length, 1)
})

test('capture-resume postgrest-js plain transport failure retries without replacing an accepted refund', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.failPersistWrites(2, 'succeeded', { code: '', message: 'TypeError: fetch failed', details: 'TypeError: fetch failed', hint: '' })
  await assert.rejects(f.reconcile({ resumeCapture: true }), error => error.code === '')
  assert.equal(f.request().state, 'pending')
  assert.equal(f.request().last_error_code, 'payment_capture_pending')
  assert.equal(f.posts.length, 1)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  await f.reconcile({ resumeCapture: true })
  assert.equal(f.posts.length, 1)
  assert.equal(f.refunds.length, 1)
})

test('capture-resume permanent ownership validation still fails closed without a refund', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.charge.metadata = { ...f.charge.metadata, buyer_id: 'different-buyer' }
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'failed')
  assert.equal(f.request().last_error_code, 'payment_ownership_or_state_mismatch')
  assert.equal(f.posts.length, 0)
})

test('capture-resume permanent refund rejection still records failed without automatic replacement', async () => {
  const f = asyncDestinationFixture()
  await f.process()
  f.charge.transfer = 'tr_synthetic'; f.charge.application_fee = 'fee_synthetic'
  f.setFailure('before')
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'failed')
  assert.equal(f.request().last_error_code, 'balance_insufficient')
  assert.equal(f.posts.length, 1)
  assert.equal(f.refunds.length, 0)
  for (let event = 0; event < 2; event++) {
    assert.equal((await f.reconcile({ resumeCapture: true })).state, 'failed')
    assert.equal(f.request().last_error_code, 'balance_insufficient')
    assert.equal(f.request().stripe_refund_id, null)
  }
  assert.equal(f.posts.length, 1)
  assert.equal(f.refunds.length, 0)
  f.setFailure(undefined)
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts.length, 2)
  assert.equal(f.refunds.length, 1)
  assert.equal(f.posts[0].requestOptions.idempotencyKey, f.posts[1].requestOptions.idempotencyKey)
  await f.reconcile({ resumeCapture: true })
  assert.equal(f.posts.length, 2)
  assert.equal(f.refunds.length, 1)
})

test('read-only reconciliation discovers an accepted owned refund despite a prior failed request', async () => {
  const f = fixture({ destination: true })
  f.request().state = 'failed'; f.request().last_error_code = 'stripe_refund_request_failed'
  const refund = f.addRefund(4500, 'succeeded', true)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  assert.equal(f.request().stripe_refund_id, refund.id)
  assert.equal(f.request().last_error_code, null)
  assert.equal(f.posts.length, 0)
})

test('read-only reconciliation preserves full external refund and transfer accounting after request failure', async () => {
  const f = fixture({ destination: true })
  f.request().state = 'failed'; f.request().last_error_code = 'balance_insufficient'
  f.addRefund(4500, 'succeeded', false)
  assert.equal((await f.reconcile({ resumeCapture: true })).state, 'succeeded')
  assert.equal(f.request().last_error_code, null)
  assert.equal(f.request().transfer_status, 'succeeded')
  assert.equal(f.booking.payment_status, 'refunded')
  assert.equal(f.booking.amount_refunded_cents, 4500)
  assert.equal(f.posts.length, 0)
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


test('technical payment reconciliation uses its own durable key and private attempt ledger', async () => {
  const target = { attemptId: '11111111-1111-4111-8111-111111111111' }
  const f = fixture({ target, actor: 'system' })
  assert.equal((await f.process()).state, 'succeeded')
  await f.process(); await f.reconcile(); await f.reconcile()
  assert.equal(f.posts.length, 1); assert.equal(f.refunds.length, 1)
  assert.equal(f.posts[0].requestOptions.idempotencyKey, `ardore-coaching-reconciliation-${target.attemptId}-v1`)
  assert.equal(f.posts[0].parameters.metadata.payment_attempt_id, target.attemptId)
  assert.equal(f.posts[0].parameters.metadata.actor_role, 'system')
  assert.equal(f.posts[0].parameters.reason, undefined)
  assert.equal(f.request().processing_fee_cost_owner, 'platform')
  assert.ok(f.rpcCalls.every(call => call.p_attempt_id === target.attemptId && !call.p_booking_id))
})

test('system reconciliation retains full Connect reversal and fee refund protections', async () => {
  const f = fixture({ target: { attemptId: '22222222-2222-4222-8222-222222222222' }, actor: 'system', destination: true })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts[0].parameters.amount, 4500)
  assert.equal(f.posts[0].parameters.reverse_transfer, true)
  assert.equal(f.posts[0].parameters.refund_application_fee, true)
  assert.equal(f.transfer.amount_reversed, 4500)
  assert.equal(f.applicationFee.amount_refunded, 450)
  assert.equal(f.request().processing_fee_cost_owner, 'platform')
})

test('another checkout attempt cannot be refunded even with the same booking and customer metadata', async () => {
  const target = { attemptId: '33333333-3333-4333-8333-333333333333' }
  const f = fixture({ target, actor: 'system' })
  f.intent.metadata = { ...f.intent.metadata, payment_attempt_id: 'different-attempt' }
  assert.equal((await f.process()).state, 'failed')
  assert.equal(f.request().last_error_code, 'payment_attempt_ownership_mismatch')
  assert.equal(f.posts.length, 0)
})

test('legacy exact-session reconciliation may use original provider metadata without an attempt ID', async () => {
  const f = fixture({ target: { attemptId: '44444444-4444-4444-8444-444444444444', legacyCheckout: true }, actor: 'system' })
  assert.equal((await f.process()).state, 'succeeded')
  assert.equal(f.posts.length, 1)
})
