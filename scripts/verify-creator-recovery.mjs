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

function findButton(element, label) {
  if (!element || typeof element !== 'object') return null
  if (typeof element.props?.onClick === 'function' && renderToStaticMarkup(element).includes(label)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const button = findButton(child, label)
    if (button) return button
  }
  return null
}

function payoutFixture({ connect = { connected: false, payoutReady: false }, settlements = [], connectGetError = false, settlementsGetError = false } = {}) {
  const states = []
  const effects = []
  const calls = []
  const window = { location: { href: '' } }
  let cursor = 0
  let mounted = false
  let connectResponse = { ok: true, json: async () => ({ url: 'https://connect.stripe.com/setup/example' }) }
  let recoveryResponse = { ok: true, json: async () => ({ checked: 1, settled: 1, held: 0, refunded: 0, failed: 0 }) }
  const PayoutPage = loadPage('src/app/creator/settings/payout/page.tsx', {
    react: {
      ...React,
      useCallback: callback => callback,
      useEffect: effect => { if (!mounted) effects.push(effect) },
      useState: initial => {
        const slot = cursor++
        if (!(slot in states)) states[slot] = initial
        return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
      },
    },
  }, {
    window,
    fetch: async (url, options) => {
      calls.push({ url, options })
      assert.ok(['/api/stripe/connect', '/api/stripe/settlements'].includes(url))
      if (options.method === 'POST') {
        assert.equal(options.body, undefined, 'Financial recovery accepts no client financial/creator inputs')
        const response = url === '/api/stripe/connect' ? connectResponse : recoveryResponse
        if (response instanceof Error) throw response
        return response
      }
      assert.equal(options.cache, 'no-store', 'Payout readiness and settlement views must fetch fresh server values')
      if (url === '/api/stripe/connect') {
        if (connectGetError) throw new Error('Private provider failure')
        return { ok: true, json: async () => connect }
      }
      if (settlementsGetError) throw new Error('Private database failure')
      return { ok: true, json: async () => ({ settlements }) }
    },
  })
  function render() { cursor = 0; const element = PayoutPage(); mounted = true; return element }
  return {
    calls, window, render,
    async mount() {
      render()
      effects.forEach(effect => effect())
      await new Promise(resolve => setImmediate(resolve))
      return render()
    },
    async click(label) {
      const button = findButton(render(), label)
      assert.ok(button, `Missing button: ${label}`)
      await button.props.onClick()
      return render()
    },
    connectResult(response) { connectResponse = response },
    recoveryResult(response) { recoveryResponse = response },
  }
}

const settlement = (state = 'pending', overrides = {}) => ({
  id: 'synthetic-settlement', kind: 'booking', state, grossCents: 10000, feeCents: 1000,
  coachNetCents: 9000, transferredCents: state === 'settled' ? 9000 : 0, refundedCents: 0,
  createdAt: '2026-10-03T12:00:00.000Z', ...overrides,
})

test('payout status uses fresh owner API responses and distinguishes Stripe transfers from bank payouts', async () => {
  const fixture = payoutFixture({ connect: { connected: true, payoutReady: true }, settlements: [settlement('settled')] })
  const html = renderToStaticMarkup(await fixture.mount())
  assert.deepEqual(fixture.calls.map(call => call.url).sort(), ['/api/stripe/connect', '/api/stripe/settlements'])
  assert.match(html, /Stripe Connect bereit/)
  assert.match(html, /Stripe Connect-Angaben öffnen/)
  assert.match(html, /Auf Stripe-Guthaben überwiesen/)
  assert.match(html, /anschließende Bankauszahlung erfolgt durch Stripe/)
  assert.doesNotMatch(html, /Stripe Dashboard öffnen|automatisch auf dein Bankkonto/)
  assert.match(html, /100,00/)
  assert.match(html, /90,00/)
})

test('payout errors recover the connect button, display a safe alert and allow retry', async () => {
  const fixture = payoutFixture()
  await fixture.mount()
  for (const result of [
    { ok: false, json: async () => ({ error: 'Private provider failure' }) },
    { ok: true, json: async () => ({}) },
    { ok: true, json: async () => { throw new Error('Invalid JSON') } },
    { ok: true, json: async () => ({ url: 'invalid' }) },
    { ok: true, json: async () => ({ url: 'http://example.invalid' }) },
    { ok: true, json: async () => ({ url: 'javascript:alert(1)' }) },
    new Error('Private network failure'),
  ]) {
    fixture.connectResult(result)
    const element = await fixture.click('Mit Stripe verbinden')
    assert.equal(findButton(element, 'Mit Stripe verbinden').props.loading, false)
    assert.equal(fixture.window.location.href, '', 'Failure must not navigate')
    const html = renderToStaticMarkup(element)
    assert.match(html, /role="alert"/)
    assert.doesNotMatch(html, /Private (provider|network) failure/)
  }
  fixture.connectResult({ ok: true, json: async () => ({ url: 'https://connect.stripe.com/setup/example' }) })
  const element = await fixture.click('Mit Stripe verbinden')
  assert.equal(findButton(element, 'Mit Stripe verbinden').props.loading, false)
  assert.doesNotMatch(renderToStaticMarkup(element), /role="alert"/)
  assert.equal(fixture.window.location.href, 'https://connect.stripe.com/setup/example')
})

test('payout API loading errors terminate loading and show uncertainty rather than a false ready state', async () => {
  const fixture = payoutFixture({ connectGetError: true, settlementsGetError: true })
  const html = renderToStaticMarkup(await fixture.mount())
  assert.doesNotMatch(html, /Lädt\.\.\.|Stripe Connect bereit|Noch keine Abrechnungen vorhanden|Private/)
  assert.match(html, /Stripe-Status nicht verfügbar/)
  assert.match(html, /Abrechnungen konnten nicht geladen werden/)
  assert.match(html, /role="alert"/)
})

test('open settlements show explicit recovery, recover the retry button after errors and refresh fresh server data', async () => {
  const fixture = payoutFixture({ connect: { connected: true, payoutReady: false }, settlements: [settlement()] })
  const initial = renderToStaticMarkup(await fixture.mount())
  assert.match(initial, /Stripe Connect prüfen|Überweisung ausstehend/)
  assert.match(initial, /Es gibt offene Abrechnungen/)
  for (const response of [
    { ok: false, json: async () => ({ error: 'Private refund failure' }) },
    { ok: true, json: async () => ({ checked: -1, settled: 0, held: 0, refunded: 0, failed: 0 }) },
    new Error('Private recovery failure'),
  ]) {
    fixture.recoveryResult(response)
    const element = await fixture.click('Offene Abrechnungen prüfen')
    assert.equal(findButton(element, 'Offene Abrechnungen prüfen').props.loading, false)
    const html = renderToStaticMarkup(element)
    assert.match(html, /Offene Abrechnungen konnten nicht geprüft werden/)
    assert.doesNotMatch(html, /Private (refund|recovery) failure/)
  }
  const previousGetCount = fixture.calls.filter(call => !call.options.method).length
  fixture.recoveryResult({ ok: true, json: async () => ({ checked: 1, settled: 0, held: 1, refunded: 0, failed: 0 }) })
  const element = await fixture.click('Offene Abrechnungen prüfen')
  assert.equal(findButton(element, 'Offene Abrechnungen prüfen').props.loading, false)
  assert.equal(fixture.calls.filter(call => !call.options.method).length, previousGetCount + 2)
  const html = renderToStaticMarkup(element)
  assert.match(html, /Einige Abrechnungen bleiben offen/)
  assert.doesNotMatch(html, /role="alert"/)
})

test('invalid settlement financial data is not rendered as trusted money or a successful transfer', async () => {
  const fixture = payoutFixture({ settlements: [settlement('settled', { transferredCents: -500 })] })
  const html = renderToStaticMarkup(await fixture.mount())
  assert.match(html, /Abrechnungen konnten nicht geladen werden/)
  assert.doesNotMatch(html, /Auf Stripe-Guthaben überwiesen|100,00|90,00/)
})
