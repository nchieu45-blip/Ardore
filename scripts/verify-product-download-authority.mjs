import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/app/api/products/[id]/download/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const creatorId = '00000000-0000-4000-8000-000000000001'
const otherCreatorId = '00000000-0000-4000-8000-000000000002'
const baseUrl = 'https://synthetic.supabase.co/storage/v1/object'

function fixture({ authenticated = true, purchaseFound = true, fileUrl = `${baseUrl}/public/products/${creatorId}/ebook.pdf`, signingError = false } = {}) {
  const calls = { purchaseFilters: [], productFilters: [], signs: [], serviceClients: 0 }
  const modules = {
    '@/lib/purchases': { VALID_PURCHASE_STATUS: 'paid' },
    '@/lib/supabase/server': {
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'synthetic-buyer' } : null } }) },
        from(table) {
          assert.equal(table, 'purchases')
          return {
            select(columns) { assert.equal(columns, 'id'); return this },
            eq(column, value) { calls.purchaseFilters.push([column, value]); return this },
            async maybeSingle() { return { data: purchaseFound ? { id: 'trusted-purchase' } : null } },
          }
        },
      }),
      createServiceClient: async () => {
        assert.equal(authenticated && purchaseFound, true, 'Service access must follow an authenticated paid entitlement')
        calls.serviceClients++
        return {
          from(table) {
            assert.equal(table, 'products')
            return {
              select(columns) { assert.equal(columns, 'file_url, creator_id'); return this },
              eq(column, value) { calls.productFilters.push([column, value]); return this },
              async maybeSingle() { return { data: fileUrl ? { file_url: fileUrl, creator_id: creatorId } : null } },
            }
          },
          storage: {
            from(bucket) {
              assert.equal(bucket, 'products')
              return {
                async createSignedUrl(path, expiry) {
                  calls.signs.push({ path, expiry })
                  return signingError
                    ? { data: null, error: { message: 'Secret storage failure' } }
                    : { data: { signedUrl: 'https://synthetic.supabase.co/storage/v1/object/sign/products/synthetic?token=synthetic' }, error: null }
                },
              }
            },
          },
        }
      },
    },
  }
  const loadedModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)(name => modules[name] ?? require(name), loadedModule.exports, loadedModule)
  return { calls, get: () => loadedModule.exports.GET(new Request('https://example.invalid/api/products/synthetic/download'), { params: Promise.resolve({ id: 'synthetic-product' }) }) }
}

test('Download requires a paid live purchase scoped to the authenticated buyer and exact product', async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ purchaseFound: false }, 404]]) {
    const context = fixture(options)
    assert.equal((await context.get()).status, status)
    assert.equal(context.calls.serviceClients, 0)
    assert.equal(context.calls.signs.length, 0)
  }
  const context = fixture()
  assert.equal((await context.get()).status, 307)
  assert.deepEqual(context.calls.purchaseFilters, [
    ['buyer_id', 'synthetic-buyer'], ['product_id', 'synthetic-product'], ['payment_status', 'paid'], ['stripe_livemode', true],
  ])
  assert.deepEqual(context.calls.productFilters, [['id', 'synthetic-product']])
  assert.deepEqual(context.calls.signs, [{ path: `${creatorId}/ebook.pdf`, expiry: 60 }])
})

test('Owner-folder files remain downloadable for all existing public/sign/authenticated URL formats', async () => {
  for (const format of ['public', 'sign', 'authenticated']) {
    const context = fixture({ fileUrl: `${baseUrl}/${format}/products/${creatorId}/nested/Mein%20Yoga%20Buch.pdf?token=old` })
    assert.equal((await context.get()).status, 307)
    assert.deepEqual(context.calls.signs, [{ path: `${creatorId}/nested/Mein Yoga Buch.pdf`, expiry: 60 }])
  }
})

test('A paid entitlement for one product never authorizes another creator folder', async () => {
  for (const fileUrl of [
    `${baseUrl}/public/products/${otherCreatorId}/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}-suffix/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}/../${otherCreatorId}/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}/%2e%2e/${otherCreatorId}/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}/%2e%2e%2f${otherCreatorId}/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}/%252e%252e%252f${otherCreatorId}/secret.pdf`,
    `${baseUrl}/public/products/${creatorId}/%5c..%5c${otherCreatorId}/secret.pdf`,
  ]) {
    const context = fixture({ fileUrl })
    assert.equal((await context.get()).status, 500)
    assert.equal(context.calls.signs.length, 0)
  }
})

test('Malformed path/query/control syntax cannot reach the privileged signer', async () => {
  for (const fileUrl of [
    'not a URL',
    `${baseUrl}/public/products/${creatorId}`,
    `${baseUrl}/public/products/${creatorId}//book.pdf`,
    `${baseUrl}/public/products/${creatorId}/%00book.pdf`,
    `${baseUrl}/public/products/${creatorId}/%3fbook.pdf`,
    `${baseUrl}/public/products/${creatorId}/%23book.pdf`,
    `${baseUrl}/public/products/${creatorId}/%book.pdf`,
    `${baseUrl}/public/avatars/${creatorId}/book.pdf`,
    `https://example.invalid/prefix/storage/v1/object/public/products/${creatorId}/book.pdf`,
  ]) {
    const context = fixture({ fileUrl })
    assert.equal((await context.get()).status, 500)
    assert.equal(context.calls.signs.length, 0)
  }
})

test('Missing product data and storage failures do not leak storage error details', async () => {
  const absent = fixture({ fileUrl: null })
  assert.equal((await absent.get()).status, 404)
  assert.equal(absent.calls.signs.length, 0)
  const failed = fixture({ signingError: true })
  const response = await failed.get()
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /Secret storage failure/)
})
