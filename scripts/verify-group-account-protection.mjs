// Actual deletion orchestration with fictional data and forbidden side effects.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function fixture({ creator = true, creatorError = false, groupCount = 0, groupError = false,
  bookingCount = 0, agreementCount = 0, agreementError = false } = {}) {
  const queries = [], effects = []
  const service = {
    async rpc(name) {
      if (name === 'account_deletion_release_ready') return { data: true, error: null }
      if (name === 'begin_account_deletion') return { data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null }
      if (name === 'account_deletion_storage_clear') return { data: true, error: null }
      assert.equal(name, 'release_account_deletion')
      return { data: true, error: null }
    },
    from(table) {
      const entry = { table, filters: {} }; queries.push(entry)
      return {
        select() { return this }, eq(key, value) { entry.filters[key] = value; return this },
        or(value) { entry.filters.or = value; return this },
        async maybeSingle() { return { data: creator ? { id: 'coach', display_name: 'Local coach' } : null,
          error: creatorError ? { message: 'private preflight error' } : null } },
        then(resolve, reject) { return Promise.resolve({ count: table === 'group_booking_reservations' ? groupCount
          : table === 'video_class_occurrences' ? agreementCount : table === 'bookings' ? bookingCount : 0,
          error: (table === 'group_booking_reservations' && groupError) || (table === 'video_class_occurrences' && agreementError)
            ? { message: 'private preflight error' } : null }).then(resolve, reject) },
        delete() { effects.push('delete'); assert.fail('No manual deletes') },
      }
    },
    auth: { admin: { deleteUser() { effects.push('auth-delete'); assert.fail('No Auth deletion') } } },
  }
  const modules = { 'server-only': {}, '@/lib/subscription-cancellation': {
    ownedProviderSubscription() { effects.push('stripe'); assert.fail('No Stripe lookup') },
  } }
  const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/account-deletion.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const fixtureModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)(name => {
    assert.ok(name in modules, `Forbidden dependency ${name}`); return modules[name]
  }, fixtureModule.exports, fixtureModule)
  return { queries, effects, run: () => fixtureModule.exports.deleteAccountSafely({ service, userId: 'buyer',
    getProvider() { effects.push('stripe'); assert.fail('No Stripe configuration') } }) }
}
async function blocked(options, status) {
  const state = fixture(options)
  await assert.rejects(state.run(), e => e.status === status && !e.message.includes('private preflight'))
  assert.deepEqual(state.effects, [])
  return state
}
test('paid and free group reservation history protects buyer and coach before any provider action', async () => {
  for (const creator of [false, true]) {
    const state = await blocked({ creator, groupCount: 1 }, 409)
    assert.equal(state.queries.find(q => q.table === 'group_booking_reservations').filters.or,
      `buyer_id.eq.buyer${creator ? ',creator_id.eq.coach' : ''}`)
  }
})
test('unknown group financial scope fails closed before account-deletion effects', async () => {
  for (const options of [{ creatorError: true }, { groupError: true }, { groupCount: null }]) await blocked(options, 503)
})
test('existing 1:1 records remain protected after clear group preflight', async () => {
  await blocked({ bookingCount: 1 }, 409)
})
test('coach host-initialized occurrence without participants blocks deletion before side effects', async () => {
  const state = await blocked({ agreementCount: 1 }, 409)
  assert.equal(state.queries.find(q => q.table === 'video_class_occurrences').filters['video_classes.creator_id'], 'coach')
})
test('free subscription-backed reservation and unknown occurrence state both fail closed', async () => {
  await blocked({ creator: false, groupCount: 1 }, 409)
  for (const options of [{ agreementCount: null }, { agreementError: true }]) await blocked(options, 503)
})
