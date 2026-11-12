import assert from 'node:assert/strict'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/app/api/admin/stripe-test/route.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})

function fixture(secret, retrieveCurrent) {
  const exports = {}
  const imports = name => {
    if (name === 'node:crypto') return { timingSafeEqual }
    assert.equal(name, '@/lib/stripe/server')
    return { stripe: { accounts: { retrieveCurrent } } }
  }
  new Function('require', 'exports', 'process', outputText)(imports, exports, {
    env: { SUPABASE_SERVICE_ROLE_KEY: secret },
  })
  return authorization => exports.GET(new Request('http://localhost/api/admin/stripe-test', {
    headers: authorization ? { authorization } : {},
  }))
}

test('Stripe diagnostic rejects missing or incorrect credentials before calling Stripe', async () => {
  for (const [secret, authorization] of [[undefined, 'Bearer fixture'], ['fixture', undefined], ['fixture', 'Bearer wrongxx'], ['fixture', 'Bearer short']]) {
    let calls = 0
    const response = await fixture(secret, () => { calls++ })(authorization)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(calls, 0)
  }
})

test('Stripe diagnostic makes one account lookup and returns only its request ID', async () => {
  let calls = 0
  const response = await fixture('fixture', (params, options) => {
    calls++
    assert.deepEqual(params, {})
    assert.deepEqual(options, { timeout: 5000, maxNetworkRetries: 0 })
    return { id: 'acct_fixture', lastResponse: { requestId: 'req_fixture' } }
  })('Bearer fixture')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { requestId: 'req_fixture' })
  assert.equal(calls, 1)
})

test('Stripe diagnostic omits provider error details and rejects an unusable request ID', async () => {
  const failure = await fixture('fixture', () => { throw new Error('provider details') })('Bearer fixture')
  assert.equal(failure.status, 502)
  assert.deepEqual(await failure.json(), { error: 'Stripe account check failed' })
  const invalid = await fixture('fixture', () => ({ lastResponse: { requestId: 'invalid' } }))('Bearer fixture')
  assert.equal(invalid.status, 502)
  assert.deepEqual(await invalid.json(), { error: 'Stripe request ID unavailable' })
})
