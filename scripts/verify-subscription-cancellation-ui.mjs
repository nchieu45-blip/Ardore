// Local-only presentation and interaction fixtures. No provider, database or email calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const require = createRequire(import.meta.url)
const source = ts.transpileModule(readFileSync(new URL('../src/components/subscriptions/SubscriptionCancellation.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const props = { subscriptionId: 'synthetic-subscription', creatorName: 'Synthetischer Testcoach' }
const paid = { kind: 'paid', state: 'available', endsAt: '2026-12-01T12:00:00Z', accessUntil: '2026-12-01T12:00:00Z' }
const success = value => ({ ok: true, status: 200, json: async () => value })
const failure = status => ({ ok: false, status, json: async () => ({ error: 'Must not be reflected blindly' }) })

function find(element, label) {
  if (!element || typeof element !== 'object') return null
  if (typeof element.props?.onClick === 'function' && React.Children.toArray(element.props.children).includes(label)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const result = find(child, label)
    if (result) return result
  }
  return null
}

function harness(responses = [], properties = {}) {
  const states = []
  const refs = []
  const requests = []
  let stateIndex = 0
  let refIndex = 0
  let idIndex = 0
  let refreshes = 0
  const loaded = { exports: {} }
  const hooks = {
    ...React,
    useEffect() {},
    useId: () => `synthetic-${idIndex++}`,
    useRef(initial) {
      const slot = refIndex++
      refs[slot] ??= { current: initial }
      return refs[slot]
    },
    useState(initial) {
      const slot = stateIndex++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
  }
  const fetch = async (url, options) => {
    requests.push({ url, options })
    assert.ok(responses.length > 0, 'Every request must use an explicit local fixture')
    const next = responses.shift()
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  }
  const dependency = name => {
    if (name === 'react') return hooks
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++ } }) }
    if (name === '@/components/ui/Button') return loadUiComponent('src/components/ui/Button.tsx')
    return require(name)
  }
  new Function('require', 'exports', 'module', 'fetch', 'window', source)(dependency, loaded.exports, loaded, fetch, {
    setTimeout, clearTimeout,
  })
  function render() {
    stateIndex = 0; refIndex = 0; idIndex = 0
    return loaded.exports.SubscriptionCancellation({ ...props, ...properties })
  }
  return {
    requests,
    render,
    html: () => renderToStaticMarkup(render()),
    get refreshes() { return refreshes },
    click(label) {
      const target = find(render(), label)
      assert.ok(target, `Expected action: ${label}`)
      target.props.onClick()
    },
    async settle() { await new Promise(resolve => setImmediate(resolve)) },
  }
}

test('cancellation is lazy, with no provider requests or mutation before explicit inspection', () => {
  const fixture = harness()
  assert.match(fixture.html(), /Abo kündigen/)
  assert.equal(fixture.requests.length, 0)
  assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
  assert.doesNotMatch(fixture.html(), /Kündigung vorgemerkt|Abo beendet|role="dialog"/)
})

test('paid cancellation explicitly confirms dates, retained access and no automatic refund', async () => {
  const fixture = harness([success(paid), success({ ...paid, state: 'scheduled' })])
  fixture.click('Abo kündigen')
  await fixture.settle()
  assert.equal(fixture.requests[0].options.method, 'GET')
  assert.match(fixture.html(), /Abo zum Laufzeitende kündigen\?/)
  assert.match(fixture.html(), /1\. Dezember 2026.*13:00 Uhr \(Berlin\)/)
  assert.match(fixture.html(), /bereits freigeschalteter Zugriff bleibt/)
  assert.match(fixture.html(), /keine automatische Erstattung/)
  assert.match(fixture.html(), /offene Rechnungen.*nicht aufgehoben/)
  fixture.click('Zum Laufzeitende kündigen')
  await fixture.settle()
  assert.equal(fixture.requests[1].url, '/api/subscriptions/synthetic-subscription/cancel')
  assert.deepEqual(JSON.parse(fixture.requests[1].options.body), {})
  assert.equal(fixture.requests[1].options.method, 'POST')
  assert.equal(fixture.requests[1].options.headers['Content-Type'], 'application/json')
  assert.equal(fixture.requests[1].options.credentials, 'same-origin')
  assert.equal(fixture.requests[1].options.cache, 'no-store')
  assert.match(fixture.html(), /Kündigung vorgemerkt/)
  assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
  assert.equal(fixture.refreshes, 1)
})

test('free subscriptions clearly confirm immediate access loss, without a fabricated paid period', async () => {
  const available = { kind: 'free', state: 'available', endsAt: null, accessUntil: null }
  const fixture = harness([success(available), success({ ...available, state: 'ended' })])
  fixture.click('Abo kündigen'); await fixture.settle()
  assert.match(fixture.html(), /Kostenloses Abo beenden\?/)
  assert.match(fixture.html(), /endet sofort.*Zugriff.*beendet/)
  assert.doesNotMatch(fixture.html(), /Dezember|Erstattung|bleibt bis/)
  fixture.click('Kostenloses Abo beenden'); await fixture.settle()
  assert.match(fixture.html(), /Abo beendet/)
  assert.equal(fixture.refreshes, 1)
})

test('missing actual entitlement never promises access through the end of the paid period', async () => {
  const fixture = harness([success({ ...paid, accessUntil: null })])
  fixture.click('Abo kündigen'); await fixture.settle()
  assert.match(fixture.html(), /Abo zum Laufzeitende kündigen/)
  assert.doesNotMatch(fixture.html(), /Zugriff bleibt/)
})

test('GET already scheduled or ended presents the provider result instead of a second cancellation', async () => {
  for (const state of ['scheduled', 'ended']) {
    const fixture = harness([success({ ...paid, state, accessUntil: null })], { initiallyEnded: true })
    fixture.click('Kündigung prüfen'); await fixture.settle()
    assert.match(fixture.html(), state === 'scheduled' ? /Kündigung vorgemerkt/ : /Abo beendet/)
    assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
    assert.equal(fixture.requests.length, 1)
  }
})

test('ambiguous POST failures do not claim success and require fresh GET before retry', async () => {
  for (const response of [new Error('Synthetic offline'), failure(503), success({ ...paid, state: 'available' }), { ok: true, status: 200, json: async () => { throw Error('Invalid JSON') } }]) {
    const fixture = harness([success(paid), response, success({ ...paid, state: 'scheduled' })])
    fixture.click('Abo kündigen'); await fixture.settle()
    fixture.click('Zum Laufzeitende kündigen'); await fixture.settle()
    assert.match(fixture.html(), /role="alert".*konnte nicht bestätigt werden/)
    assert.doesNotMatch(fixture.html(), /Kündigung vorgemerkt/)
    assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
    assert.equal(fixture.refreshes, 0)
    fixture.click('Kündigung prüfen'); await fixture.settle()
    assert.equal(fixture.requests[2].options.method, 'GET')
    assert.match(fixture.html(), /Kündigung vorgemerkt/)
  }
})

test('failed GET does not imply an active, ended or scheduled subscription and supports rechecking', async () => {
  const fixture = harness([failure(503), success(paid)])
  fixture.click('Abo kündigen'); await fixture.settle()
  assert.match(fixture.html(), /role="alert".*kein Kündigungsstatus ableiten/)
  assert.doesNotMatch(fixture.html(), /Kündigung vorgemerkt|Abo beendet/)
  assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
  fixture.click('Kündigung prüfen'); await fixture.settle()
  assert.match(fixture.html(), /Abo zum Laufzeitende kündigen/)
})

test('permanent provider refusal directs to support; expired auth offers sign in; raw API messages stay private', async () => {
  for (const status of [409, 401]) {
    const fixture = harness([failure(status)])
    fixture.click('Abo kündigen'); await fixture.settle()
    assert.match(fixture.html(), status === 409 ? /kontaktiere den Ardore-Support/ : /href="\/login".*Erneut anmelden/)
    assert.doesNotMatch(fixture.html(), /Must not be reflected blindly/)
  }
})

test('malformed statuses cannot become cancellation confirmations or invalid date crashes', async () => {
  for (const payload of [null, {}, { ...paid, endsAt: null }, { ...paid, endsAt: 'not-a-date' }, { ...paid, kind: 'free', state: 'scheduled' }, { ...paid, accessUntil: undefined }]) {
    const fixture = harness([success(payload)])
    fixture.click('Abo kündigen'); await fixture.settle()
    assert.match(fixture.html(), /role="alert"/)
    assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
  }
})

test('pending state and synchronous guard block repeated inspection and cancellation clicks', async () => {
  let release
  const fixture = harness([() => new Promise(resolve => { release = resolve }), success({ ...paid, state: 'scheduled' })])
  fixture.click('Abo kündigen')
  fixture.click('Abo kündigen')
  assert.equal(fixture.requests.length, 1)
  assert.match(fixture.html(), /aria-busy="true"/)
  release(success(paid)); await fixture.settle()
  fixture.click('Zum Laufzeitende kündigen')
  fixture.click('Zum Laufzeitende kündigen')
  assert.equal(fixture.requests.length, 2)
  await fixture.settle()
  assert.match(fixture.html(), /Kündigung vorgemerkt/)
})

test('back closes confirmation without changing provider state or issuing a POST', async () => {
  const fixture = harness([success(paid)])
  fixture.click('Abo kündigen'); await fixture.settle()
  fixture.click('Zurück')
  assert.equal(find(fixture.render(), 'Zum Laufzeitende kündigen'), null)
  assert.equal(fixture.requests.length, 1)
  assert.equal(fixture.refreshes, 0)
})

const owner = 'synthetic-creator'
const subscription = {
  id: props.subscriptionId, buyer_id: 'synthetic-buyer', creator_id: owner, tier_id: 'synthetic-tier',
  stripe_subscription_id: 'sub_synthetic', stripe_livemode: true, status: 'active', current_period_end: '2099-01-01T00:00:00Z',
  creator: { id: owner, display_name: props.creatorName, slug: 'synthetic-coach', avatar_url: null, category: null },
  tier: { creator_id: owner, name: 'Synthetischer Tarif', price_monthly: 25, included_video_sessions: 2 },
}

async function subscriptionPage(rows, error = null) {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: subscription.buyer_id } } }) },
    from(table) {
      return {
        select() { return this }, eq() { return this }, order() { return this }, neq() { return this }, gte() { return this },
        then(resolve) { resolve(table === 'subscriptions' ? { data: rows, error } : { count: 0 }) },
      }
    },
  }
  const Page = loadUiComponent('src/app/buyer/subscriptions/page.tsx', {
    'next/navigation': { redirect() { throw new Error('Unexpected local fixture redirect') }, useRouter: () => ({ refresh() {} }) },
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => client },
    '@/lib/subscription-price': { subscriptionPriceLabels: async () => Object.fromEntries(rows.map(row => [row.id, '25,00 €/Mo.'])) },
  }).default
  return renderToStaticMarkup(await Page())
}

test('subscription cards use neutral period labels and semantic buttons without fabricated free renewal dates', async () => {
  const html = await subscriptionPage([subscription])
  assert.match(html, /Aktueller Zeitraum bis/)
  assert.doesNotMatch(html, /Verlängert am|<a[^>]*><button/)
  assert.match(html, /Chat mit Synthetischer Testcoach öffnen/)
  const free = await subscriptionPage([{ ...subscription, stripe_subscription_id: 'free_synthetic', stripe_livemode: null }])
  assert.match(free, /Kostenloses Abo/)
  assert.doesNotMatch(free, /2099|Verlängert am/)
})

test('entitlement-expired, test-mode and wrong-tier subscriptions expose no chat or booking access', async () => {
  for (const row of [
    { ...subscription, current_period_end: '2020-01-01T00:00:00Z' },
    { ...subscription, stripe_livemode: false },
    { ...subscription, tier: { ...subscription.tier, creator_id: 'wrong-owner' } },
    { ...subscription, status: 'canceled' },
  ]) {
    const html = await subscriptionPage([row])
    assert.doesNotMatch(html, /href="\/chat\/|Jetzt buchen|Noch 2 von/)
    assert.match(html, /Abo kündigen|Kündigung prüfen/)
  }
})

test('database read failure is an explicit recoverable error, never a false empty subscription list', async () => {
  const html = await subscriptionPage([], { message: 'Private database detail must not be reflected' })
  assert.match(html, /role="alert"/)
  assert.match(html, /Abonnements konnten nicht geladen werden/)
  assert.doesNotMatch(html, /Du hast noch keine|Private database detail/)
})
