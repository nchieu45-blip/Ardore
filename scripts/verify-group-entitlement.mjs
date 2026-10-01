import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, overrides) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', source)(
    name => name in overrides ? overrides[name] : require(name),
    loadedModule.exports, loadedModule, { env: { NEXT_PUBLIC_APP_URL: 'https://www.ardore-health.com' } },
  )
  return loadedModule.exports
}
const entitlement = load('../src/lib/subscription-entitlement.ts', {})
const validSub = {
  id: 'synthetic-sub', creator_id: 'coach-a', status: 'active', current_period_end: '2099-01-01T00:00:00Z',
  stripe_subscription_id: 'sub_trusted', stripe_livemode: true, subscription_tiers: { creator_id: 'coach-a' },
}

function fixture({ user = { id: 'synthetic-buyer' }, subscription = null, price = 5900, countError = null, count = 0 } = {}) {
  const writes = [], checkouts = [], reads = []
  const videoClass = {
    id: 'synthetic-class', creator_id: 'coach-a', active: true, price_cents: price,
    included_in_subscription: true, max_participants: 10, title: 'Coach-controlled title',
    creator_profiles: null, schedule_type: 'once', starts_at: null, duration_minutes: 60,
  }
  function query(table, privileged) {
    const filters = []
    return {
      select() { return this }, eq(key, value) { filters.push([key, value]); return this },
      insert(row) { assert.equal(privileged, true, 'browser client must never write an entitlement'); writes.push(row); return this },
      async single() { return { data: table === 'video_classes' ? videoClass : { id: 'synthetic-booking' }, error: null } },
      async maybeSingle() { return { data: table === 'subscriptions' ? subscription : null, error: null } },
      then(resolve, reject) {
        reads.push({ table, privileged, filters })
        return Promise.resolve({ count, error: countError }).then(resolve, reject)
      },
    }
  }
  const route = load('../src/app/api/video-classes/[id]/book/route.ts', {
    '@/lib/subscription-entitlement': entitlement,
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, from: table => query(table, false) }),
      createServiceClient: async () => ({ from: table => query(table, true) }),
    },
    '@/lib/features': { VIDEO_CALLS_ENABLED: false },
    '@/lib/stripe/server': { stripe: { checkout: { sessions: { create: async params => { checkouts.push(params); return { url: 'https://checkout.stripe.com/synthetic' } } } } } },
    '@/lib/notifications': { createNotification: async () => assert.fail('unexpected notification'), checkNotificationPreference: async () => false },
  })
  return { writes, checkouts, reads, run: () => route.POST({}, { params: Promise.resolve({ id: videoClass.id }) }) }
}

test('group booking cannot issue an entitlement before authentication', async () => {
  const state = fixture({ user: null })
  assert.equal((await state.run()).status, 401)
  assert.deepEqual(state.writes, [])
  assert.deepEqual(state.checkouts, [])
})

test('unpaid, expired, canceled or foreign-tier subscriptions cannot grant a free group seat', async () => {
  for (const subscription of [null, { ...validSub, stripe_livemode: false }, { ...validSub, status: 'canceled' },
    { ...validSub, current_period_end: '2000-01-01T00:00:00Z' },
    { ...validSub, subscription_tiers: { creator_id: 'coach-b' } }]) {
    const state = fixture({ subscription })
    assert.equal((await state.run()).status, 200)
    assert.deepEqual(state.writes, [])
    assert.equal(state.checkouts[0].line_items[0].price_data.unit_amount, 5900)
  }
})

test('trusted paid and server-issued free benefits use only scoped server booking writes', async () => {
  for (const subscription of [validSub, { ...validSub, stripe_livemode: null, stripe_subscription_id: 'free_server-issued' }]) {
    const state = fixture({ subscription })
    assert.equal((await state.run()).status, 200)
    assert.equal(state.writes.length, 1)
    assert.equal(state.writes[0].subscription_id, subscription.id)
    assert.equal(state.writes[0].user_id, 'synthetic-buyer')
    assert.equal(state.writes[0].video_class_id, 'synthetic-class')
    assert.equal(state.writes[0].daily_room_url, null)
    assert.deepEqual(state.checkouts, [])
  }
})

test('coach-controlled zero price remains available without a subscription', async () => {
  const state = fixture({ price: 0 })
  assert.equal((await state.run()).status, 200)
  assert.equal(state.writes[0].price_paid_cents, 0)
  assert.equal(state.writes[0].subscription_id, null)
})

test('capacity validation reads the whole bounded class count and fails closed on read errors', async () => {
  for (const [options, status] of [[{ count: 10 }, 409], [{ countError: { message: 'synthetic' } }, 500]]) {
    const state = fixture(options)
    assert.equal((await state.run()).status, status)
    assert.deepEqual(state.writes, [])
    assert.deepEqual(state.checkouts, [])
    assert.deepEqual(state.reads[0], { table: 'video_class_bookings', privileged: true,
      filters: [['video_class_id', 'synthetic-class'], ['status', 'confirmed']] })
  }
})
