// Isolated React interaction harness: no browser/service credentials or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const require = createRequire(import.meta.url)
const source = ts.transpileModule(readFileSync(new URL('../src/app/creator/settings/DeleteAccountSection.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const text = element => typeof element === 'string' ? element : element?.props ? React.Children.toArray(element.props.children).map(text).join('') : ''
function find(element, predicate) {
  if (!element || typeof element !== 'object') return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const result = find(child, predicate); if (result) return result
  }
  return null
}
function harness(responses) {
  const states = [], refs = [], requests = [], navigations = []
  let stateIndex = 0, refIndex = 0, signOuts = 0
  const loaded = { exports: {} }
  const hooks = { ...React, useEffect() {},
    useState(initial) { const slot = stateIndex++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = value }] },
    useRef(initial) { const slot = refIndex++; refs[slot] ??= { current: initial }; return refs[slot] },
  }
  const dependency = name => {
    if (name === 'react') return hooks
    if (name === 'next/navigation') return { useRouter: () => ({ push(path) { navigations.push(path) } }) }
    if (name === '@/lib/supabase/client') return { createClient: () => ({ auth: { async signOut() { signOuts++ } } }) }
    if (name === '@/components/ui/Button') return loadUiComponent('src/components/ui/Button.tsx')
    if (name === '@/lib/utils') return loadUiComponent('src/lib/utils.ts')
    return require(name)
  }
  const fetch = async (url, options) => {
    requests.push({ url, options }); assert.ok(responses.length, 'Explicit fixture required for every request')
    const next = responses.shift(); if (next instanceof Error) throw next
    return typeof next === 'function' ? next() : next
  }
  new Function('require', 'exports', 'module', 'fetch', source)(dependency, loaded.exports, loaded, fetch)
  const render = () => { stateIndex = 0; refIndex = 0; return loaded.exports.default({ isCreator: false, activeSubscribersCount: 0, upcomingBookingsCount: 0, activeSubscriptionsCount: 1 }) }
  const button = label => { const target = find(render(), e => e.type === 'button' && text(e).trim() === label); assert.ok(target, `Expected button ${label}`); return target }
  const input = () => find(render(), e => e.type === 'input' && e.props.id === 'delete-account-confirmation')
  return {
    requests, navigations, render, button,
    html: () => renderToStaticMarkup(render()),
    get signOuts() { return signOuts },
    open() { button('Konto löschen').props.onClick() },
    confirm() { input().props.onChange({ target: { value: 'LÖSCHEN' } }) },
    submit() { return button('Unwiderruflich löschen').props.onClick() },
    enter() { return input().props.onKeyDown({ key: 'Enter' }) },
    settle: () => new Promise(resolve => setImmediate(resolve)),
  }
}
const success = { ok: true, json: async () => ({ ok: true }) }
test('account deletion needs explicit typed confirmation and sends only that field', async () => {
  const ui = harness([success]); ui.open()
  assert.equal(ui.button('Unwiderruflich löschen').props.disabled, true)
  await ui.submit(); assert.equal(ui.requests.length, 0)
  ui.confirm(); await ui.submit()
  assert.deepEqual(ui.requests, [{ url: '/api/account/delete', options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation: 'LÖSCHEN' }) } }])
  assert.equal(ui.signOuts, 1); assert.deepEqual(ui.navigations, ['/konto-geloescht'])
})
test('Stripe error preserves modal, login and confirmation; retry remains possible', async () => {
  const message = 'Die Beendigung aller Stripe-Abos konnte nicht bestätigt werden. Dein Konto wurde nicht gelöscht.'
  const ui = harness([{ ok: false, json: async () => ({ error: message }) }, success])
  ui.open(); ui.confirm(); await ui.submit()
  assert.equal(ui.signOuts, 0); assert.deepEqual(ui.navigations, [])
  assert.match(ui.html(), /role="alert"/); assert.ok(ui.html().includes(message)); assert.match(ui.html(), /value="LÖSCHEN"/)
  assert.equal(ui.button('Unwiderruflich löschen').props.disabled, false)
  await ui.submit(); assert.equal(ui.signOuts, 1)
})
test('rapid click plus Enter submits only once before React rerenders', async () => {
  let release
  const ui = harness([() => new Promise(resolve => { release = resolve })])
  ui.open(); ui.confirm()
  const click = ui.button('Unwiderruflich löschen').props.onClick
  const pending = click(); click(); ui.enter()
  assert.equal(ui.requests.length, 1)
  assert.match(ui.html(), /Wird gelöscht/)
  release(success); await pending; assert.equal(ui.signOuts, 1)
})
for (const result of [new Error('Lokaler Netzwerkfehler'), { ok: true, json: async () => ({}) }]) {
  test('network or malformed success response never logs out or claims deletion', async () => {
    const ui = harness([result]); ui.open(); ui.confirm(); await ui.submit()
    assert.equal(ui.signOuts, 0); assert.deepEqual(ui.navigations, []); assert.match(ui.html(), /role="alert"/)
  })
}
test('confirmation explains support retention and partial Stripe success without promising complete erasure', () => {
  const ui = harness([]); ui.open()
  assert.match(ui.html(), /Buchungen, Käufen oder Zahlungsaufzeichnungen/)
  assert.match(ui.html(), /einzelne Abos können bereits beendet sein/)
  assert.doesNotMatch(ui.html(), /DSGVO Art\. 17|Alle Käufe|Alle Buchungen/)
})
