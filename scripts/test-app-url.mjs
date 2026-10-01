import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

function load(env) {
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/app-url.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'process', code)(mod.exports, { env })
  return mod.exports
}

test('production redirects use the public origin, not the proxy request origin', () => {
  const { appOrigin, safeAuthDestination } = load({ NODE_ENV: 'production' })
  assert.equal(appOrigin(), 'https://www.ardore-health.com')
  assert.equal(safeAuthDestination('/verify-success?flow=signup').href, 'https://www.ardore-health.com/verify-success?flow=signup')
})

test('external, protocol-relative and backslash auth destinations are rejected', () => {
  const { safeAuthDestination } = load({ NODE_ENV: 'production' })
  for (const next of ['https://evil.example', '//evil.example', '/\\evil.example', '/\nevil.example', null]) {
    assert.equal(safeAuthDestination(next).href, 'https://www.ardore-health.com/reset-password')
  }
})

test('shared login path validation rejects URL-normalization escapes and control characters', () => {
  const { isSafeRelativePath, safeAuthDestination } = load({ NODE_ENV: 'production' })
  const invalidPaths = [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/buyer\\settings']
  for (let code = 0; code < 32; code++) {
    invalidPaths.push(`/${String.fromCharCode(code)}/evil.example`)
  }
  for (const path of invalidPaths) {
    assert.equal(isSafeRelativePath(path), false, `Reject ${JSON.stringify(path)}`)
    assert.equal(safeAuthDestination(path).pathname, '/reset-password')
  }
})

test('shared login path validation preserves internal paths, query strings and fragments', () => {
  const { isSafeRelativePath } = load({ NODE_ENV: 'production' })
  for (const path of ['/', '/buyer', '/creator/settings?tab=profile#details', '/products/123?next=https://example.invalid', '/%5C%5Cexample.invalid']) {
    assert.equal(isSafeRelativePath(path), true)
    assert.equal(new URL(path, 'https://www.ardore-health.com').origin, 'https://www.ardore-health.com')
  }
})

test('local development origin works while insecure production config fails closed', () => {
  assert.equal(load({ NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }).appOrigin(), 'http://localhost:3000')
  assert.equal(load({ NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'http://0.0.0.0:3000' }).appOrigin(), 'https://www.ardore-health.com')
})
