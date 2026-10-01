import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const passThrough = ({ children }) => children
const ui = { Button: passThrough, Card: passThrough, CardContent: passThrough, CardHeader: passThrough, Badge: passThrough }

function loadPage(path, overrides, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  const mockedRequire = name => {
    if (name in overrides) return overrides[name]
    if (name.startsWith('@/components/')) return ui
    if (name === '@/lib/purchases') return { VALID_PURCHASE_STATUS: 'paid' }
    if (name === '@/lib/utils') return { formatCurrency: value => `EUR-${value}`, formatDate: value => value }
    if (name === 'next/link') return { __esModule: true, default: passThrough }
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null })
    return require(name)
  }
  new Function('require', 'exports', 'module', 'fetch', 'window', compiled)(
    mockedRequire, loadedModule.exports, loadedModule, globals.fetch, globals.window,
  )
  return loadedModule.exports.default
}

function creatorFixture({ signedIn = true, hasCreator = true, purchaseError = false } = {}) {
  const queries = []
  let ownerResolved = false
  let serviceCalls = 0
  const creator = { id: 'verified-creator', display_name: 'Synthetic creator', slug: 'synthetic', stripe_account_active: true }
  function query(role, table) {
    if (role === 'user') assert.notEqual(table, 'purchases', 'Purchase reporting must use the server client')
    if (role === 'service') assert.equal(table, 'purchases', 'Service access is limited to the purchase report')
    const record = { role, table, selected: null, filters: [] }
    queries.push(record)
    return {
      select(columns) { record.selected = columns; return this },
      eq(column, value) { record.filters.push([column, value]); return this },
      order() { return this },
      async single() {
        assert.equal(table, 'creator_profiles')
        assert.deepEqual(record.filters, [['user_id', 'authenticated-owner']])
        ownerResolved = hasCreator
        return { data: hasCreator ? creator : null, error: null }
      },
      then(resolve, reject) {
        const result = table === 'purchases'
          ? purchaseError
            ? { data: null, error: { message: 'Synthetic database failure' } }
            : { data: [{ amount_paid: 42, created_at: new Date().toISOString(), products: { creator_id: creator.id } }], error: null }
          : { data: [], error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
  }
  return {
    queries,
    get serviceCalls() { return serviceCalls },
    modules: {
      '@/lib/supabase/server': {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'authenticated-owner' } : null } }) },
          from: table => query('user', table),
        }),
        createServiceClient: async () => {
          assert.equal(ownerResolved, true, 'Service access must follow authenticated creator ownership lookup')
          serviceCalls++
          return { from: table => query('service', table) }
        },
      },
      'next/navigation': { redirect: path => { throw new Error(`REDIRECT:${path}`) } },
      '@/components/creator/RevenueChart': { RevenueChart: () => React.createElement('div', { 'data-testid': 'revenue-chart' }) },
    },
  }
}

for (const path of ['src/app/creator/page.tsx', 'src/app/creator/earnings/page.tsx']) {
  test(`${path}: purchase report is owner-scoped, server-only, paid and live`, async () => {
    const fixture = creatorFixture()
    const html = renderToStaticMarkup(await loadPage(path, fixture.modules)())
    const purchaseQuery = fixture.queries.find(query => query.table === 'purchases')
    assert.deepEqual(purchaseQuery, {
      role: 'service', table: 'purchases',
      selected: 'amount_paid, created_at, products!inner(creator_id)',
      filters: [['products.creator_id', 'verified-creator'], ['payment_status', 'paid'], ['stripe_livemode', true]],
    })
    assert.match(html, /EUR-42/)
    assert.doesNotMatch(html, /role="alert"/)
  })

  test(`${path}: report errors are visible and unknown amounts are not displayed as zero`, async () => {
    const fixture = creatorFixture({ purchaseError: true })
    const html = renderToStaticMarkup(await loadPage(path, fixture.modules)())
    assert.match(html, /role="alert"/)
    assert.match(html, /Kaufumsätze konnten nicht geladen werden/)
    assert.match(html, /–/)
    assert.doesNotMatch(html, /Synthetic database failure|data-testid="revenue-chart"/)
  })

  test(`${path}: unauthenticated and noncreator visitors never obtain service access`, async () => {
    for (const [options, destination] of [[{ signedIn: false }, '/login'], [{ hasCreator: false }, '/creator/onboarding']]) {
      const fixture = creatorFixture(options)
      await assert.rejects(loadPage(path, fixture.modules)(), { message: `REDIRECT:${destination}` })
      assert.equal(fixture.serviceCalls, 0)
    }
  })
}

function findConnectHandler(element) {
  if (!element || typeof element !== 'object') return null
  if (typeof element.props?.onClick === 'function') return element.props.onClick
  for (const child of React.Children.toArray(element.props?.children)) {
    const handler = findConnectHandler(child)
    if (handler) return handler
  }
  return null
}

test('payout errors recover the button, display an alert and allow a safe retry', async () => {
  const states = [false, false, false, '']
  let index = 0
  let response
  const window = { location: { href: '' } }
  const PayoutPage = loadPage('src/app/creator/settings/payout/page.tsx', {
    react: {
      ...React, useEffect: () => {},
      useState: () => { const slot = index++; return [states[slot], value => { states[slot] = value }] },
    },
    '@/lib/supabase/client': { createClient: () => ({}) },
  }, {
    window,
    fetch: async (url, options) => {
      assert.equal(url, '/api/stripe/connect')
      assert.equal(options.method, 'POST')
      if (response instanceof Error) throw response
      return response
    },
  })
  function render() { index = 0; return PayoutPage() }
  for (const result of [
    { ok: false, json: async () => ({ error: 'Synthetic failure' }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => { throw new Error('Invalid JSON') } },
    { ok: true, json: async () => ({ url: 'invalid' }) },
    { ok: true, json: async () => ({ url: 'http://example.invalid' }) },
    { ok: true, json: async () => ({ url: 'javascript:alert(1)' }) },
    new Error('Synthetic network failure'),
  ]) {
    response = result
    await findConnectHandler(render())()
    assert.equal(states[2], false, 'Connecting state must recover after failure')
    assert.equal(window.location.href, '', 'Failure must not navigate')
    assert.match(renderToStaticMarkup(render()), /role="alert"/)
  }
  response = { ok: true, json: async () => ({ url: 'https://connect.stripe.com/setup/example' }) }
  await findConnectHandler(render())()
  assert.equal(states[2], false)
  assert.equal(states[3], '')
  assert.equal(window.location.href, 'https://connect.stripe.com/setup/example')
})
