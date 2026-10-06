import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const passThrough = ({ children }) => children
const ui = { Button: passThrough, ButtonLink: passThrough, Avatar: passThrough, CoachDayOverview: passThrough, Card: passThrough, CardContent: passThrough, CardHeader: passThrough, Badge: passThrough }

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
  let ownerResolved = false, calls = 0
  const creator = { id: 'verified-creator', display_name: 'Synthetic creator', slug: 'synthetic', stripe_account_active: true }
  const client = { auth: { getUser: async () => ({ data: { user: signedIn ? { id: 'authenticated-owner' } : null } }) }, from(table) {
    const filters = []
    const single = async () => { assert.equal(table, 'creator_profiles'); assert.deepEqual(filters, [['user_id', 'authenticated-owner']]); ownerResolved = hasCreator; return { data: hasCreator ? creator : null } }
    return { select() { return this }, eq(k,v) { filters.push([k,v]); return this }, order() { return this }, in() { return this }, gte() { return this }, lt() { return this }, limit() { return this }, single, maybeSingle: single, then(resolve) { resolve({ data: [] }) } }
  } }
  const totals = {payments:1,gross:4200,refunded:0,retained:4200,fee:420,net:3780,transferred:3780,pending:0,reversalPending:0,reversed:0,refundPending:0}
  const report = {all:totals,month:totals,sources:{products:totals,booking:{...totals,payments:0},subscription:{...totals,payments:0}},days:[],testMode:true,legacy:{products:0,bookings:0,subscriptions:0,knownProductGross:0,knownBookingGross:0,unclear:0}}
  return { get serviceCalls() { return calls }, modules: {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/coach-earnings-server': { loadCoachEarnings: async (passedClient, userId) => { assert.equal(passedClient,client); assert.equal(userId,'authenticated-owner'); assert.ok(ownerResolved); calls++; if(purchaseError)throw new Error('Private database failure'); return report } },
    '@/components/creator/EarningsSummary': {__esModule:true,default:loadPage('src/components/creator/EarningsSummary.tsx',{})},
    'next/navigation': { redirect: path => { throw new Error(`REDIRECT:${path}`) } },
    '@/components/creator/RevenueChart': { RevenueChart: () => React.createElement('div', { 'data-testid': 'revenue-chart' }) },
  } }
}
for (const path of ['src/app/creator/page.tsx', 'src/app/creator/earnings/page.tsx']) {
  test(`${path}: uses the shared report only after authenticated ownership and never adds a monthly rate`, async () => {
    const fixture = creatorFixture(), html = renderToStaticMarkup(await loadPage(path, fixture.modules)())
    assert.equal(fixture.serviceCalls,1);assert.match(html,/42,00/);assert.match(html,/37,80/);assert.match(html,/Settlement-Ledger/);assert.match(html,/Stripe-Testmodus/);assert.doesNotMatch(html,/role="alert"|Gesamtumsatz|Monatlich \(Abos\)/)
  })
  test(`${path}: financial read failures suppress all money values and show a clear recovery error`, async () => {
    const fixture = creatorFixture({purchaseError:true}), html=renderToStaticMarkup(await loadPage(path,fixture.modules)())
    assert.match(html,/role="alert"/);assert.match(html,/Einnahmen konnten nicht vollständig geladen werden/);assert.doesNotMatch(html,/42,00|37,80|0,00|Private database failure|data-testid="revenue-chart"/)
  })
  test(`${path}: unauthenticated and noncreator visitors never obtain service access`, async () => {
    for (const [options,destination] of [[{signedIn:false},'/login'],[{hasCreator:false},'/creator/onboarding']]) { const f=creatorFixture(options);await assert.rejects(loadPage(path,f.modules)(),{message:`REDIRECT:${destination}`});assert.equal(f.serviceCalls,0) }
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
