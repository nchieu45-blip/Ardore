import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { isolatedCoachingEnv } from './fixtures/isolated-coaching-env.mjs'

function payment(env) {
  const mod = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/coaching-payment.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'exports', 'module', 'process', code)(name => {
    assert.equal(name, 'server-only'); return {}
  }, mod.exports, mod, { env })
  return mod.exports
}
const paid = stripe_livemode => ({ payment_status: 'paid', stripe_livemode })

test('explicit isolated development environment admits only paid TEST and free coaching', () => {
  const p = payment(isolatedCoachingEnv)
  assert.equal(p.isolatedCoachingTestsEnabled(), true)
  assert.equal(p.hasValidCoachingPayment(paid(false)), true)
  assert.equal(p.hasValidCoachingPayment(paid(true)), false)
  assert.equal(p.hasValidCoachingPayment(paid(null)), false)
  assert.equal(p.hasValidCoachingPayment({ payment_status: 'not_required', stripe_livemode: null }), true)
  assert.equal(p.COACHING_PAYMENT_ELIGIBILITY_FILTER, 'payment_status.eq.not_required,and(payment_status.eq.paid,stripe_livemode.eq.false)')
  for (const payment_status of ['pending', 'failed', 'refunded', 'partially_refunded', 'disputed', 'unpaid', 'unknown']) {
    assert.equal(p.hasValidCoachingPayment({ payment_status, stripe_livemode: false }), false)
  }
})

test('every missing isolation requirement defaults to LIVE eligibility and rejects TEST', () => {
  for (const key of Object.keys(isolatedCoachingEnv)) {
    const env = { ...isolatedCoachingEnv }; delete env[key]
    const p = payment(env)
    assert.equal(p.isolatedCoachingTestsEnabled(), false, key)
    assert.equal(p.hasValidCoachingPayment(paid(false)), false, key)
    assert.equal(p.hasValidCoachingPayment(paid(true)), true, key)
    assert.equal(p.COACHING_PAYMENT_ELIGIBILITY_FILTER, 'payment_status.eq.not_required,and(payment_status.eq.paid,stripe_livemode.eq.true)')
  }
})

test('production startup, remote databases/apps, LIVE keys and malformed settings cannot enable TEST', () => {
  const cases = [
    ['NODE_ENV', 'production'], ['NODE_ENV', 'staging'], ['ARDORE_ISOLATED_COACHING_TESTS', 'true'],
    ['STRIPE_SECRET_KEY', 'sk_live_synthetic'], ['STRIPE_SECRET_KEY', 'ci-placeholder'],
    ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_synthetic'],
  ]
  for (const key of ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    for (const value of ['https://www.ardore-health.com', 'https://project.supabase.co', 'http://192.168.1.5:3000',
      'http://127.0.0.1.evil.test:3032', 'http://localhost', 'http://user:pass@127.0.0.1:3032',
      'http://127.0.0.1:3032/path', 'http://127.0.0.1:3032?proxy=production', 'http://127.0.0.1:3032#local', 'invalid']) cases.push([key, value])
  }
  for (const [key, value] of cases) {
    const p = payment({ ...isolatedCoachingEnv, [key]: value })
    assert.equal(p.isolatedCoachingTestsEnabled(), false, `${key}=${value}`)
    assert.equal(p.hasValidCoachingPayment(paid(false)), false)
    assert.equal(p.hasValidCoachingPayment(paid(null)), false)
  }
})

test('explicit test environment supports restricted TEST keys and IPv6 loopback', () => {
  const p = payment({ ...isolatedCoachingEnv, NODE_ENV: 'test', STRIPE_SECRET_KEY: 'rk_test_synthetic',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3032/', NEXT_PUBLIC_SUPABASE_URL: 'http://[::1]:55131' })
  assert.equal(p.isolatedCoachingTestsEnabled(), true)
  assert.equal(p.hasValidCoachingPayment(paid(false)), true)
})
