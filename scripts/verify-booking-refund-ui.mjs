import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const passthrough = ({ children }) => children
function load(path, overrides = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const loadedModule = { exports: {} }
  const mockedRequire = name => {
    if (name in overrides) return overrides[name]
    if (name === 'next/link') return { __esModule: true, default: passthrough }
    if (name === 'lucide-react') return new Proxy({}, { get: () => () => null })
    if (name === '@/components/ui/Button') return { Button: props => React.createElement('button', props) }
    if (name === '@/components/RescheduleModal') return { __esModule: true, default: () => null }
    if (name === '@/components/SessionReviewPrompt') return { __esModule: true, default: () => null }
    if (name === '@/lib/features') return { VIDEO_CALLS_ENABLED: true }
    if (name === '@/lib/coaching-payment') return { hasValidCoachingPayment: () => true }
    return require(name)
  }
  new Function('require', 'exports', 'module', 'fetch', compiled)(mockedRequire, loadedModule.exports, loadedModule, globals.fetch)
  return loadedModule.exports
}

const ui = load('src/components/BookingActions.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) } })
const future = hours => new Date(Date.now() + hours * 3_600_000).toISOString()
const props = { bookingId: 'synthetic-booking', creatorId: 'synthetic-creator', coachName: 'Synthetic coach', scheduledAt: future(48), policyHours: 24, role: 'buyer' }

function markup(properties) {
  return renderToStaticMarkup(React.createElement(ui.default, { ...props, ...properties }))
}

test('refund statuses distinguish acceptance, pending and failure without inventing an amount', () => {
  const show = state => renderToStaticMarkup(React.createElement(ui.BookingRefundStatus, { refund: { booking_id: props.bookingId, state, amount_cents: 500 } }))
  assert.equal(show('not_requested'), '')
  assert.match(show('pending'), /role="status".*wird bearbeitet und ist noch nicht bestätigt/)
  assert.doesNotMatch(show('pending'), /wurden.*erstattet|5,00/)
  assert.match(show('failed'), /role="alert".*konnte noch nicht abgeschlossen werden/)
  assert.doesNotMatch(show('failed'), /wurde von Stripe bestätigt/)
  assert.match(show('succeeded'), /Deine Erstattung wurde von Stripe bestätigt/)
  assert.doesNotMatch(show('succeeded'), /5,00|vollständig erstattet/)
})

test('customer actions use the booking cutoff including zero and never guess a legacy cutoff', () => {
  assert.doesNotMatch(markup({ policyHours: 0 }), /<button[^>]*disabled=""/)
  assert.match(markup({ policyHours: 72 }), /Die Frist für eine kostenlose Stornierung ist abgelaufen/)
  assert.match(markup({ policyHours: 72 }), /<button[^>]*disabled=""[^>]*>Stornieren/)
  assert.match(markup({ policyHours: null }), /vereinbarte Stornierungsfrist ist nicht verfügbar/)
  assert.match(markup({ policyHours: null }), /<button[^>]*disabled=""[^>]*>Stornieren/)
  assert.doesNotMatch(markup({ policyHours: null }), /Vereinbarte Frist: 24/)
})

test('coach cancellation is possible inside the customer cutoff while rescheduling is blocked', () => {
  const html = markup({ role: 'creator', scheduledAt: future(1), policyHours: 24 })
  assert.match(html, /<button[^>]*disabled=""[^>]*>Verschieben/)
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Stornieren/)
  assert.doesNotMatch(markup({ role: 'creator', canReschedule: false }), />Verschieben/)
})

test('refund retries remain available after cancellation and do not expose rescheduling', () => {
  const failed = markup({ refundRetry: true, scheduledAt: future(-48), policyHours: null, refund: { state: 'failed', amount_cents: null } })
  assert.match(failed, /Erstattung erneut versuchen/)
  assert.doesNotMatch(failed, />Verschieben|<button[^>]*disabled=""/)
  assert.match(markup({ refundRetry: true, refund: { state: 'pending' } }), /Erstattung prüfen/)
})

function findElement(element, predicate) {
  if (!element || typeof element !== 'object') return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = findElement(child, predicate)
    if (found) return found
  }
  return null
}

function actionHarness(response) {
  const states = []
  let index = 0
  let refreshes = 0
  let requests = 0
  const loaded = load('src/components/BookingActions.tsx', {
    react: {
      ...React,
      useEffect() {},
      useMemo: factory => factory(),
      useRef: () => ({ current: null }),
      useState(initial) {
        const slot = index++
        if (!(slot in states)) states[slot] = initial
        return [states[slot], value => { states[slot] = value }]
      },
    },
    'next/navigation': { useRouter: () => ({ refresh: () => { refreshes++ } }) },
  }, {
    fetch: async (path, options) => {
      requests++
      assert.equal(path, '/api/coaching/cancel')
      assert.deepEqual(JSON.parse(options.body), { bookingId: props.bookingId })
      if (response instanceof Error) throw response
      return response
    },
  })
  const render = () => { index = 0; return loaded.default({ ...props, paid: true }) }
  const open = findElement(render(), element => element.type === 'button' && element.props.onClick && !element.props.disabled && React.Children.toArray(element.props.children).includes('Stornieren'))
  open.props.onClick()
  return {
    render,
    get refreshes() { return refreshes },
    get requests() { return requests },
    async submit() {
      const dialog = findElement(render(), element => element.props.role === 'dialog')
      assert.ok(dialog)
      const submit = findElement(dialog, element => element.props['aria-busy'] !== undefined)
      await submit.props.onClick()
    },
  }
}

test('Stripe/API failure remains visible, resets the button and refreshes the trusted cancelled state', async () => {
  const harness = actionHarness({ ok: false, json: async () => ({ error: 'Erstattung noch nicht abgeschlossen', refundStatus: 'failed' }) })
  await harness.submit()
  assert.equal(harness.refreshes, 1)
  assert.equal(harness.requests, 1)
  const html = renderToStaticMarkup(harness.render())
  assert.match(html, /role="alert".*Erstattung noch nicht abgeschlossen/)
  assert.doesNotMatch(html, /Wird bearbeitet|wurde von Stripe bestätigt/)
})

test('network and non-JSON failures preserve the confirmation dialog with a retryable alert', async () => {
  for (const response of [new Error('Synthetic offline'), { ok: false, json: async () => { throw new Error('Synthetic invalid JSON') } }]) {
    const harness = actionHarness(response)
    await harness.submit()
    assert.equal(harness.refreshes, 0)
    const html = renderToStaticMarkup(harness.render())
    assert.match(html, /role="dialog"/)
    assert.match(html, /role="alert"/)
    assert.doesNotMatch(html, /Wird bearbeitet|wurde von Stripe bestätigt/)
  }
})

test('an accepted pending refund closes the dialog and refreshes without announcing success', async () => {
  const harness = actionHarness({ ok: true, status: 202, json: async () => ({ ok: true, refundStatus: 'pending' }) })
  await harness.submit()
  assert.equal(harness.refreshes, 1)
  assert.doesNotMatch(renderToStaticMarkup(harness.render()), /role="dialog"|wurde von Stripe bestätigt/)
})

function sessionFixture(bookings, refunds = [], refundError = false) {
  const queries = []
  const actions = []
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) },
    from(table) {
      assert.notEqual(table, 'coaching_offers', 'Existing bookings must not read the mutable offer cutoff')
      const query = { table, filters: [], selected: null }
      queries.push(query)
      return {
        select(value) { query.selected = value; return this },
        eq(name, value) { query.filters.push([name, value]); return this },
        in(name, value) { query.filters.push([name, value]); return this },
        order() { return this },
        single: async () => ({ data: { id: 'synthetic-creator' } }),
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'bookings' ? bookings : table === 'booking_refunds' ? refunds : [], error: table === 'booking_refunds' && refundError ? { message: 'Synthetic error' } : null }).then(resolve, reject)
        },
      }
    },
  }
  return {
    queries, actions,
    modules: {
      '@/lib/supabase/server': { createClient: async () => db },
      'next/navigation': { redirect: () => { throw new Error('Unexpected redirect') } },
      '@/components/BookingActions': {
        __esModule: true,
        default: action => { actions.push(action); return null },
        BookingRefundStatus: ui.BookingRefundStatus,
      },
    },
  }
}
const row = extra => ({ ...props, id: props.bookingId, status: 'confirmed', duration_minutes: 60, cancellation_policy_hours: 18, price_cents: 1000, payment_status: 'paid', stripe_livemode: false, is_subscription_session: false, scheduled_at: props.scheduledAt, creator_id: props.creatorId, buyer_name: 'Synthetic buyer', buyer_email: 'delivered@resend.dev', creator_profiles: { id: props.creatorId, display_name: props.coachName, slug: 'synthetic' }, ...extra })
for (const [page, role] of [['src/app/buyer/sessions/page.tsx', 'buyer'], ['src/app/creator/sessions/page.tsx', 'creator']]) {
  test(`${role} session page scopes refund reads and uses immutable booking cutoff`, async () => {
    const fixture = sessionFixture([row({})])
    const Page = load(page, fixture.modules).default
    renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))
    assert.equal(fixture.actions.length, 1)
    assert.equal(fixture.actions[0].policyHours, 18)
    assert.deepEqual(fixture.queries.find(query => query.table === 'booking_refunds').filters, [['booking_id', [props.bookingId]]])
  })
  test(`${role} session page shows retryable failed refund and refund-read failures clearly`, async () => {
    const refund = { booking_id: props.bookingId, state: 'failed', amount_cents: 1000 }
    const fixture = sessionFixture([row({ status: 'cancelled', scheduled_at: future(-100) })], [refund])
    const html = renderToStaticMarkup(await load(page, fixture.modules).default({ searchParams: Promise.resolve({}) }))
    assert.match(html, /role="alert".*konnte noch nicht abgeschlossen werden/)
    assert.equal(fixture.actions[0].refundRetry, true)
    const unavailable = sessionFixture([row({})], [], true)
    assert.match(renderToStaticMarkup(await load(page, unavailable.modules).default({ searchParams: Promise.resolve({}) })), /Der Erstattungsstatus konnte nicht geladen werden/)
  })
}

test('coach can cancel undelivered confirmed bookings even after appointment time; completed bookings stay excluded', async () => {
  const fixture = sessionFixture([row({ scheduled_at: future(-0.05) })])
  renderToStaticMarkup(await load('src/app/creator/sessions/page.tsx', fixture.modules).default())
  assert.equal(fixture.actions.length, 1)
  assert.equal(fixture.actions[0].canReschedule, false)
  const undelivered = sessionFixture([row({ scheduled_at: future(-2) })])
  renderToStaticMarkup(await load('src/app/creator/sessions/page.tsx', undelivered.modules).default())
  assert.equal(undelivered.actions.length, 1)
  assert.equal(undelivered.actions[0].canReschedule, false)
  for (const booking of [row({ status: 'completed' }), row({ status: 'completed', scheduled_at: future(-2) })]) {
    const ended = sessionFixture([booking])
    renderToStaticMarkup(await load('src/app/creator/sessions/page.tsx', ended.modules).default())
    assert.equal(ended.actions.length, 0)
  }
})

function rescheduleFixture({ cutoff = 24, hoursUntil = 48, concurrentChange = false, status = 'confirmed' } = {}) {
  const booking = row({ cancellation_policy_hours: cutoff, scheduled_at: future(hoursUntil), status, buyer_id: 'synthetic-user', creator_profiles: { user_id: 'synthetic-coach', display_name: props.coachName } })
  const updates = []
  const query = table => ({
    select(columns) { if (table === 'coaching_offers') assert.doesNotMatch(columns, /cancellation_policy_hours/); return this },
    eq() { return this },
    single: async () => ({ data: table === 'bookings' ? booking : { is_enabled: true, cancellation_policy_hours: 72 } }),
  })
  const service = {
    auth: { admin: { getUserById: async () => ({ data: { user: null } }) } },
    from(table) {
      assert.equal(table, 'bookings')
      return {
        update(payload) {
          const record = { payload, filters: [] }
          updates.push(record)
          return {
            eq(name, value) { record.filters.push([name, value]); return this },
            select: () => ({ maybeSingle: async () => ({ data: concurrentChange ? null : { id: props.bookingId }, error: null }) }),
          }
        },
      }
    },
  }
  return {
    booking, updates,
    POST: load('src/app/api/coaching/reschedule/route.ts', {
      '@/lib/supabase/server': {
        createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'synthetic-user' } } }) }, from: query }),
        createServiceClient: async () => service,
      },
      '@/lib/notifications': { createNotification: async () => {} },
      '@/lib/coaching-booking': { validateCoachingSlot: async () => ({ ok: true, scheduledAt: future(96), bufferMinutes: 10 }) },
      '@/lib/email/send': { sendRescheduleConfirmation: async () => {} },
    }).POST,
  }
}
const reschedule = fixture => fixture.POST(new Request('http://localhost/api/coaching/reschedule', { method: 'POST', body: JSON.stringify({ bookingId: props.bookingId, newDate: '2026-10-10', newTime: '12:00' }) }))

test('rescheduling follows the original cutoff despite changed current offer and preserves snapshot', async () => {
  const allowed = rescheduleFixture({ cutoff: 0, hoursUntil: 8 })
  assert.equal((await reschedule(allowed)).status, 200)
  assert.deepEqual(allowed.updates[0].filters, [['id', props.bookingId], ['status', 'confirmed'], ['scheduled_at', allowed.booking.scheduled_at]])
  assert.equal('cancellation_policy_hours' in allowed.updates[0].payload, false)
  const blocked = rescheduleFixture({ cutoff: 24, hoursUntil: 8 })
  const response = await reschedule(blocked)
  assert.equal(response.status, 403)
  assert.equal((await response.json()).policyViolation, true)
  assert.equal(blocked.updates.length, 0)
})

test('rescheduling refuses unknown legacy cutoff, completed/end-passed sessions and concurrent cancellation', async () => {
  for (const options of [{ cutoff: null }, { hoursUntil: -2 }, { status: 'completed' }]) {
    const fixture = rescheduleFixture(options)
    const response = await reschedule(fixture)
    assert.ok([400, 409].includes(response.status))
    assert.equal(fixture.updates.length, 0)
  }
  const race = rescheduleFixture({ concurrentChange: true })
  assert.equal((await reschedule(race)).status, 409)
})

test('booking form discloses cutoff before CTA and sends it only as a server comparison guard', async () => {
  const states = []
  let index = 0
  let payload
  const BookingWidget = load('src/app/creators/[slug]/BookingWidget.tsx', {
    react: {
      ...React, useEffect() {}, useCallback: callback => callback,
      useState(initial) {
        const slot = index++
        if (!(slot in states)) states[slot] = ({ 2: new Date('2026-10-10T12:00:00Z'), 5: '12:00', 6: 'form', 7: 'Synthetic buyer', 8: 'delivered@resend.dev' })[slot] ?? initial
        return [states[slot], value => { states[slot] = value }]
      },
    },
    '@/components/ui/Input': { Input: props => React.createElement('input', props) },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' '), formatCurrency: amount => `${amount} €` },
  }, {
    fetch: async (path, options) => {
      assert.equal(path, '/api/coaching/book')
      payload = JSON.parse(options.body)
      return { ok: true, status: 200, json: async () => ({ bookingId: props.bookingId, cancellationPolicyHours: 0 }) }
    },
  }).default
  const render = () => {
    index = 0
    return BookingWidget({ creatorId: props.creatorId, offer: { price_cents: 0, duration_minutes: 60, description: null, cancellation_policy_hours: 0 } })
  }
  const html = renderToStaticMarkup(render())
  assert.match(html, /Kostenlose Stornierung bis 0 Stunden vor dem Termin/)
  assert.ok(html.indexOf('Kostenlose Stornierung') < html.indexOf('Session für'), 'Policy must be visible before submitting the booking')
  const submit = findElement(render(), element => typeof element.props.onClick === 'function' && element.props.className === 'w-full gap-2')
  await submit.props.onClick()
  assert.equal(payload.expectedCancellationPolicyHours, 0)
  assert.equal('cancellation_policy_hours' in payload, false, 'Client must never supply the authoritative snapshot field')
  assert.match(renderToStaticMarkup(render()), /Vereinbarte Stornierungsfrist: 0 Stunden/)
})
