import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(file, modules, env = {}) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const fixtureModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', code)(
    name => modules[name] ?? require(name), fixtureModule.exports, fixtureModule, { env })
  return fixtureModule.exports
}
function cron({ secret = 'synthetic-cron', recoveryError, dbError, refundStates = [] } = {}) {
  const calls = []
  const attempts = refundStates.map((_, index) => ({ id: `attempt-${index}` }))
  const route = load('../src/app/api/cron/coaching-payments/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/supabase/server': { createServiceClient: async () => ({ from(table) {
      assert.equal(table, 'coaching_payment_attempts')
      return { select(value) { assert.equal(value, 'id'); return this }, eq(key, value) {
        assert.equal(key, 'fulfillment_state'); assert.equal(value, 'reconciliation_pending'); return this
      }, order(key) { assert.equal(key, 'updated_at'); return this }, limit(value) {
        assert.equal(value, 50); return Promise.resolve({ data: attempts, error: dbError })
      } }
    } }) },
    '@/lib/coaching-payment-lifecycle': { reconcileExpiredCoachingReservations: async args => {
      calls.push('timeout'); assert.equal(args.limit, 50)
      if (recoveryError) throw recoveryError
      return { checked: 2, released: 1, confirmed: 1, reconciliation: 0, unresolved: 0 }
    } },
    '@/lib/coaching-payment-reconciliation': { processCoachingPaymentReconciliation: async ({ attemptId }) => {
      calls.push(attemptId)
      const state = refundStates[Number(attemptId.split('-')[1])]
      if (state instanceof Error) throw state
      return { state }
    } },
  }, { CRON_SECRET: secret })
  return { calls, get: value => route.GET({ headers: { get: () => value } }) }
}
test('recovery cron rejects unset and wrong credentials before touching data', async () => {
  for (const [secret, supplied] of [[undefined, 'Bearer undefined'], ['', 'Bearer '], ['synthetic-cron', 'Bearer wrong']]) {
    const f = cron({ secret: secret ?? '' }); assert.equal((await f.get(supplied)).status, 401); assert.deepEqual(f.calls, [])
  }
})
test('cron reconciles expired reservations and bounded independent refund claims', async () => {
  const f = cron({ refundStates: ['succeeded', 'pending'] })
  const result = await f.get('Bearer synthetic-cron'); assert.equal(result.status, 200)
  assert.equal(result.body.reconciled, 1); assert.equal(result.body.pending, 1); assert.equal(result.body.failed, 0)
  assert.deepEqual(f.calls, ['timeout', 'attempt-0', 'attempt-1'])
})
test('failed refund cannot stop recovery of later unrelated attempts', async () => {
  const f = cron({ refundStates: [new Error('DO NOT EXPOSE PROVIDER DETAILS'), 'failed', 'succeeded'] })
  const result = await f.get('Bearer synthetic-cron'); assert.equal(result.status, 503)
  assert.equal(result.body.failed, 2); assert.equal(result.body.reconciled, 1)
  assert.doesNotMatch(JSON.stringify(result), /DO NOT EXPOSE/)
})
test('provider outage fails closed without starting refunds or leaking error details', async () => {
  const f = cron({ recoveryError: new Error('private provider details'), refundStates: ['succeeded'] })
  const result = await f.get('Bearer synthetic-cron'); assert.equal(result.status, 503)
  assert.deepEqual(f.calls, ['timeout']); assert.doesNotMatch(JSON.stringify(result), /private/)
})
test('database outage is explicit and does not run unchecked refund targets', async () => {
  const f = cron({ dbError: new Error('private database details'), refundStates: ['succeeded'] })
  const result = await f.get('Bearer synthetic-cron'); assert.equal(result.status, 503); assert.deepEqual(f.calls, ['timeout'])
})

function reconciliation(changes = {}) {
  const attempt = { id: 'attempt-owned', booking_id: 'booking-owned', buyer_id: 'buyer-owned', creator_id: 'coach-owned',
    price_cents: 500, amount_paid_cents: 500, amount_refunded_cents: 0, stripe_payment_intent_id: 'pi_owned', stripe_livemode: false,
    fulfillment_state: 'reconciliation_pending', reconciliation_reason: 'slot_unavailable', refund_status: 'pending', refund_amount_cents: null,
    refund_idempotency_key: 'ardore-coaching-reconciliation-attempt-owned-v1', stripe_refund_id: null,
    stripe_transfer_id: null, transfer_reversal_ids: [], application_fee_refund_ids: [], transfer_status: 'not_required',
    last_error_code: null, ...changes }
  const calls = []
  const engine = load('../src/lib/coaching-payment-reconciliation.ts', {
    '@/lib/coaching-refund': { processCoachingRefund: async args => { calls.push(args); return { state: 'succeeded' } },
      reconcileClaimedCoachingRefund: async args => { calls.push(args); return { state: 'succeeded' } } },
  })
  const service = { from(table) {
    assert.equal(table, 'coaching_payment_attempts')
    return { select() { return this }, eq() { return this }, single: async () => ({ data: attempt, error: null }),
      maybeSingle: async () => ({ data: attempt, error: null }) }
  } }
  return { process: () => engine.processCoachingPaymentReconciliation({ service, attemptId: attempt.id }), calls, attempt }
}
test('technical refund uses only owned attempt identity and platform cost without changing winner', async () => {
  const f = reconciliation(); assert.equal((await f.process()).state, 'succeeded')
  const [claim] = f.calls; assert.equal(claim.target.attemptId, f.attempt.id)
  assert.equal(claim.booking.stripe_payment_intent_id, 'pi_owned'); assert.equal(claim.booking.status, 'cancelled')
  assert.equal(claim.request.actor_role, 'system'); assert.equal(claim.request.actor_user_id, null); assert.equal(claim.resumeCapture, true)
})
for (const invalid of [{ reconciliation_reason: null }, { fulfillment_state: 'paid_confirmed' }, { refund_status: 'not_requested' },
  { stripe_payment_intent_id: null }, { amount_paid_cents: 0 }, { refund_idempotency_key: 'different-attempt' }]) {
  test(`unclaimed or winning payment cannot use system refund: ${Object.keys(invalid)[0]}`, async () => {
    const f = reconciliation(invalid); await assert.rejects(f.process(), /Invalid durable/); assert.equal(f.calls.length, 0)
  })
}
test('fresh provider-already-refunded claim shares remaining-payment reconciliation safely', async () => {
  const f = reconciliation({ reconciliation_reason: 'payment_already_refunded' }); await f.process(); assert.equal(f.calls.length, 1)
})
