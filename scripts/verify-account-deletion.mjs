import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

// Local source + injected service boundaries only: never reads env or networks.
const require = createRequire(import.meta.url)
const buyer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const coachUser = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const creator = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const tier = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const origin = 'https://www.ardore-health.com'
const privateError = 'private-provider-details-must-not-be-exposed'
function load(path, overrides = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => name in overrides ? overrides[name] : require(name), loaded.exports, loaded)
  return loaded.exports
}
const ownership = load('../src/lib/subscription-cancellation.ts', {
  '@/lib/subscription-entitlement': load('../src/lib/subscription-entitlement.ts'),
})
const sample = (changes = {}) => ({
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', buyer_id: buyer, creator_id: creator, tier_id: tier,
  status: 'active', current_period_end: '2099-01-01T00:00:00Z',
  stripe_subscription_id: 'sub_localDeletion', stripe_livemode: false, ...changes,
})
function fixture(options = {}) {
  const rows = structuredClone(options.rows ?? [sample()])
  const events = [], queries = [], notices = [], imports = []
  const remote = new Map(rows.map(row => [row.stripe_subscription_id, {
    id: row.stripe_subscription_id, livemode: false, status: 'active',
    metadata: { buyer_id: row.buyer_id, creator_id: row.creator_id, tier_id: row.tier_id },
    ...options.remote,
  }]))
  let deleted = false, canceled = 0, retrieved = 0, snapshots = 0, protections = 0
  const service = {
    async rpc(name, args) {
      assert.equal(name, 'account_deletion_storage_clear')
      assert.deepEqual(args, { p_user_id: options.isCreator ? coachUser : buyer })
      events.push('storagePreflight')
      return { data: options.storageOwned ? false : options.storageUnknown ? null : true, error: options.storageError ? { message: privateError } : null }
    },
    from(table) {
      const query = { table, filters: {}, select: null, options: null }
      queries.push(query)
      const result = () => {
        events.push(`read:${table}`)
        if (table === 'creator_profiles') return { data: options.isCreator ? { id: creator, display_name: 'Testcoach' } : null, error: options.creatorError ? { message: privateError } : null }
        if (table === 'subscriptions') {
          snapshots++
          const data = snapshots > 1 && options.changedRows ? options.changedRows : structuredClone(rows)
          return { data: options.nullRows ? null : data, count: options.truncated ? data.length + 1 : data.length, error: options.snapshotError ? { message: privateError } : null }
        }
        if (table === 'payment_orders' && !query.options?.head) return { data: options.order ?? null, error: options.orderError ? { message: privateError } : null }
        if (table === 'bookings') protections++
        return { data: null, count: options.nullCount === table ? null : (options.protectedTable === table || (options.lateProtected && protections > 1) ? 1 : 0),
          error: options.readError === table ? { message: privateError } : null }
      }
      return {
        select(value, opts) { query.select = value; query.options = opts; return this },
        eq(key, value) { query.filters[key] = value; return this },
        or(value) { query.filters.or = value; return this },
        order(value) { query.order = value; return this },
        maybeSingle: async () => result(),
        then(resolve, reject) { return Promise.resolve().then(result).then(resolve, reject) },
        delete() { assert.fail('No manual database deletes are allowed') },
        update() { assert.fail('No manual database updates are allowed') },
      }
    },
    auth: { admin: {
      async getUserById(id) {
        if (deleted && id === (options.isCreator ? coachUser : buyer)) {
          events.push('confirmDeleted')
          if (options.confirmDeleteError) return { data: { user: null }, error: { code: 'unexpected_failure', message: privateError } }
          if (options.deleteNotEffective) return { data: { user: { id } }, error: null }
          return { data: { user: null }, error: { code: 'user_not_found' } }
        }
        events.push('recipient')
        return { data: { user: { id, email: 'fictional@example.invalid' } }, error: options.recipientError ? { message: privateError } : null }
      },
      async deleteUser(id) {
        assert.equal(id, options.isCreator ? coachUser : buyer)
        events.push('deleteUser')
        if (options.deleteThrows) throw new Error(privateError)
        if (!options.deleteError) deleted = true
        return { data: { user: null }, error: options.deleteError ? { message: privateError } : null }
      },
      listUsers() { assert.fail('Do not enumerate the Auth directory') },
    } },
  }
  const provider = { subscriptions: {
    async retrieve(id) {
      events.push(`retrieve:${id}`); retrieved++
      if (options.retrieveError || (options.confirmationError && canceled)) throw new Error(privateError)
      if (options.missingRemote) throw Object.assign(new Error(privateError), { code: 'resource_missing' })
      return structuredClone(remote.get(id))
    },
    async cancel(id, params) {
      events.push(`cancel:${id}`); canceled++
      assert.deepEqual(params, { invoice_now: false, prorate: false })
      if (options.cancelError || options.failCancellation === canceled) throw new Error(privateError)
      if (!options.noProviderChange) remote.get(id).status = 'canceled'
      if (options.timeoutAfterCancel) throw new Error(privateError)
      return structuredClone(remote.get(id))
    },
  } }
  const deletion = load('../src/lib/account-deletion.ts', {
    'server-only': {}, '@/lib/subscription-cancellation': ownership,
    '@/lib/email/send': { async sendSubscriptionCancelledNotice(...args) {
      events.push('notice'); assert.equal(deleted, true); notices.push(args)
      if (options.emailError) throw new Error(privateError)
    } },
  })
  const route = load('../src/app/api/account/delete/route.ts', {
    '@/lib/account-deletion': deletion, '@/lib/app-url': { appOrigin: () => origin },
    '@/lib/supabase/server': {
      async createClient() {
        events.push('auth')
        if (options.clientError) throw new Error(privateError)
        return { auth: { async getUser() { return { data: { user: options.noUser ? null : { id: options.isCreator ? coachUser : buyer } }, error: options.authError ? { message: privateError } : null } } } }
      },
      async createServiceClient() { events.push('service'); return service },
    },
    '@/lib/stripe/server': { stripe: provider },
    '@/lib/stripe/connect-readiness': { configuredStripeLivemode() { imports.push('mode'); if (options.configError) throw new Error(privateError); return false } },
  })
  return {
    events, queries, rows, remote, notices, imports,
    get deleted() { return deleted }, get canceled() { return canceled }, get retrieved() { return retrieved },
    async request(extra = {}) {
      const headers = new Headers({ Origin: origin, 'Content-Type': 'application/json', ...extra.headers })
      for (const key of extra.omit ?? []) headers.delete(key)
      return route.POST(new Request(`${origin}/api/account/delete`, { method: 'POST', headers,
        body: extra.body ?? JSON.stringify({ confirmation: 'LÖSCHEN' }) }))
    },
  }
}
async function response(state, status, extra, deletionMayHaveCompleted = false) {
  const result = await state.request(extra)
  assert.equal(result.status, status)
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  const body = await result.json()
  assert.ok(!JSON.stringify(body).includes(privateError))
  if (status !== 200) {
    if (!deletionMayHaveCompleted) assert.equal(state.deleted, false)
    assert.equal(state.notices.length, 0)
  }
  return body
}

for (const [name, extra, status] of [
  ['missing Origin', { omit: ['origin'] }, 403], ['foreign Origin', { headers: { Origin: 'https://evil.invalid' } }, 403],
  ['cross-site fetch', { headers: { 'sec-fetch-site': 'cross-site' } }, 403],
  ['form request', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 415],
  ['missing content-type', { omit: ['content-type'] }, 415], ['malformed JSON', { body: '{' }, 400],
  ['empty JSON', { body: '{}' }, 400], ['null', { body: 'null' }, 400], ['array', { body: '[]' }, 400],
  ['wrong confirmation', { body: '{"confirmation":"yes"}' }, 400],
  ['actor override', { body: JSON.stringify({ confirmation: 'LÖSCHEN', userId: coachUser }) }, 400],
]) test(`deletion rejects ${name} before authentication or privileged work`, async () => {
  const state = fixture(); await response(state, status, extra); assert.deepEqual(state.events, [])
})

for (const [name, options, status] of [
  ['no session', { noUser: true }, 401], ['auth error', { authError: true }, 401],
  ['auth unavailable', { clientError: true }, 503],
]) test(`deletion rejects ${name} before service access`, async () => {
  const state = fixture(options); await response(state, status)
  assert.ok(!state.events.includes('service')); assert.equal(state.retrieved, 0)
})

for (const table of ['bookings', 'payment_orders', 'payment_settlements', 'coaching_payment_attempts', 'discount_redemptions', 'purchases', 'video_class_bookings']) {
  for (const [name, option, status] of [['existing records', 'protectedTable', 409], ['read failure', 'readError', 503], ['unknown count', 'nullCount', 503]]) {
    test(`${table}: ${name} prevents Stripe access and deletion`, async () => {
      const state = fixture({ [option]: table }); await response(state, status)
      assert.equal(state.retrieved, 0); assert.equal(state.canceled, 0)
    })
  }
}

for (const [name, options] of [
  ['storage preflight error', { storageError: true }], ['storage unknown result', { storageUnknown: true }],
  ['creator read error', { creatorError: true }], ['subscription read error', { snapshotError: true }],
  ['truncated subscriptions', { truncated: true }], ['missing subscription result', { nullRows: true }],
  ['recipient read error', { isCreator: true, recipientError: true }],
]) test(`${name} fails before any provider mutation`, async () => {
  const state = fixture(options); await response(state, 503); assert.equal(state.canceled, 0)
})
test('owned Storage objects require support before Stripe or Auth mutation', async () => {
  const state = fixture({ storageOwned: true }); await response(state, 409)
  assert.equal(state.retrieved, 0); assert.ok(!state.events.includes('deleteUser'))
})

test('duplicate provider references are rejected rather than canceled twice', async () => {
  const state = fixture({ rows: [sample(), sample({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })] })
  await response(state, 409); assert.equal(state.retrieved, 0)
})
test('foreign subscription row cannot be canceled or deleted', async () => {
  const state = fixture({ rows: [sample({ buyer_id: coachUser })] })
  await response(state, 409); assert.equal(state.retrieved, 0)
})
for (const [name, options] of [
  ['Stripe unavailable', { retrieveError: true }], ['Stripe resource missing', { missingRemote: true }],
  ['Stripe cancel fails', { cancelError: true }], ['Stripe confirmation fails', { confirmationError: true }],
  ['Stripe cancellation not effective', { noProviderChange: true }], ['missing Stripe configuration', { configError: true }],
  ['wrong mode', { remote: { livemode: true } }], ['wrong owner', { remote: { metadata: { buyer_id: coachUser } } }],
  ['null paid mode', { rows: [sample({ stripe_livemode: null })] }],
  ['malformed provider ID', { rows: [sample({ stripe_subscription_id: 'invalid' })] }],
]) test(`${name} preserves account/data and sends no premature notices`, async () => {
  const state = fixture({ isCreator: true, ...options }); await response(state, 503)
  assert.ok(!state.events.includes('deleteUser'))
})

test('validate every subscription before canceling the first', async () => {
  const state = fixture({ rows: [sample(), sample({ id: 'second', stripe_subscription_id: 'invalid' })] })
  await response(state, 503); assert.equal(state.canceled, 0)
})
test('partial Stripe success preserves all local recovery data', async () => {
  const state = fixture({ failCancellation: 2, rows: [sample(), sample({ id: 'second', stripe_subscription_id: 'sub_secondDeletion' })] })
  const body = await response(state, 503)
  assert.equal(state.remote.get('sub_localDeletion').status, 'canceled')
  assert.equal(state.remote.get('sub_secondDeletion').status, 'active')
  assert.match(body.error, /Einzelne Abos können bereits beendet sein/)
})
test('ambiguous timeout keeps account; retry reads terminal state without canceling again', async () => {
  const state = fixture({ timeoutAfterCancel: true })
  await response(state, 503); assert.equal(state.canceled, 1)
  await response(state, 200); assert.equal(state.canceled, 1)
})
for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete', 'canceled']) {
  test(`local ${status} does not bypass real Stripe cancellation`, async () => {
    const state = fixture({ rows: [sample({ status })] }); await response(state, 200)
    assert.equal(state.canceled, 1); assert.equal(state.retrieved, 2)
    assert.equal(state.events.at(-1), 'confirmDeleted')
    for (const q of state.queries.filter(q => q.table === 'subscriptions')) {
      assert.deepEqual(q.filters, { or: `buyer_id.eq.${buyer}` }); assert.equal(q.options.count, 'exact')
    }
  })
}
for (const status of ['canceled', 'incomplete_expired']) test(`already terminal provider ${status} is retry-safe`, async () => {
  const state = fixture({ remote: { status } }); await response(state, 200); assert.equal(state.canceled, 0)
})
for (const rows of [[], [sample({ stripe_subscription_id: 'free_local', stripe_livemode: null })]]) {
  test('no paid subscription requires no Stripe configuration or import', async () => {
    const state = fixture({ rows, configError: true }); await response(state, 200)
    assert.deepEqual(state.imports, []); assert.equal(state.retrieved, 0); assert.equal(state.canceled, 0)
  })
}
test('creator cancellation notices follow successful Auth deletion, email failure is not false deletion failure', async () => {
  const state = fixture({ isCreator: true, emailError: true }); await response(state, 200)
  assert.equal(state.notices.length, 1); assert.equal(state.events.at(-1), 'notice')
  assert.equal(state.queries.find(q => q.table === 'subscriptions').filters.or, `buyer_id.eq.${coachUser},creator_id.eq.${creator}`)
  assert.ok(state.queries.some(q => q.table === 'purchases' && q.filters['products.creator_id'] === creator))
  assert.ok(state.queries.some(q => q.table === 'video_class_bookings' && q.filters['video_classes.creator_id'] === creator))
})
for (const options of [{ deleteError: true }, { deleteThrows: true }]) test('Auth deletion failure never follows manual application deletes or sends notices', async () => {
  const state = fixture({ isCreator: true, ...options }); await response(state, 503)
  assert.equal(state.events.filter(e => e === 'deleteUser').length, 1)
  assert.equal(state.deleted, false)
})
for (const options of [{ confirmDeleteError: true }, { deleteNotEffective: true }]) test('unconfirmed Auth deletion is not falsely acknowledged and sends no notice', async () => {
  const state = fixture({ isCreator: true, ...options }); await response(state, 503, undefined, true)
})
test('new financial records observed after Stripe work abort deletion', async () => {
  const state = fixture({ lateProtected: true }); await response(state, 409)
  assert.equal(state.canceled, 1); assert.ok(!state.events.includes('deleteUser'))
})
test('changed subscription bindings abort deletion', async () => {
  const state = fixture({ changedRows: [sample({ stripe_subscription_id: 'sub_changed' })] })
  await response(state, 409); assert.ok(!state.events.includes('deleteUser'))
})
test('client sends server confirmation and synchronously guards repeated deletion', () => {
  const source = readFileSync(new URL('../src/app/creator/settings/DeleteAccountSection.tsx', import.meta.url), 'utf8')
  assert.match(source, /deletingRef\.current\) return/)
  assert.match(source, /JSON\.stringify\(\{ confirmation: CONFIRM_WORD \}\)/)
  assert.match(source, /json\.ok !== true/)
  assert.match(source, /role="alert"/)
})
test('Storage migration is a service-only preflight plus private cascade guard, never an Auth data rewrite', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261018120029_guard_account_storage_deletion.sql', import.meta.url), 'utf8')
  assert.match(sql, /CREATE FUNCTION public\.account_deletion_storage_clear[\s\S]*?SECURITY INVOKER/)
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.account_deletion_storage_clear\(uuid\) FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.account_deletion_storage_clear\(uuid\) TO service_role/)
  assert.match(sql, /BEFORE DELETE ON public\.profiles/)
  assert.match(sql, /object\.owner_id = p_user_id::text OR object\.owner = p_user_id/)
  assert.match(sql, /object\.bucket_id = 'verification-docs'[\s\S]*creator\.user_id = p_user_id[\s\S]*object\.name LIKE creator\.id::text \|\| '\/%'/)
  assert.equal((sql.match(/SET search_path = ''/g) ?? []).length, 3)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+auth\.users/i)
  assert.doesNotMatch(sql, /(?:DELETE FROM|TRUNCATE|DROP TABLE)\s+/i)
})
