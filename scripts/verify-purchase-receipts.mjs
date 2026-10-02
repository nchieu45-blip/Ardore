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

function fixture(duplicate = false) {
  const receipts = []
  let savedPurchases = []
  const products = [
    { id: 'product-a', price: 90, title: 'Product A', creator: { display_name: 'Synthetic creator' } },
    { id: 'product-b', price: 10, title: 'Product B', creator: { display_name: 'Synthetic creator' } },
  ]
  const event = {
    id: 'synthetic-event', type: 'checkout.session.completed', livemode: false,
    data: { object: {
      id: 'synthetic-session', mode: 'payment', payment_status: 'paid',
      amount_total: 8000, payment_intent: 'synthetic-intent',
      metadata: { buyer_id: 'synthetic-buyer', product_ids: 'product-a,product-b' },
    } },
  }
  const database = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'delivered@resend.dev', user_metadata: {} } } }) } },
    from(table) {
      assert.ok(['stripe_webhook_events', 'products', 'purchases'].includes(table))
      const query = {
        select() { return this }, eq() { return this }, in() { return this },
        async insert() { return { error: duplicate ? { code: '23505' } : null } },
        async upsert(rows) { assert.equal(table, 'purchases'); savedPurchases = rows; return { error: null } },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'products' ? products : [], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const overrides = {
    '@/lib/stripe/server': { stripe: { webhooks: { constructEvent: () => event } } },
    '@/lib/supabase/server': { createServiceClient: async () => database },
    '@/lib/email/send': {
      sendPurchaseReceipt: async (to, data) => { assert.equal(to, 'delivered@resend.dev'); receipts.push(data) },
      sendNewSubscriberNotification: async () => { throw new Error('Unexpected subscription email') },
    },
    '@/lib/notifications': { createNotification: async () => { throw new Error('Unexpected notification') } },
    '@/lib/coaching-confirmation': { provisionConfirmedCoachingBooking: async () => { throw new Error('Unexpected coaching confirmation') } },
    '@/lib/coaching-refund': { reconcileCoachingRefund: async () => { throw new Error('Unexpected coaching refund') } },
  }
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule,
    { env: { STRIPE_SECRET_KEY: 'sk_test_synthetic', NEXT_PUBLIC_APP_URL: 'https://www.ardore-health.com' } },
  )
  return {
    receipts,
    purchases: () => savedPurchases,
    run: () => loadedModule.exports.POST({ text: async () => '{}', headers: new Headers({ 'stripe-signature': 'synthetic' }) }),
  }
}

test('discounted unequal-price purchases have receipts matching the saved per-product amounts', async () => {
  const state = fixture()
  assert.equal((await state.run()).status, 200)
  assert.deepEqual(state.purchases().map(p => p.amount_paid), [72, 8])
  assert.deepEqual(state.receipts.map(p => p.amountPaid), [72, 8])
  assert.deepEqual(state.receipts.map(p => p.productTitle), ['Product A', 'Product B'])
})

test('duplicate webhook delivery sends no additional receipts and writes no purchases', async () => {
  const state = fixture(true)
  const response = await state.run()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).duplicate, true)
  assert.deepEqual(state.purchases(), [])
  assert.deepEqual(state.receipts, [])
})
