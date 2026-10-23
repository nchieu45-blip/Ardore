// Local component/interaction fixtures only. No database, Stripe or video service access.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { loadUiComponent } from './load-ui-component.mjs'

const require = createRequire(import.meta.url)
let fixtureIndex = 0
const components = { video: 'src/components/ProtectedVideoRoom.tsx', booking: 'src/app/creators/[slug]/VideoClassBookButton.tsx', actions: 'src/components/GroupBookingActions.tsx' }
export const start = '2026-11-01T12:00:00.000Z'
export const second = '2026-11-08T12:00:00.000Z'
const props = {
  video: { endpoint: '/api/video-classes/fixture/meeting', request: { occurrenceStart: start }, scheduledAt: start, durationMinutes: 60, configurationReady: true },
  booking: { classId: 'fixture', priceCents: 1200, listedPriceCents: 1200, occurrences: [{ startsAt: start }, { startsAt: second }], registeredOccurrences: [], isLoggedIn: true },
  actions: { reservationId: 'reservation', bookingId: 'booking', status: 'open', canCancel: false, paid: true },
}
export const ok = value => ({ ok: true, status: 200, json: async () => value })
export const fail = (status, value = {}) => ({ ok: false, status, json: async () => value })
export const available = overrides => ok({ occurrenceStart: start, capacity: 8, remaining: 3, isFull: false, videoReady: true, ...overrides })
const settle = () => new Promise(resolve => setImmediate(resolve))

function find(element, predicate) {
  if (!element || typeof element !== 'object') return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}

export function groupUiHarness(kind, responses = [], overrides = {}) {
  const fixtureId = `fixture-termin-${fixtureIndex++}`
  const state = [], refs = [], effects = [], requests = [], destinations = [], storage = new Map()
  let stateIndex = 0, refIndex = 0, effectIndex = 0, refreshes = 0
  let now = Date.parse(start) - 5 * 60_000
  let timer = null
  const hooks = {
    ...React, useId: () => fixtureId,
    useState(initial) { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial } },
    useEffect(effect, deps) {
      const i = effectIndex++
      if (!effects[i] || deps.some((dep, index) => dep !== effects[i].deps[index])) {
        effects[i]?.cleanup?.()
        effects[i] = { deps, effect, pending: true }
      }
    },
  }
  const original = Date.now
  const withClock = fn => { Date.now = () => now; try { return fn() } finally { Date.now = original } }
  const fetch = async (url, options = {}) => {
    requests.push({ url, options })
    assert.ok(responses.length, 'Every request must have an explicit local response')
    const response = responses.shift()
    if (response instanceof Error) throw response
    return typeof response === 'function' ? response() : response
  }
  const source = ts.transpileModule(readFileSync(new URL(`../../${components[kind]}`, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const loaded = { exports: {} }
  const dependency = name => {
    if (name === 'react') return hooks
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++ } }) }
    if (name.startsWith('@/')) return loadUiComponent(`src/${name.slice(2)}${name.includes('components') ? '.tsx' : '.ts'}`)
    if (name === 'next/link') return loadUiComponent('src/components/ui/Button.tsx').ButtonLink ? ({ children, ...attributes }) => React.createElement('a', attributes, children) : null
    return require(name)
  }
  new Function('require', 'module', 'exports', 'fetch', 'window', 'sessionStorage', 'setInterval', 'clearInterval', source)(
    dependency, loaded, loaded.exports, fetch, { location: { assign: url => destinations.push(url) } },
    { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    callback => { timer = callback; return 1 }, () => { timer = null },
  )
  const render = () => withClock(() => { stateIndex = 0; refIndex = 0; effectIndex = 0; return loaded.exports.default({ ...props[kind], ...overrides }) })
  return {
    requests, destinations, storage, render,
    html: () => renderToStaticMarkup(render()),
    target: predicate => find(render(), predicate),
    action: () => find(render(), node => typeof node.props?.onClick === 'function'),
    async effects() { render(); for (const effect of effects) if (effect.pending) { effect.pending = false; effect.cleanup = effect.effect() } await settle() },
    advance(milliseconds) { now += milliseconds; withClock(() => timer?.()) },
    get refreshes() { return refreshes },
    get exports() { return loaded.exports },
  }
}
