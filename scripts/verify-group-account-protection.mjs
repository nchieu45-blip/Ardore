// The temporary hold supersedes all account-specific financial preflights.
// Importing any Auth/payment/database dependency fails this isolated fixture.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { NextResponse, NextRequest } = require('next/server')
function load(path, modules) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const fixtureModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)(name => {
    assert.ok(name in modules, `Forbidden service dependency: ${name}`)
    return modules[name]
  }, fixtureModule.exports, fixtureModule)
  return fixtureModule.exports
}
const hold = load('../src/lib/account-deletion-hold.ts', { 'next/server': { NextResponse } })
const route = load('../src/app/api/account/delete/route.ts', { '@/lib/account-deletion-hold': hold })

async function assertHeld(response, head = false) {
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.equal(response.headers.get('x-ardore-account-deletion'), 'paused-v1')
  assert.equal(response.headers.get('set-cookie'), null)
  if (!head) assert.deepEqual(await response.json(), {
    code: 'ACCOUNT_DELETION_PAUSED',
    error: 'Die Kontolöschung ist vorübergehend pausiert. Bitte kontaktiere den Ardore-Support.',
  })
}

test('route stops without reading request, credentials, financial records or providers', async () => {
  assert.deepEqual(Object.keys(route), ['POST'])
  const unreadableRequest = new Proxy({}, { get() { throw new Error('Request must remain unread') } })
  for (let i = 0; i < 20; i++) await assertHeld(await route.POST(unreadableRequest))
})

test('parallel deletion attempts all stop before any service dependency', async () => {
  await Promise.all(Array.from({ length: 100 }, async () => assertHeld(await route.POST())))
})

test('proxy blocks path variants and every method before creating the Auth client', async () => {
  const proxy = load('../src/proxy.ts', {
    'next/server': { NextResponse },
    '@/lib/account-deletion-hold': hold,
    '@/lib/app-url': { appOrigin() { throw new Error('Unexpected origin lookup') } },
    '@supabase/ssr': { createServerClient() { throw new Error('Unexpected Auth call') } },
  }).proxy
  for (const path of ['/api/account/delete', '/api/account/delete/', '/API/ACCOUNT/DELETE', '/api/account/%64elete', '/api/account/delete?x=1']) {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      await assertHeld(await proxy(new NextRequest(`http://localhost${path}`, {
        method, headers: { cookie: 'invalid-session=synthetic', authorization: 'Bearer invalid', origin: 'https://invalid.example' },
      })))
    }
  }
})

test('path matching does not capture unrelated routes or malformed escapes', () => {
  for (const path of ['/api/account/delete-more', '/api/account/deletion', '/buyer', '/api/account/%ZZ']) {
    assert.equal(hold.isAccountDeletionPath(path), false)
  }
})

test('unrelated public, protected and login routes retain existing Auth behavior', async () => {
  for (const user of [null, { id: 'synthetic' }]) {
    let calls = 0
    const proxy = load('../src/proxy.ts', {
      'next/server': { NextResponse }, '@/lib/account-deletion-hold': hold,
      '@/lib/app-url': { appOrigin: () => 'http://localhost' },
      '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => { calls++; return { data: { user } } } } }) },
    }).proxy
    for (const path of ['/', '/buyer/settings', '/creator', '/chat', '/login', '/api/account/delete-more']) {
      const response = await proxy(new NextRequest(`http://localhost${path}`))
      const redirect = (!user && ['/buyer/settings', '/creator', '/chat'].includes(path)) || (user && path === '/login')
      assert.equal(response.status, redirect ? 307 : 200)
      if (redirect) assert.equal(new URL(response.headers.get('location')).pathname, user ? '/' : '/login')
    }
    assert.equal(calls, 6)
  }
})
