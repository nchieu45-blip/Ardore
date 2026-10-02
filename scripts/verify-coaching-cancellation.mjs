import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const buyerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const creatorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const coachUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function fixture({ authenticated = true, code = 'ok', free = false, state = 'succeeded', newlyCancelled = true,
  rpcError = false, actorRole = 'buyer' } = {}) {
  const rpcCalls = []
  const processed = []
  const afterCallbacks = []
  const notifications = []
  const emails = []
  const actorId = actorRole === 'creator' ? coachUserId : buyerId
  const booking = {
    id: bookingId, buyer_id: buyerId, creator_id: creatorId,
    buyer_name: 'Synthetic buyer', buyer_email: 'delivered+ardore-refund-buyer@resend.dev',
    scheduled_at: new Date(Date.now() + 48 * 3_600_000).toISOString(), duration_minutes: 60,
    status: 'cancelled', payment_status: free ? 'not_required' : 'paid', price_cents: free ? 0 : 4100,
    amount_paid_cents: free ? 0 : 4100, stripe_payment_intent_id: free ? null : 'pi_synthetic',
    stripe_livemode: free ? null : false, cancellation_policy_hours_snapshot: 24,
    creator_profiles: { user_id: coachUserId, display_name: 'Synthetic coach', slug: 'synthetic-coach' },
  }
  const refund = free ? null : {
    booking_id: bookingId, actor_user_id: actorId, actor_role: actorRole,
    state: 'pending', amount_cents: null, stripe_refund_id: null, stripe_payment_intent_id: 'pi_synthetic',
  }
  const rpcResult = code === 'ok' ? {
    booking, refund, newly_cancelled: newlyCancelled, actor_role: actorRole,
    creator_user_id: coachUserId, creator_display_name: 'Synthetic coach',
  } : { error: code, policy_hours: 24 }
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: actorId } : null } }) },
    from() { throw new Error('Untrusted client must not write/read cancellation authority') },
  }
  const service = {
    auth: { admin: { getUserById: async id => {
      assert.equal(id, coachUserId)
      return { data: { user: { id, email: 'delivered+ardore-refund-coach@resend.dev' } } }
    } } },
    async rpc(name, params) {
      assert.equal(name, 'cancel_coaching_booking')
      rpcCalls.push(params)
      return { data: rpcResult, error: rpcError ? { code: 'synthetic_database_error' } : null }
    },
    from(table) {
      assert.equal(table, 'creator_profiles', 'Cancellation writes belong to the atomic authorization RPC')
      return {
        select() { return this }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, creatorId); return this },
        async single() { return { data: booking.creator_profiles, error: null } },
        async maybeSingle() { return { data: booking.creator_profiles, error: null } },
      }
    },
  }
  const overrides = {
    'next/server': { ...require('next/server'), after: callback => { afterCallbacks.push(callback) } },
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => service },
    '@/lib/coaching-refund': { processCoachingRefund: async input => {
      assert.equal(input.service, service)
      assert.deepEqual(input.booking, booking)
      assert.deepEqual(input.request, refund)
      processed.push(input)
      return { state, amountCents: 4100, amountRefundedCents: state === 'succeeded' ? 4100 : 0,
        transferStatus: 'not_required', stripeRefundId: state === 'succeeded' ? 're_synthetic' : null,
        errorCode: state === 'failed' ? 'synthetic_stripe_failure' : null }
    } },
    '@/lib/notifications': { createNotification: async input => { notifications.push(input) } },
    '@/lib/email/send': { sendSessionCancellation: async (recipient, data) => { emails.push({ recipient, data }) } },
  }
  const source = readFileSync(new URL('../src/app/api/coaching/cancel/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'console', compiled)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule, { error() {} },
  )
  return {
    rpcCalls, processed, afterCallbacks, notifications, emails,
    run(input = { bookingId }) {
      return loadedModule.exports.POST(new Request('https://www.ardore-health.com/api/coaching/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: typeof input === 'string' ? input : JSON.stringify(input),
      }))
    },
    async deliverNotifications() { for (const callback of afterCallbacks) await callback() },
  }
}

test('unauthenticated cancellation does not reach authorization or refunds', async () => {
  const state = fixture({ authenticated: false })
  assert.equal((await state.run()).status, 401)
  assert.deepEqual(state.rpcCalls, [])
  assert.deepEqual(state.processed, [])
  assert.deepEqual(state.afterCallbacks, [])
})

test('malformed cancellation input cannot reach a booking mutation or refund', async () => {
  for (const input of ['{', {}, { bookingId: null }, { bookingId: '' }, { bookingId: 123 }]) {
    const state = fixture()
    assert.equal((await state.run(input)).status, 400, `Input ${JSON.stringify(input)} must be rejected`)
    assert.deepEqual(state.rpcCalls, [])
    assert.deepEqual(state.processed, [])
    assert.deepEqual(state.afterCallbacks, [])
  }
})

test('atomic authorization refuses foreign, late, completed, or unverifiable booking requests', async () => {
  const refusals = [
    ['not_found', 404], ['forbidden', 403], ['not_cancellable', 400],
    ['policy_unavailable', 409], ['policy_violation', 403], ['payment_not_valid', 409],
  ]
  for (const [code, status] of refusals) {
    const state = fixture({ code, actorRole: code === 'not_cancellable' ? 'creator' : 'buyer' })
    const response = await state.run()
    assert.equal(response.status, status, code)
    const body = await response.json()
    if (code === 'policy_violation') assert.equal(body.policyViolation, true)
    assert.equal(state.rpcCalls.length, 1)
    assert.deepEqual(state.processed, [])
    assert.deepEqual(state.afterCallbacks, [])
  }
})

test('a free booking cancellation never contacts Stripe and notifies only after response', async () => {
  const state = fixture({ free: true })
  const response = await state.run()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).refundStatus, 'not_requested')
  assert.deepEqual(state.processed, [])
  assert.equal(state.afterCallbacks.length, 1)
  assert.deepEqual(state.notifications, [])
  await state.deliverNotifications()
  assert.equal(state.notifications.length, 1)
  assert.equal(state.emails.length, 1)
  assert.match(state.emails[0].recipient, /@resend\.dev$/)
})

test('a customer paid cancellation uses the trusted actor and full provider-confirmed refund result', async () => {
  const state = fixture()
  const response = await state.run({ bookingId, actor_user_id: coachUserId, amount_cents: 1, payment_status: 'refunded' })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.refundStatus, 'succeeded')
  assert.equal(body.refundAmountCents, 4100)
  assert.deepEqual(state.rpcCalls, [{ p_booking_id: bookingId, p_actor_user_id: buyerId }])
  assert.equal(state.processed.length, 1)
  assert.equal(state.afterCallbacks.length, 1)
})

test('a coach cancellation calls the same full-refund engine under the trusted coach identity', async () => {
  const state = fixture({ actorRole: 'creator' })
  const response = await state.run()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).refundAmountCents, 4100)
  assert.deepEqual(state.rpcCalls, [{ p_booking_id: bookingId, p_actor_user_id: coachUserId }])
  assert.equal(state.processed.length, 1)
  await state.deliverNotifications()
  assert.equal(state.emails[0].recipient, 'delivered+ardore-refund-buyer@resend.dev')
})

test('repeated cancellation reuses the durable refund request without repeating cancellation notices', async () => {
  const state = fixture({ newlyCancelled: false })
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await state.run()).status, 200)
  }
  assert.equal(state.processed.length, 2, 'The engine receives the same durable request and enforces provider idempotency')
  assert.equal(state.processed[0].request, state.processed[1].request)
  assert.deepEqual(state.afterCallbacks, [])
  assert.deepEqual(state.notifications, [])
  assert.deepEqual(state.emails, [])
})

test('pending Stripe refunds are visible as pending, not successful refunds', async () => {
  const state = fixture({ state: 'pending' })
  const response = await state.run()
  assert.equal(response.status, 202)
  assert.equal((await response.json()).refundStatus, 'pending')
  assert.equal(state.processed.length, 1)
})

test('Stripe failure reports canceled booking and failed refund without false success', async () => {
  const state = fixture({ state: 'failed' })
  const response = await state.run()
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.bookingCancelled, true)
  assert.equal(body.refundStatus, 'failed')
  assert.equal(state.processed.length, 1)
})

test('authorization/database failure cannot start Stripe refund processing', async () => {
  const state = fixture({ rpcError: true })
  assert.equal((await state.run()).status, 500)
  assert.deepEqual(state.processed, [])
  assert.deepEqual(state.afterCallbacks, [])
})
