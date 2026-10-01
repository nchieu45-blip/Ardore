import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadRoute(path, modules) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', 'process', compiled)(
    name => modules[name] ?? require(name), loadedModule.exports, loadedModule,
    { env: { NEXT_PUBLIC_APP_URL: 'https://ardore.example.invalid' } },
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
        accounts: {
          async create(input, options) {
            assert.equal(ownerResolved, true)
            calls.accountCreates.push({ input, options })
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { id: 'acct_server_created' }
          },
          async retrieve(id) {
            assert.equal(ownerResolved, true)
            calls.accountReads.push(id)
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { charges_enabled: chargesEnabled, payouts_enabled: payoutsEnabled }
          },
        },
        accountLinks: {
          async create(input) {
            calls.accountLinks.push(input)
            if (stripeError) throw new Error('Secret Stripe provider detail')
            return { url: 'https://connect.stripe.com/setup/synthetic' }
          },
        },
      },
    },
  }
  return { calls, post: loadRoute('src/app/api/stripe/connect/route.ts', modules).POST, get: loadRoute('src/app/api/stripe/connect/callback/route.ts', modules).GET }
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
    values: { stripe_account_id: 'acct_server_created' },
    filters: [['id', 'synthetic-creator'], ['user_id', 'authenticated-owner'], ['stripe_account_id', null]],
    selected: 'id',
  }])
  assert.equal(context.calls.accountCreates[0].input.metadata.ardore_creator_id, 'synthetic-creator')
  assert.equal(context.calls.accountCreates[0].options.idempotencyKey, 'ardore-connect-synthetic-creator')
  assert.equal(context.calls.accountLinks[0].account, 'acct_server_created')
  assert.equal((await response.json()).url, 'https://connect.stripe.com/setup/synthetic')
})

test('Existing Connect account is preserved; client input cannot replace its identity', async () => {
  const context = fixture({ accountId: 'acct_existing_owner' })
  const response = await context.post(new Request('https://example.invalid/api/stripe/connect', {
    method: 'POST', body: JSON.stringify({ stripe_account_id: 'acct_client_injected' }),
  }))
  assert.equal(response.status, 200)
  assert.equal(context.calls.accountCreates.length, 0)
  assert.equal(context.calls.serviceClients, 0)
  assert.equal(context.calls.writes.length, 0)
  assert.equal(context.calls.accountLinks[0].account, 'acct_existing_owner')
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
    const context = fixture({ accountId: 'acct_existing_owner', chargesEnabled, payoutsEnabled })
    const response = await context.get(new Request('https://example.invalid/api/stripe/connect/callback?stripe_account_active=true'))
    assert.equal(response.status, 307)
    assert.deepEqual(context.calls.accountReads, ['acct_existing_owner'])
    assert.deepEqual(context.calls.writes, [{
      values: { stripe_account_active: chargesEnabled && payoutsEnabled },
      filters: [['id', 'synthetic-creator'], ['user_id', 'authenticated-owner'], ['stripe_account_id', 'acct_existing_owner']],
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

test('Read, provider and callback persistence errors fail safely without exposing details', async () => {
  for (const method of ['post', 'get']) {
    for (const [options, status] of [
      [{ readError: { code: '42501', message: 'Secret database detail' } }, 500],
      [{ stripeError: true, accountId: method === 'get' ? 'acct_existing_owner' : null }, 502],
    ]) {
      const context = fixture(options)
      const response = await context[method]()
      assert.equal(response.status, status)
      assert.doesNotMatch(await response.text(), /Secret (database|Stripe provider) detail/)
    }
  }
  for (const [options, status] of [[{ writeError: { message: 'Secret database detail' } }, 500], [{ writeFound: false }, 409]]) {
    const context = fixture({ accountId: 'acct_existing_owner', ...options })
    const response = await context.get()
    assert.equal(response.status, status)
    assert.doesNotMatch(await response.text(), /Secret database detail/)
  }
})
