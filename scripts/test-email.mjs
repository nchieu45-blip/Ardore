import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const nativeRequire = createRequire(import.meta.url)
const directory = path.dirname(fileURLToPath(import.meta.url))

function fixture(env = { RESEND_API_KEY: 'test-only', SUPABASE_SERVICE_ROLE_KEY: 'operator-test-only' }) {
  const calls = []
  let result = { data: { id: 'test-email-id' }, error: null }
  const logged = []
  class Resend {
    emails = { send: async (...args) => { calls.push(args); return result } }
  }
  const cache = new Map()
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative)
    const filename = path.join(directory, '..', relative)
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    const mod = { exports: {} }
    const imports = (name) => name === 'resend' ? { Resend }
      : name === '@/lib/email' ? load('src/lib/email/index.ts') : nativeRequire(name)
    new Function('module', 'exports', 'require', 'process', 'Buffer', 'console', compiled)(
      mod, mod.exports, imports, { env }, Buffer,
      { error: (value) => logged.push(value), info: (value) => logged.push(value) },
    )
    cache.set(relative, mod.exports)
    return mod.exports
  }
  return { load, calls, logged, setResult: (value) => { result = value } }
}

test('provider rejection is thrown instead of treated as successful delivery', async () => {
  const f = fixture()
  f.setResult({ data: null, error: { name: 'validation_error', statusCode: 403, message: 'private provider details' } })
  const { sendEmail, EmailDeliveryError } = f.load('src/lib/email/index.ts')
  await assert.rejects(sendEmail({ from: 'test', to: 'test', subject: 'test', text: 'test' }),
    (error) => error instanceof EmailDeliveryError && error.code === 'validation_error' && error.statusCode === 403)
  assert.equal(f.logged.join('').includes('private provider details'), false)
})

test('missing runtime key prevents the provider call', async () => {
  const f = fixture({})
  await assert.rejects(f.load('src/lib/email/index.ts').sendEmail({}), { code: 'missing_api_key' })
  assert.equal(f.calls.length, 0)
})

test('diagnostic refuses unauthenticated and wrong credentials without sending', async () => {
  const f = fixture()
  const route = f.load('src/app/api/admin/email-test/route.ts')
  for (const auth of ['', 'Bearer wrong', 'Bearer operator-test-onlz']) {
    const req = new Request('https://example.test', { method: 'POST', headers: { authorization: auth } })
    assert.equal((await route.POST(req)).status, 401)
    assert.equal((await route.GET(req)).status, 401)
  }
  assert.equal(f.calls.length, 0)
})

test('diagnostic has fixed test recipient, existing sender and retry idempotency', async () => {
  const f = fixture()
  const route = f.load('src/app/api/admin/email-test/route.ts')
  const req = new Request('https://example.test', {
    method: 'POST', headers: { authorization: 'Bearer operator-test-only' },
    body: JSON.stringify({ to: 'real-customer@example.test', from: 'attacker@example.test' }),
  })
  const runtime = await (await route.GET(req)).json()
  assert.equal(runtime.resendKeyPresent, true)
  assert.equal(f.calls.length, 0)
  const result = await (await route.POST(req)).json()
  assert.equal(result.accepted, true)
  assert.equal(result.emailId, 'test-email-id')
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0].to, 'delivered@resend.dev')
  assert.equal(f.calls[0][0].from, 'Ardore <noreply@ardore-health.com>')
  assert.match(f.calls[0][1].idempotencyKey, /^ardore-production-email-test-\d{4}-\d{2}-\d{2}$/)
  assert.equal(JSON.stringify(result).includes('operator-test-only'), false)
})

test('diagnostic returns a safe failure and runtime presence when Resend rejects', async () => {
  const f = fixture()
  f.setResult({ data: null, error: { name: 'restricted_api_key', statusCode: 401, message: 'private details' } })
  const response = await f.load('src/app/api/admin/email-test/route.ts').POST(new Request('https://example.test', {
    method: 'POST', headers: { authorization: 'Bearer operator-test-only' },
  }))
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { accepted: false, resendKeyPresent: true, error: 'restricted_api_key', providerStatus: 401 })
})
