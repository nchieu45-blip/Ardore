import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
const require = createRequire(import.meta.url)
function load(path, overrides = {}, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', ...Object.keys(globals), compiled)(
    name => overrides[name] ?? require(name), loadedModule.exports, loadedModule, ...Object.values(globals))
  return loadedModule.exports
}
const purchases = load('../src/lib/purchases.ts')
function fixture({ signedIn = true, owner = 'buyer', state = 'checkout_created', paymentStatus = 'paid', sessionStatus = 'complete',
  entitlement = false, error = false, intentStatus = null, providerError = false } = {}) {
  const calls = [], order = { id: 'owned-order', buyer_id: owner, kind: 'products', stripe_checkout_session_id: 'cs_test_owned',
    state, gross_cents: 500, stripe_livemode: false, reference: { items: [{ productId: 'owned-product' }] } }
  const session = { id: 'cs_test_owned', mode: 'payment', currency: 'eur', amount_total: 500, livemode: false,
    metadata: { ardore_order_id: order.id, buyer_id: owner }, payment_status: paymentStatus, status: sessionStatus,
    payment_intent: intentStatus ? 'pi_owned' : null }
  const row = { product_id: 'owned-product', buyer_id: owner, stripe_checkout_session_id: session.id, stripe_livemode: false, payment_status: 'paid', product: { type: 'pdf' } }
  function query(table) {
    const filters = []
    const q = { select() { return q }, eq(key, value) { filters.push([key, value]); return q }, in(key, value) { filters.push([key, value]); return q },
      async maybeSingle() { return (await result()).data[0] ? { data: (await result()).data[0], error: null } : { data: null, error: error ? {} : null } },
      then(resolve, reject) { return result().then(resolve, reject) } }
    async function result() {
      calls.push({ table, filters })
      const matches = value => filters.every(([key, filter]) => {
        const actual = key === 'products.type' ? value.product?.type : value[key]
        return Array.isArray(filter) ? filter.includes(actual) : actual === filter
      })
      return { data: error ? [] : (table === 'payment_orders' ? [order] : entitlement ? [row] : []).filter(matches), error: error ? {} : null }
    }
    return q
  }
  const client = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'buyer' } : null } }) }, from: query }
  const route = load('../src/app/api/stripe/purchase-status/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => { calls.push('service'); return client } },
    '@/lib/purchases': purchases,
    '@/lib/stripe/connect-readiness': { configuredStripeLivemode: () => false },
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { retrieve: async id => { calls.push('stripe'); assert.equal(id, session.id); if (providerError) throw new Error('PRIVATE'); return session } } },
      paymentIntents: { retrieve: async () => ({ metadata: session.metadata, amount: 500, currency: 'eur', livemode: false, status: intentStatus, last_payment_error: {} }) } } },
  })
  const ownership = load('../src/app/api/purchases/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client }, '@/lib/purchases': purchases,
    '@/lib/stripe/connect-readiness': { configuredStripeLivemode: () => false },
  })
  return { calls, order, session, row, ownership,
    get: id => route.GET({ nextUrl: new URL(`https://www.ardore-health.com/api/stripe/purchase-status?session_id=${encodeURIComponent(id ?? session.id)}`) }) }
}
test('success URL/session identifier alone cannot create or report a fulfilled purchase', async () => {
  const f = fixture(); const r = await f.get()
  assert.equal(r.status, 200); assert.equal((await r.json()).state, 'processing')
  assert.match(r.headers.get('cache-control'), /private, no-store/)
  assert.ok(f.calls.every(call => typeof call === 'string' || ['payment_orders', 'purchases'].includes(call.table)))
})
test('the confirmed library entitlement completes the purchase exactly once without any provider writes', async () => {
  const f = fixture({ state: 'fulfilled', entitlement: true })
  for (let i = 0; i < 3; i++) {
    const result = await (await f.get()).json()
    assert.deepEqual(result, { state: 'completed', productIds: ['owned-product'], testMode: true })
  }
  assert.ok(!f.calls.includes('stripe'))
})
test('late fulfillment and partial/missing entitlement never falsely report completion', async () => {
  const f = fixture({ state: 'fulfilled' })
  assert.equal((await (await f.get()).json()).state, 'unavailable')
  assert.deepEqual(purchases.confirmedProductIds(['one', 'two'], [{ product_id: 'one' }]), [])
  assert.deepEqual(purchases.confirmedProductIds(['one', 'one'], [{ product_id: 'one' }]), ['one'])
})
for (const [label, paymentStatus, sessionStatus, expected, intentStatus] of [
  ['canceled', 'unpaid', 'expired', 'canceled', null], ['unpaid', 'unpaid', 'open', 'awaiting_payment', null],
  ['async pending', 'unpaid', 'complete', 'processing', null], ['delayed success after expired session', 'paid', 'expired', 'processing', null],
  ['failed card', 'unpaid', 'open', 'payment_failed', 'requires_payment_method'],
  ['intent succeeded before session observation', 'unpaid', 'open', 'processing', 'succeeded'],
]) {
  test(`${label} cannot grant an entitlement`, async () => {
    const f = fixture({ paymentStatus, sessionStatus, intentStatus }); const result = await (await f.get()).json()
    assert.equal(result.state, expected); assert.deepEqual(result.productIds, [])
  })
}
test('refund/reconciliation states never grant library access', async () => {
  for (const [state, expected] of [['refund_required', 'refund_pending'], ['refunded', 'refunded']]) {
    const f = fixture({ state, entitlement: true }); const result = await (await f.get()).json()
    assert.equal(result.state, expected); assert.deepEqual(result.productIds, [])
  }
})
test('unauthenticated, unrelated buyers and unknown sessions cannot retrieve private Stripe or settlement state', async () => {
  for (const config of [{ signedIn: false }, { owner: 'unrelated' }]) {
    const f = fixture(config); const r = await f.get()
    assert.equal(r.status, config.signedIn === false ? 401 : 404); assert.ok(!f.calls.includes('stripe'))
    if (config.signedIn === false) assert.deepEqual(f.calls, [])
  }
  const f = fixture(); assert.equal((await f.get('cs_test_other')).status, 404); assert.ok(!f.calls.includes('stripe'))
  assert.equal((await f.get('bad/id')).status, 400)
})
test('provider and database errors fail closed without leaking errors or claiming completed/failed payment', async () => {
  for (const config of [{ error: true }, { providerError: true }]) {
    const f = fixture(config); const r = await f.get(); assert.equal(r.status, 503)
    assert.doesNotMatch(JSON.stringify(await r.json()), /PRIVATE|pi_|cs_|acct_/)
  }
})
test('ownership list contains only this buyer’s valid digital products; foreign/unpaid purchases cannot clear a cart', async () => {
  const f = fixture({ entitlement: true }); const r = await f.ownership.GET()
  assert.deepEqual(await r.json(), { ownedProductIds: ['owned-product'] })
  for (const config of [{ owner: 'other', entitlement: true }, { entitlement: false }]) {
    assert.deepEqual(await (await fixture(config).ownership.GET()).json(), { ownedProductIds: [] })
  }
  const service = fixture({ entitlement: true }); service.row.product.type = 'service'
  assert.deepEqual(await (await service.ownership.GET()).json(), { ownedProductIds: [] })
})
test('confirmed cart removal preserves unrelated items and persists across refresh/re-login; storage sync updates other tabs', () => {
  const storage = new Map(), events = new Map()
  const cart = load('../src/lib/cart.ts', {}, { window: { addEventListener: (key, callback) => events.set(key, callback), removeEventListener: key => events.delete(key) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } })
  const received = []
  const unsubscribe = cart.subscribeCart(items => received.push(items))
  cart.addToCart({ id: 'bought' }); cart.addToCart({ id: 'other' }); cart.removePurchasedFromCart(['bought', 'bought'])
  assert.deepEqual(cart.getCart(), [{ id: 'other' }]); assert.deepEqual(received.at(-1), [{ id: 'other' }])
  const reloaded = load('../src/lib/cart.ts', {}, { window: {}, localStorage: { getItem: key => storage.get(key) } })
  assert.deepEqual(reloaded.getCart(), [{ id: 'other' }])
  cart.removePurchasedFromCart([]); assert.deepEqual(cart.getCart(), [{ id: 'other' }])
  storage.set('ardore_cart', '[{"id":"another-tab"}]'); events.get('storage')({ key: 'ardore_cart' })
  assert.deepEqual(received.at(-1), [{ id: 'another-tab' }]); unsubscribe()
})
