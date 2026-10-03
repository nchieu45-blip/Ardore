import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadRoute(path, modules) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => modules[name] ?? (name === '@/lib/stripe/connect-readiness' ? loadRoute('src/lib/stripe/connect-readiness.ts', modules) : require(name)), loadedModule.exports, loadedModule,
    { env: { NEXT_PUBLIC_APP_URL: 'https://ardore.example.invalid', STRIPE_SECRET_KEY: 'sk_test_synthetic' } },
  )
  return loadedModule.exports
}

function fixture({
  authenticated = true,
  creatorFound = true,
  accountId = null,
  readError = null,
  writeError = null,
  writeFound = true,
  stripeError = false,
  chargesEnabled = true,
  payoutsEnabled = true,
  detailsSubmitted = true,
  transfers = 'active',
  cardPayments = 'active',
  pastDue = [],
  disabledReason = null,
  metadataCreator = 'synthetic-creator',
  livemode = false,
  v2Closed = false,
} = {}) {
  const calls = { writes: [], accountCreates: [], accountLinks: [], accountReads: [], serviceClients: 0 }
  const creator = { id: 'synthetic-creator', stripe_account_id: accountId }
  let ownerResolved = false
  const modules = {
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'authenticated-owner', email: 'synthetic@example.invalid' } : null } }) },
        from(table) {
          assert.equal(table, 'creator_profiles')
          return {
            select(columns) {
              assert.equal(columns, 'id, stripe_account_id')
              return {
                eq(column, value) {
                  assert.equal(column, 'user_id')
                  assert.equal(value, 'authenticated-owner')
                  return {
                    async single() {
                      ownerResolved = authenticated && creatorFound && !readError
                      return { data: creatorFound ? creator : null, error: readError }
                    },
                  }
                },
              }
            },
            update() { assert.fail('Authority writes must not use the client session') },
          }
        },
      }),
      createServiceClient: async () => {
        assert.equal(ownerResolved, true, 'Service access requires authenticated creator ownership first')
        calls.serviceClients++
        return {
          from(table) {
            assert.equal(table, 'creator_profiles')
            return {
              update(values) {
                const write = { values, filters: [], selected: null }
                calls.writes.push(write)
                return {
                  eq(column, value) { write.filters.push([column, value]); return this },
                  is(column, value) { write.filters.push([column, value]); return this },
                  select(columns) { write.selected = columns; return this },
                  async maybeSingle() { return { data: writeFound ? { id: creator.id } : null, error: writeError } },
                }
              },
            }
          },
        }
      },
    },
    '@/lib/stripe/server': {
      stripe: {
        v2: { core: { accounts: {
          async create(input, options) {
            assert.equal(ownerResolved, true)
            calls.accountCreates.push({ input, options })
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { id: 'acct_servercreated', metadata: { ardore_creator_id: metadataCreator }, livemode, closed: v2Closed }
          },
          async retrieve(id) {
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { id, metadata: { ardore_creator_id: metadataCreator }, livemode, closed: v2Closed, applied_configurations: ['merchant', 'recipient'] }
          },
        }, accountLinks: {
          async create(input) {
            calls.accountLinks.push(input)
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { account: input.account, livemode, url: 'https://connect.stripe.com/setup/synthetic' }
          },
        } } },
        accounts: {
          async retrieve(id) {
            assert.equal(ownerResolved, true)
            calls.accountReads.push(id)
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { id, metadata: { ardore_creator_id: metadataCreator }, charges_enabled: chargesEnabled, payouts_enabled: payoutsEnabled, details_submitted: detailsSubmitted, capabilities: { card_payments: cardPayments, transfers }, requirements: { past_due: pastDue, disabled_reason: disabledReason } }
          },
        },
      },
    },
  }
  const route = loadRoute('src/app/api/stripe/connect/route.ts', modules)
  return { calls, post: route.POST, status: route.GET, get: loadRoute('src/app/api/stripe/connect/callback/route.ts', modules).GET }
}

test('Unauthenticated/noncreator requests cannot obtain Stripe or service access', async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ creatorFound: false }, 404]]) {
    for (const method of ['post', 'get']) {
      const context = fixture(options)
      const response = await context[method]()
      assert.equal(response.status, status)
      assert.deepEqual(context.calls, { writes: [], accountCreates: [], accountLinks: [], accountReads: [], serviceClients: 0 })
    }
  }
})

test('New Stripe account comes from Stripe and is persisted only to the authenticated creator', async () => {
  const context = fixture()
  const response = await context.post(new Request('https://example.invalid/api/stripe/connect', {
    method: 'POST', body: JSON.stringify({ stripe_account_id: 'acct_client_injected', stripe_account_active: true, price: 1 }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(context.calls.writes, [{
    values: { stripe_account_id: 'acct_servercreated', stripe_account_active: false },
    filters: [['id', 'synthetic-creator'], ['user_id', 'authenticated-owner'], ['stripe_account_id', null]],
    selected: 'id',
  }])
  assert.equal(context.calls.accountCreates[0].input.metadata.ardore_creator_id, 'synthetic-creator')
  assert.equal(context.calls.accountCreates[0].input.dashboard, 'express')
  assert.deepEqual(context.calls.accountCreates[0].input.defaults.responsibilities, { fees_collector: 'application', losses_collector: 'application' })
  assert.deepEqual(context.calls.accountCreates[0].input.configuration, {
    merchant: { capabilities: { card_payments: { requested: true } } },
    recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
  })
  assert.equal(context.calls.accountCreates[0].options.idempotencyKey, 'ardore-connect-v2-synthetic-creator')
  assert.equal(context.calls.accountLinks[0].account, 'acct_servercreated')
  assert.deepEqual(context.calls.accountLinks[0].use_case, {
    type: 'account_onboarding', account_onboarding: {
      configurations: ['merchant', 'recipient'],
      refresh_url: 'https://ardore.example.invalid/creator/settings/payout',
      return_url: 'https://ardore.example.invalid/api/stripe/connect/callback',
    },
  })
  assert.equal((await response.json()).url, 'https://connect.stripe.com/setup/synthetic')
})

test('Existing Connect account is preserved; client input cannot replace its identity', async () => {
  const context = fixture({ accountId: 'acct_existingowner' })
  const response = await context.post(new Request('https://example.invalid/api/stripe/connect', {
    method: 'POST', body: JSON.stringify({ stripe_account_id: 'acct_client_injected' }),
  }))
  assert.equal(response.status, 200)
  assert.equal(context.calls.accountCreates.length, 0)
  assert.equal(context.calls.serviceClients, 0)
  assert.equal(context.calls.writes.length, 0)
  assert.equal(context.calls.accountLinks[0].account, 'acct_existingowner')
})

test('Persistence failure or competing account assignment cannot produce an account link', async () => {
  for (const [options, status] of [[{ writeError: { message: 'Secret database detail' } }, 500], [{ writeFound: false }, 409]]) {
    const context = fixture(options)
    const response = await context.post()
    assert.equal(response.status, status)
    assert.equal(context.calls.accountLinks.length, 0)
    assert.doesNotMatch(await response.text(), /Secret database detail/)
  }
})

test('Callback derives eligibility exclusively from Stripe and scopes the current account', async () => {
  for (const [chargesEnabled, payoutsEnabled] of [[true, true], [true, false], [false, true], [false, false]]) {
    const context = fixture({ accountId: 'acct_existingowner', chargesEnabled, payoutsEnabled })
    const response = await context.get(new Request('https://example.invalid/api/stripe/connect/callback?stripe_account_active=true'))
    assert.equal(response.status, 307)
    assert.deepEqual(context.calls.accountReads, ['acct_existingowner'])
    assert.deepEqual(context.calls.writes, [{
      values: { stripe_account_active: chargesEnabled && payoutsEnabled },
      filters: [['id', 'synthetic-creator'], ['user_id', 'authenticated-owner'], ['stripe_account_id', 'acct_existingowner']],
      selected: 'id',
    }])
  }
})

test('Callback without an account cannot change payout eligibility', async () => {
  const context = fixture()
  assert.equal((await context.get()).status, 307)
  assert.equal(context.calls.serviceClients, 0)
  assert.equal(context.calls.writes.length, 0)
  assert.equal(context.calls.accountReads.length, 0)
})

test('Callback caches false for restricted, incomplete, or closed provider accounts', async () => {
  for (const options of [{ detailsSubmitted: false }, { transfers: 'inactive' }, { cardPayments: 'inactive' }, { pastDue: ['identity'] }, { disabledReason: 'rejected.fraud' }, { v2Closed: true }]) {
    const context = fixture({ accountId: 'acct_existingowner', ...options })
    assert.equal((await context.get()).status, 307)
    assert.equal(context.calls.writes[0].values.stripe_account_active, false)
  }
})

test('Wrong owner or Stripe mode never opens another account or updates its cached status', async () => {
  for (const options of [{ metadataCreator: 'other-creator' }, { livemode: true }]) {
    for (const method of ['post', 'get', 'status']) {
      const context = fixture({ accountId: 'acct_existingowner', ...options })
      assert.equal((await context[method]()).status, 409)
      assert.equal(context.calls.accountLinks.length, 0)
      assert.equal(context.calls.writes.length, 0)
    }
  }
})

test('Owner status endpoint reads fresh payout readiness without writes or exposed account details', async () => {
  for (const [options, expected] of [[{}, { connected: false, payoutReady: false }], [{ accountId: 'acct_existingowner' }, { connected: true, payoutReady: true }], [{ accountId: 'acct_existingowner', payoutsEnabled: false }, { connected: true, payoutReady: false }]]) {
    const context = fixture(options)
    const response = await context.status()
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), expected)
    assert.equal(context.calls.writes.length, 0)
    assert.equal(context.calls.serviceClients, 0)
  }
})

test('Owner status endpoint requires authentication and creator ownership', async () => {
  for (const [options, expected] of [[{ authenticated: false }, 401], [{ creatorFound: false }, 404]]) {
    const context = fixture(options)
    assert.equal((await context.status()).status, expected)
    assert.equal(context.calls.accountReads.length, 0)
    assert.equal(context.calls.writes.length, 0)
  }
})

test('Read, provider and callback persistence errors fail safely without exposing details', async () => {
  for (const method of ['post', 'get']) {
    for (const [options, status] of [
      [{ readError: { code: '42501', message: 'Secret database detail' } }, 500],
      [{ stripeError: true, accountId: method === 'get' ? 'acct_existingowner' : null }, method === 'get' ? 503 : 502],
    ]) {
      const context = fixture(options)
      const response = await context[method]()
      assert.equal(response.status, status)
      assert.doesNotMatch(await response.text(), /Secret (database|Stripe provider) detail/)
    }
  }
  for (const [options, status] of [[{ writeError: { message: 'Secret database detail' } }, 500], [{ writeFound: false }, 409]]) {
    const context = fixture({ accountId: 'acct_existingowner', ...options })
    const response = await context.get()
    assert.equal(response.status, status)
    assert.doesNotMatch(await response.text(), /Secret database detail/)
  }
})
