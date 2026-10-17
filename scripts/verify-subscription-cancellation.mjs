import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

// These tests load only local source and inject every database/provider boundary.
// No credentials, network requests, Stripe actions or production fixtures exist.
const require = createRequire(import.meta.url)
const buyerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const creatorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const tierId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const subscriptionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const orderId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const origin = 'https://www.ardore-health.com'
const rawFailure = 'private-provider-detail-that-must-not-reach-the-client'

function load(path, overrides = {}, onImport = () => {}) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'console', output)(name => {
    onImport(name)
    return name in overrides ? overrides[name] : require(name)
  }, loadedModule.exports, loadedModule, { error() {}, warn() {} })
  return loadedModule.exports
}

const entitlement = load('../src/lib/subscription-entitlement.ts')
const cancellation = load('../src/lib/subscription-cancellation.ts', {
  '@/lib/subscription-entitlement': entitlement,
})

function fixture(options = {}) {
  const now = Date.now()
  const paidEnd = new Date(now + 60_000).toISOString()
  const providerEnd = Math.floor(now / 1000) + 3600
  const local = {
    id: subscriptionId, buyer_id: buyerId, creator_id: creatorId, tier_id: tierId,
    status: 'active', current_period_end: paidEnd,
    stripe_subscription_id: 'sub_syntheticCancellation', stripe_livemode: true,
    tier: { creator_id: creatorId }, ...options.local,
  }
  let remote = {
    id: local.stripe_subscription_id, livemode: true, status: 'active',
    metadata: { buyer_id: buyerId, creator_id: creatorId, tier_id: tierId, ardore_order_id: orderId },
    items: { data: [{ current_period_end: providerEnd }], has_more: false },
    cancel_at_period_end: false, cancel_at: null, ended_at: null, schedule: null,
    ...options.remote,
  }
  let order = {
    id: orderId, kind: 'subscription', buyer_id: buyerId, creator_id: creatorId,
    stripe_subscription_id: local.stripe_subscription_id, stripe_livemode: true,
    reference: { tierId }, ...options.order,
  }
  if (options.noOrder) order = null
  const reads = [], writes = [], retrieved = [], updated = [], imports = [], clientReads = []
  const privileged = []
  const service = {
    from(table) {
      assert.ok(['payment_orders', 'subscriptions'].includes(table), `Unexpected table: ${table}`)
      const query = { table, filters: {}, operators: {}, selection: null, action: 'select', row: null }
      privileged.push(query)
      return {
        select(selection) { query.selection = selection; return this },
        eq(key, value) { query.filters[key] = value; query.operators[key] = 'eq'; return this },
        is(key, value) { query.filters[key] = value; query.operators[key] = 'is'; return this },
        update(row) { query.action = 'update'; query.row = row; writes.push(query); return this },
        async maybeSingle() {
          if (query.action === 'update') {
            assert.equal(table, 'subscriptions')
            return { data: options.casMiss ? null : { id: local.id, ...query.row, ...options.saved }, error: options.writeError ? { message: rawFailure } : null }
          }
          assert.equal(table, 'payment_orders')
          reads.push(query)
          return { data: order, error: options.orderError ? { message: rawFailure } : null }
        },
      }
    },
  }
  const provider = {
    subscriptions: {
      async retrieve(id) {
        retrieved.push(id)
        if (options.retrieveError || (options.confirmationReadError && retrieved.length > 1)) throw new Error(rawFailure)
        if (options.onRetrieve) return options.onRetrieve({ id, count: retrieved.length, remote: structuredClone(remote) })
        return structuredClone(remote)
      },
      async update(...args) {
        updated.push(args)
        if (!options.noProviderChange) remote = { ...remote, cancel_at_period_end: true, ...options.afterUpdate }
        if (options.updateError) throw new Error(rawFailure)
        return structuredClone(remote)
      },
    },
  }
  const client = {
    auth: { async getUser() { return { data: { user: options.noUser ? null : { id: buyerId } }, error: options.authError ? { message: rawFailure } : null } } },
    from(table) {
      assert.equal(table, 'subscriptions')
      const query = { table, filters: {}, selection: null }
      clientReads.push(query)
      return {
        select(value) { query.selection = value; return this },
        eq(key, value) { query.filters[key] = value; return this },
        async maybeSingle() { return { data: options.missing ? null : local, error: options.readError ? { message: rawFailure } : null } },
      }
    },
  }
  let modeCalls = 0, serviceCalls = 0
  const route = load('../src/app/api/subscriptions/[id]/cancel/route.ts', {
    '@/lib/subscription-cancellation': cancellation,
    '@/lib/supabase/server': {
      async createClient() { if (options.clientError) throw new Error(rawFailure); return client },
      async createServiceClient() { serviceCalls++; return service },
    },
    '@/lib/stripe/server': { stripe: provider },
    '@/lib/stripe/connect-readiness': { configuredStripeLivemode() {
      modeCalls++
      if (options.configError) throw new Error(rawFailure)
      return options.livemode ?? true
    } },
    '@/lib/app-url': { appOrigin: () => origin },
  }, name => imports.push(name))
  const input = () => ({ service, provider, subscription: local, livemode: options.livemode === null ? null : options.livemode ?? true, now })
  return {
    local, now, providerEnd, reads, writes, retrieved, updated, imports, clientReads, privileged,
    get serviceCalls() { return serviceCalls }, get modeCalls() { return modeCalls },
    inspect: () => cancellation.inspectSubscriptionCancellation(input()),
    cancel: () => cancellation.cancelSubscription(input()),
    setRemote(changes) { remote = { ...remote, ...changes } },
    async request(method = 'GET', requestOptions = {}) {
      const headers = new Headers({ ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}), ...requestOptions.headers })
      for (const key of requestOptions.omitHeaders ?? []) headers.delete(key)
      const request = new Request(`${origin}/api/subscriptions/${requestOptions.id ?? subscriptionId}/cancel`, {
        method, headers,
        ...(method === 'POST' ? { body: requestOptions.body ?? '{}' } : {}),
      })
      return route[method](request, { params: Promise.resolve({ id: requestOptions.id ?? subscriptionId }) })
    },
  }
}

async function rejectsStatus(action, status) {
  await assert.rejects(action, error => {
    assert.equal(error.name, 'SubscriptionCancellationError')
    assert.equal(error.status, status)
    assert.ok(!error.message.includes(rawFailure))
    return true
  })
}

async function responseStatus(state, expected, method = 'GET', options = {}) {
  const response = await state.request(method, options)
  assert.equal(response.status, expected)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const body = await response.json()
  assert.ok(!JSON.stringify(body).includes(rawFailure))
  return body
}

test('GET inspects only the authenticated buyer subscription and never changes provider or database', async () => {
  const state = fixture()
  const body = await responseStatus(state, 200)
  assert.deepEqual(state.clientReads[0].filters, { id: subscriptionId, buyer_id: buyerId })
  assert.deepEqual(body, { kind: 'paid', state: 'available', endsAt: new Date(state.providerEnd * 1000).toISOString(), accessUntil: state.local.current_period_end })
  assert.deepEqual(state.reads[0].filters, { id: orderId, buyer_id: buyerId })
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

for (const [name, options, status] of [
  ['missing session', { noUser: true }, 401], ['authentication failure', { authError: true }, 401],
  ['unavailable session service', { clientError: true }, 503], ['missing owned row', { missing: true }, 404],
  ['foreign buyer', { local: { buyer_id: otherId } }, 404], ['wrong local row', { local: { id: otherId } }, 404],
  ['database read error', { readError: true }, 503],
]) {
  test(`route fails closed for ${name}`, async () => {
    const state = fixture(options)
    await responseStatus(state, status)
    assert.equal(state.serviceCalls, 0); assert.equal(state.modeCalls, 0)
    assert.deepEqual(state.updated, []); assert.deepEqual(state.retrieved, []); assert.deepEqual(state.writes, [])
  })
}

test('malformed local IDs are rejected before row or privileged reads', async () => {
  const state = fixture()
  await responseStatus(state, 400, 'GET', { id: 'sub_untrustedProviderId' })
  assert.deepEqual(state.clientReads, []); assert.equal(state.serviceCalls, 0)
})

test('valid-looking POST cannot cancel without an authenticated buyer', async () => {
  const state = fixture({ noUser: true })
  await responseStatus(state, 401, 'POST')
  assert.equal(state.serviceCalls, 0); assert.deepEqual(state.retrieved, [])
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

for (const [name, options, expected] of [
  ['missing Origin', { omitHeaders: ['origin'] }, 403],
  ['foreign Origin', { headers: { origin: 'https://untrusted.invalid' } }, 403],
  ['cross-site fetch', { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
  ['form content', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }, 415],
  ['missing content type', { omitHeaders: ['content-type'] }, 415],
  ['malformed JSON', { body: '{' }, 400], ['null JSON', { body: 'null' }, 400],
  ['array JSON', { body: '[]' }, 400], ['primitive JSON', { body: 'true' }, 400],
  ['browser buyer override', { body: JSON.stringify({ buyer_id: otherId }) }, 400],
  ['browser provider override', { body: JSON.stringify({ stripe_subscription_id: 'sub_foreign' }) }, 400],
  ['browser cancellation date', { body: JSON.stringify({ cancel_at: 1 }) }, 400],
]) {
  test(`POST rejects ${name} without reaching any actor, provider or database mutation`, async () => {
    const state = fixture()
    await responseStatus(state, expected, 'POST', options)
    assert.deepEqual(state.clientReads, []); assert.deepEqual(state.privileged, [])
    assert.deepEqual(state.retrieved, []); assert.deepEqual(state.updated, [])
  })
}

test('valid JSON POST schedules only end-of-period cancellation and preserves paid access authority', async () => {
  const state = fixture()
  const original = structuredClone(state.local)
  const body = await responseStatus(state, 200, 'POST', { headers: { 'content-type': 'application/json; charset=UTF-8' } })
  assert.equal(body.state, 'scheduled')
  assert.equal(body.accessUntil, original.current_period_end)
  assert.deepEqual(state.updated, [[original.stripe_subscription_id, { cancel_at_period_end: true }]])
  assert.deepEqual(state.retrieved, [original.stripe_subscription_id, original.stripe_subscription_id])
  assert.deepEqual(state.writes, [])
  assert.deepEqual(state.local, original)
  assert.equal(entitlement.hasActiveSubscriptionEntitlement(state.local, state.now), true)
  assert.equal(entitlement.hasActiveSubscriptionEntitlement(state.local, Date.parse(original.current_period_end)), false)
})

for (const [name, options] of [
  ['malformed local provider ID', { local: { stripe_subscription_id: 'not-a-subscription' } }],
  ['local provider mode mismatch', { local: { stripe_livemode: false } }],
  ['null paid mode', { local: { stripe_livemode: null } }],
  ['missing historical paid tier', { local: { tier_id: null } }],
  ['remote provider ID mismatch', { remote: { id: 'sub_foreign' } }],
  ['remote mode mismatch', { remote: { livemode: false } }],
  ...['buyer_id', 'creator_id', 'tier_id'].map(field => [`remote ${field} mismatch`, { remote: { metadata: { buyer_id: buyerId, creator_id: creatorId, tier_id: tierId, [field]: otherId } } }]),
  ['malformed settlement ID', { remote: { metadata: { buyer_id: buyerId, creator_id: creatorId, tier_id: tierId, ardore_order_id: 'not-an-order' } } }],
  ['missing frozen settlement', { noOrder: true }],
  ...Object.entries({ id: otherId, kind: 'product', buyer_id: otherId, creator_id: otherId, stripe_subscription_id: 'sub_foreign', stripe_livemode: false, reference: { tierId: otherId } })
    .map(([field, value]) => [`frozen settlement ${field} mismatch`, { order: { [field]: value } }]),
]) {
  test(`provider ownership rejects ${name} before mutation`, async () => {
    const state = fixture(options)
    await rejectsStatus(state.cancel, 409)
    assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
  })
}

test('legacy subscriptions require exact server-issued buyer, coach and tier metadata without settlement inference', async () => {
  const state = fixture({ remote: { metadata: { buyer_id: buyerId, creator_id: creatorId, tier_id: tierId } } })
  assert.equal((await state.cancel()).state, 'scheduled')
  assert.deepEqual(state.reads, [])
  assert.equal(state.updated.length, 1)
})

for (const options of [{ retrieveError: true }, { orderError: true }, { livemode: null }]) {
  test(`unavailable provider/configuration fails without leaking detail: ${JSON.stringify(options)}`, async () => {
    const state = fixture(options)
    await rejectsStatus(state.cancel, 503)
    assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
  })
}

test('missing paid Stripe configuration is reported safely by the route', async () => {
  const state = fixture({ configError: true })
  await responseStatus(state, 503, 'POST')
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

for (const [name, local, remote, livemode] of [
  ['trialing', {}, { status: 'trialing' }, true],
  ['past-due', {}, { status: 'past_due' }, true],
  ['unpaid', {}, { status: 'unpaid' }, true],
  ['local past-due', { status: 'past_due' }, {}, true],
  ['test-mode', { stripe_livemode: false }, { livemode: false }, false],
  ['tier ownership mismatch', { tier: { creator_id: otherId } }, {}, true],
]) {
  test(`${name} subscription can end renewal without promising paid access`, async () => {
    const state = fixture({ local, remote, livemode, ...(livemode === false ? { order: { stripe_livemode: false } } : {}) })
    assert.equal((await state.cancel()).accessUntil, null)
    assert.equal(state.updated.length, 1)
    assert.deepEqual(state.writes, [])
  })
}

test('provider cancellation date never extends invoice-derived local entitlement', async () => {
  const state = fixture({ remote: { cancel_at_period_end: true } })
  const result = await state.cancel()
  assert.equal(result.state, 'scheduled')
  assert.equal(result.accessUntil, state.local.current_period_end)
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

test('earlier provider cancellation caps visible access without changing stored paid bounds', async () => {
  const end = Math.floor(Date.now() / 1000) + 10
  const state = fixture({ remote: { cancel_at: end } })
  const result = await state.cancel()
  assert.equal(result.accessUntil, new Date(end * 1000).toISOString())
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

test('past scheduled cancellation never promises access despite a future local paid boundary', async () => {
  const end = Math.floor(Date.now() / 1000) - 10
  const state = fixture({ remote: { cancel_at: end, cancel_at_period_end: true } })
  const result = await state.cancel()
  assert.equal(result.state, 'scheduled')
  assert.equal(result.endsAt, new Date(end * 1000).toISOString())
  assert.equal(result.accessUntil, null)
  assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
})

for (const status of ['canceled', 'incomplete_expired']) {
  test(`already ${status} subscription is idempotent and never claims access`, async () => {
    const endedAt = Math.floor(Date.now() / 1000) - 1
    const state = fixture({ remote: { status, ended_at: endedAt } })
    assert.deepEqual(await state.cancel(), { kind: 'paid', state: 'ended', endsAt: new Date(endedAt * 1000).toISOString(), accessUntil: null })
    assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
  })
}

for (const [name, remote] of [
  ['multiple billing items', { items: { data: [{ current_period_end: 9999999999 }, { current_period_end: 9999999999 }], has_more: false } }],
  ['paginated billing items', { items: { data: [{ current_period_end: 9999999999 }], has_more: true } }],
  ['missing billing period', { items: { data: [], has_more: false } }],
  ['non-integral billing period', { items: { data: [{ current_period_end: 1.5 }], has_more: false } }],
  ['unsupported schedule', { schedule: 'sub_sched_synthetic' }],
  ['custom cancellation after the current billing period', { cancel_at: Math.floor(Date.now() / 1000) + 7200 }],
  ['custom cancellation with ambiguous multiple billing items', { cancel_at: Math.floor(Date.now() / 1000) + 600, items: { data: [{ current_period_end: 9999999999 }, { current_period_end: 9999999999 }], has_more: false } }],
  ['past billing boundary', { items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) - 1 }], has_more: false } }],
  ['unsupported status', { status: 'paused' }],
]) {
  test(`ambiguous ${name} requires support instead of changing financial terms`, async () => {
    const state = fixture({ remote })
    await rejectsStatus(state.cancel, 409)
    assert.deepEqual(state.updated, []); assert.deepEqual(state.writes, [])
  })
}

test('ambiguous timeout reports unconfirmed, then retry reads scheduled state without a second write', async () => {
  const state = fixture({ updateError: true })
  await rejectsStatus(state.cancel, 503)
  assert.equal(state.updated.length, 1)
  assert.equal((await state.cancel()).state, 'scheduled')
  assert.equal(state.updated.length, 1)
  assert.deepEqual(state.writes, [])
})

test('retry after provider dashboard reactivation is not replayed from a permanent idempotency key', async () => {
  const state = fixture()
  assert.equal((await state.cancel()).state, 'scheduled')
  state.setRemote({ cancel_at_period_end: false })
  assert.equal((await state.cancel()).state, 'scheduled')
  assert.equal(state.updated.length, 2)
  for (const args of state.updated) assert.deepEqual(args, [state.local.stripe_subscription_id, { cancel_at_period_end: true }])
})

for (const [name, options] of [
  ['still available', { noProviderChange: true }], ['read unavailable', { confirmationReadError: true }],
  ['ownership changed', { afterUpdate: { metadata: { buyer_id: otherId, creator_id: creatorId, tier_id: tierId } } }],
  ['mode changed', { afterUpdate: { livemode: false } }],
]) {
  test(`no false success when provider confirmation is ${name}`, async () => {
    const state = fixture(options)
    await rejectsStatus(state.cancel, 503)
    assert.equal(state.updated.length, 1)
    assert.deepEqual(state.writes, [])
  })
}

function freeFixture(options = {}) {
  return fixture({ ...options, configError: true, local: {
    stripe_subscription_id: 'free_syntheticCancellation', stripe_livemode: null,
    ...options.local,
  } })
}

test('free GET needs no configured Stripe module and is read-only', async () => {
  const state = freeFixture()
  assert.deepEqual(await responseStatus(state, 200), { kind: 'free', state: 'available', endsAt: null, accessUntil: null })
  assert.equal(state.modeCalls, 0)
  assert.ok(!state.imports.includes('@/lib/stripe/server'))
  assert.ok(!state.imports.includes('@/lib/stripe/connect-readiness'))
  assert.deepEqual(state.updated, []); assert.deepEqual(state.retrieved, []); assert.deepEqual(state.writes, [])
})

test('free cancellation immediately revokes only the exact unchanged owned free row without provider access', async () => {
  const state = freeFixture()
  const before = structuredClone(state.local)
  const body = await responseStatus(state, 200, 'POST')
  assert.equal(body.kind, 'free'); assert.equal(body.state, 'ended'); assert.equal(body.accessUntil, null)
  assert.equal(state.writes.length, 1)
  const write = state.writes[0]
  assert.equal(write.table, 'subscriptions')
  assert.deepEqual(write.filters, {
    id: subscriptionId, buyer_id: buyerId, creator_id: creatorId, tier_id: tierId,
    stripe_subscription_id: before.stripe_subscription_id, stripe_livemode: null,
    status: before.status, current_period_end: before.current_period_end,
  })
  assert.deepEqual(Object.keys(write.row).sort(), ['current_period_end', 'status'])
  assert.equal(write.row.status, 'canceled')
  assert.ok(Date.parse(write.row.current_period_end) <= Date.now())
  assert.equal(state.modeCalls, 0); assert.ok(!state.imports.includes('@/lib/stripe/server'))
  assert.deepEqual(state.retrieved, []); assert.deepEqual(state.updated, [])
})

test('free historical subscription without a tier uses IS NULL while retaining every strict CAS guard', async () => {
  const state = freeFixture({ local: { tier_id: null, tier: null } })
  const body = await responseStatus(state, 200, 'POST')
  assert.equal(body.state, 'ended')
  assert.equal(state.writes.length, 1)
  const write = state.writes[0]
  assert.deepEqual(write.filters, {
    id: subscriptionId, buyer_id: buyerId, creator_id: creatorId, tier_id: null,
    stripe_subscription_id: state.local.stripe_subscription_id, stripe_livemode: null,
    status: state.local.status, current_period_end: state.local.current_period_end,
  })
  assert.equal(write.operators.tier_id, 'is')
  assert.equal(write.operators.stripe_livemode, 'is')
  for (const field of ['id', 'buyer_id', 'creator_id', 'stripe_subscription_id', 'status', 'current_period_end']) {
    assert.equal(write.operators[field], 'eq')
  }
  assert.equal(state.modeCalls, 0)
  assert.deepEqual(state.retrieved, []); assert.deepEqual(state.updated, [])
})

for (const [name, options, status] of [
  ['compare-and-set miss', { casMiss: true }, 409],
  ['database write failure', { writeError: true }, 503],
  ['wrong saved row', { saved: { id: otherId } }, 409],
  ['unconfirmed saved status', { saved: { status: 'active' } }, 409],
]) {
  test(`free cancellation does not report success for ${name}`, async () => {
    const state = freeFixture(options)
    await responseStatus(state, status, 'POST')
    assert.deepEqual(state.retrieved, []); assert.deepEqual(state.updated, [])
  })
}

for (const local of [{ status: 'canceled' }, { current_period_end: new Date(Date.now() - 60_000).toISOString() }]) {
  test(`already ended free subscription is idempotent: ${JSON.stringify(local)}`, async () => {
    const state = freeFixture({ local })
    assert.equal((await state.cancel()).state, 'ended')
    assert.deepEqual(state.writes, []); assert.deepEqual(state.retrieved, [])
  })
}

test('malformed free access boundary fails safely instead of inventing cancellation success', async () => {
  const state = freeFixture({ local: { current_period_end: 'invalid' } })
  await rejectsStatus(state.cancel, 409)
  assert.deepEqual(state.writes, []); assert.deepEqual(state.retrieved, [])
})
