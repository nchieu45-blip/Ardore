import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const ownerId = 'synthetic-owner'
const creatorId = 'synthetic-owned-coach'

function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)(name => modules[name] ?? require(name), loadedModule.exports, loadedModule)
  return loadedModule.exports
}

function fixture({ authenticated = true, creatorFound = true, ownerError = null, queryError = null,
  recoveryError = null, mode = false, modeError = null, ownerTransportFailure = null } = {}) {
  const calls = { services: 0, queries: [], recoveries: [] }
  let ownerResolved = false
  const row = {
    id: 'synthetic-settlement', creator_id: creatorId, stripe_livemode: mode,
    kind: 'booking', state: 'settled', gross_cents: 10_000, platform_fee_cents: 1000,
    coach_net_cents: 9000, transfer_amount_cents: 9000, amount_reversed_cents: 1500,
    amount_refunded_cents: 2000, stripe_transfer_id: 'tr_synthetic', created_at: '2026-10-03T12:00:00.000Z',
    account_id: 'acct_private', buyer_id: 'private-buyer', stripe_payment_intent_id: 'pi_private',
    last_error_code: 'private-provider-detail',
  }
  const client = {
    auth: { async getUser() {
      if (ownerTransportFailure === 'auth') throw new Error('private-auth-transport-detail')
      return { data: { user: authenticated ? { id: ownerId } : null } }
    } },
    from(table) {
      assert.equal(table, 'creator_profiles')
      return {
        select(columns) { assert.equal(columns, 'id'); return this },
        eq(column, value) { assert.equal(column, 'user_id'); assert.equal(value, ownerId); return this },
        async maybeSingle() {
          if (ownerTransportFailure === 'profile') throw new Error('private-profile-transport-detail')
          ownerResolved = authenticated && creatorFound && !ownerError
          return { data: creatorFound ? { id: creatorId } : null, error: ownerError }
        },
      }
    },
  }
  const service = {
    from(table) {
      assert.equal(table, 'payment_settlements')
      const query = { columns: null, filters: [], order: null, limit: null }
      calls.queries.push(query)
      return {
        select(columns) { query.columns = columns; return this },
        eq(column, value) { query.filters.push([column, value]); return this },
        order(column, options) { query.order = [column, options]; return this },
        limit(value) { query.limit = value; return this },
        then(resolve, reject) { return Promise.resolve({ data: [row], error: queryError }).then(resolve, reject) },
      }
    },
  }
  const route = load('src/app/api/stripe/settlements/route.ts', {
    '@/lib/supabase/server': { createClient: async () => {
      if (ownerTransportFailure === 'client') throw new Error('private-client-transport-detail')
      return client
    }, createServiceClient: async () => {
      assert.equal(ownerResolved, true, 'Private financial access must follow authenticated creator ownership')
      calls.services++; return service
    } },
    '@/lib/stripe/connect-readiness': { configuredStripeLivemode() { if (modeError) throw modeError; return mode } },
    '@/lib/stripe/settlement': { async recoverCoachSettlements(input) {
      assert.equal(input.service, service)
      calls.recoveries.push(input)
      if (recoveryError) throw recoveryError
      return { checked: 3, settled: 1, held: 1, refunded: 1, failed: 0 }
    } },
  })
  return { route, calls, service }
}

test('unauthenticated, missing coach and failed ownership reads cannot access financial service clients', async () => {
  for (const [options, expected] of [
    [{ authenticated: false }, 401], [{ creatorFound: false }, 404],
    [{ ownerError: { message: 'private-database-detail' } }, 503],
  ]) {
    for (const method of ['GET', 'POST']) {
      const state = fixture(options)
      const response = await state.route[method]()
      assert.equal(response.status, expected)
      assert.deepEqual(state.calls, { services: 0, queries: [], recoveries: [] })
      assert.doesNotMatch(await response.text(), /private-database-detail/)
    }
  }
})

test('settlement GET always scopes the authenticated coach and configured Stripe mode and exposes only sanitized balances', async () => {
  for (const mode of [false, true]) {
    const state = fixture({ mode })
    const response = await state.route.GET(new Request('https://example.invalid/api/stripe/settlements?creator_id=other&livemode=wrong'))
    assert.equal(response.status, 200)
    assert.deepEqual(state.calls.queries[0].filters, [['creator_id', creatorId], ['stripe_livemode', mode]])
    assert.deepEqual(state.calls.queries[0].order, ['created_at', { ascending: false }])
    assert.equal(state.calls.queries[0].limit, 50)
    assert.doesNotMatch(state.calls.queries[0].columns, /buyer_id|account_id|payment_intent|last_error/)
    assert.deepEqual(await response.json(), { settlements: [{
      id: 'synthetic-settlement', kind: 'booking', state: 'settled', grossCents: 10_000,
      feeCents: 1000, coachNetCents: 9000, transferredCents: 7500, refundedCents: 2000,
      createdAt: '2026-10-03T12:00:00.000Z',
    }] })
  }
})

test('ownership transport failures produce a sanitized response without any financial access', async () => {
  for (const ownerTransportFailure of ['client', 'auth', 'profile']) {
    for (const method of ['GET', 'POST']) {
      const state = fixture({ ownerTransportFailure })
      const response = await state.route[method]()
      assert.equal(response.status, 503)
      assert.doesNotMatch(await response.text(), /private-(client|auth|profile)-transport-detail/)
      assert.deepEqual(state.calls, { services: 0, queries: [], recoveries: [] })
    }
  }
})

test('recovery POST ignores all client financial, provider and creator inputs', async () => {
  const state = fixture()
  const hostileRequest = { json() { assert.fail('Recovery must not read client-selected financial parameters') },
    url: 'https://example.invalid/api/stripe/settlements?creatorId=other',
    body: JSON.stringify({ creatorId: 'other', accountId: 'acct_attacker', amount: 1, refund: 1,
      price: 0, state: 'settled', livemode: true, limit: 1_000_000 }),
  }
  const response = await state.route.POST(hostileRequest)
  assert.equal(response.status, 200)
  assert.equal(state.calls.recoveries.length, 1)
  assert.deepEqual(state.calls.recoveries[0], { service: state.service, creatorId })
  assert.deepEqual(await response.json(), { checked: 3, settled: 1, held: 1, refunded: 1, failed: 0 })
})

test('read, configured mode and recovery failures return safe errors without private provider or database details', async () => {
  for (const [options, method] of [
    [{ queryError: { message: 'private-database-detail' } }, 'GET'],
    [{ modeError: new Error('private-credential-detail') }, 'GET'],
    [{ recoveryError: new Error('private-provider-detail') }, 'POST'],
  ]) {
    const state = fixture(options)
    const response = await state.route[method]()
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /private-(database|provider|credential)-detail/)
  }
})

test('the recovery library filters coach and configured mode and caps work without calling providers on an empty queue', async () => {
  for (const [mode, limit, expected] of [[false, undefined, 25], [true, 1000, 25], [false, -5, 1]]) {
    const calls = []
    const service = { from(table) {
      assert.equal(table, 'payment_settlements')
      return {
        select(columns) { assert.equal(columns, '*'); return this },
        eq(column, value) { calls.push(['eq', column, value]); return this },
        in(column, value) { calls.push(['in', column, value]); return this },
        order(column) { calls.push(['order', column]); return this },
        limit(value) { calls.push(['limit', value]); return this },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject) },
      }
    } }
    const library = load('src/lib/stripe/settlement.ts', {
      '@/lib/stripe/server': { stripe: {} },
      '@/lib/stripe/platformFee': { calculateArdorePlatformFee: cents => Math.round(cents / 10) },
      '@/lib/stripe/connect-readiness': { configuredStripeLivemode: () => mode },
    })
    assert.deepEqual(await library.recoverCoachSettlements({ service, creatorId, limit }), {
      checked: 0, settled: 0, held: 0, refunded: 0, failed: 0,
    })
    assert.deepEqual(calls.filter(([action]) => action === 'eq'), [['eq', 'creator_id', creatorId], ['eq', 'stripe_livemode', mode]])
    assert.deepEqual(calls.find(([action]) => action === 'limit'), ['limit', expected])
    assert.ok(calls.find(([action]) => action === 'in')[2].includes('failed'))
  }
})
