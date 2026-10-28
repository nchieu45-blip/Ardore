import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

// All service boundaries are synthetic. Never load .env or make HTTP requests.
const require = createRequire(import.meta.url)
const NOW = new Date('2026-10-15T08:00:00.000Z')
const HOUR = 3_600_000
const iso = hours => new Date(NOW.getTime() + hours * HOUR).toISOString()
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW.getTime()])) }
  static now() { return NOW.getTime() }
}
const booking = (changes = {}) => ({
  id: 'synthetic-booking', buyer_id: 'synthetic-buyer', buyer_name: 'Synthetic buyer',
  scheduled_at: iso(18), duration_minutes: 60, status: 'confirmed',
  payment_status: 'not_required', stripe_livemode: null,
  creator_profiles: { user_id: 'synthetic-coach', display_name: 'Synthetic coach' },
  ...changes,
})

function load(relative, modules = {}, env = { CRON_SECRET: 'synthetic-cron-only' }) {
  const filename = new URL(`../${relative}`, import.meta.url)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  const fixtureModule = { exports: {} }
  const resolver = name => {
    if (name in modules) return modules[name]
    if (name.startsWith('@/lib/')) return load(`src/lib/${name.slice(6)}.ts`, modules, env)
    return require(name)
  }
  new Function('require', 'exports', 'module', 'process', 'fetch', 'Date', code)(
    resolver, fixtureModule.exports, fixtureModule, { env },
    () => { throw new Error('Real network access is forbidden in cron regression tests') },
    FixtureDate,
  )
  return fixtureModule.exports
}

function fixture(options = {}) {
  const rows = options.bookings ?? [booking()]
  const ledger = new Map()
  const queries = [], rpcCalls = [], emails = [], templates = [], authReads = []
  let nextId = 0
  let freshReads = 0
  let emailFailure = options.emailFailure
  let preferenceFailure = options.preferenceFailure

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.start = 0; this.end = Infinity; this.isSingle = false }
    select(columns, settings = {}) { this.columns = columns; this.counted = settings.count === 'exact'; return this }
    eq(key, value) { this.filters.push(['eq', key, value]); return this }
    in(key, values) { this.filters.push(['in', key, values]); return this }
    gte(key, value) { this.filters.push(['gte', key, value]); return this }
    lte(key, value) { this.filters.push(['lte', key, value]); return this }
    gt(key, value) { this.filters.push(['gt', key, value]); return this }
    lt(key, value) { this.filters.push(['lt', key, value]); return this }
    or(value) { this.paymentFilter = value; return this }
    order(key) { this.orderedBy = key; return this }
    range(start, end) { this.start = start; this.end = end; return this }
    limit(count) { this.end = this.start + count - 1; return this }
    maybeSingle() { this.isSingle = true; return this }
    single() { this.isSingle = true; return this }
    then(resolve, reject) {
      return Promise.resolve().then(() => {
        queries.push({ table: this.table, columns: this.columns, filters: this.filters, start: this.start, end: this.end, single: this.isSingle })
        if (this.table === 'bookings') {
          if (options.bookingFailure) return { data: null, error: new Error('PRIVATE booking data') }
          const fresh = this.isSingle && typeof options.freshBooking === 'function'
            ? options.freshBooking(++freshReads) : options.freshBooking
          const source = this.isSingle && options.freshBooking !== undefined ? [fresh].filter(Boolean) : rows
          const matched = source.filter(row => this.filters.every(([operator, key, value]) => {
            if (operator === 'eq') return row[key] === value
            if (operator === 'in') return value.includes(row[key])
            if (operator === 'gte') return row[key] >= value
            if (operator === 'lte') return row[key] <= value
            if (operator === 'gt') return row[key] > value
            if (operator === 'lt') return row[key] < value
            return true
          })).filter(row => !this.paymentFilter || row.payment_status === 'not_required'
            || (row.payment_status === 'paid' && row.stripe_livemode === true))
          const data = matched.slice(this.start, this.end + 1)
          return { data: this.isSingle ? data[0] ?? null : data, error: null }
        }
        if (this.table === 'booking_meeting_links') return { data: options.meetingReady ? { booking_id: 'synthetic-booking' } : null, error: options.meetingFailure ? new Error('PRIVATE meeting data') : null }
        if (this.table === 'notification_preferences') {
          const userId = this.filters.find(([, key]) => key === 'user_id')?.[2]
          return { data: options.preferences?.[userId] ?? null, error: preferenceFailure ? new Error('PRIVATE preference data') : null }
        }
        if (this.table === 'session_reviews') return { count: options.reviewed ? 1 : 0, data: null, error: options.reviewFailure ? new Error('PRIVATE review data') : null }
        throw new Error(`Unexpected table: ${this.table}`)
      }).then(resolve, reject)
    }
  }
  const service = {
    from: table => new Query(table),
    auth: { admin: { getUserById: async userId => {
      authReads.push(userId)
      return { data: { user: { id: userId, email: `${userId}@example.test`, user_metadata: {} } }, error: options.authFailure ? new Error('PRIVATE account data') : null }
    } } },
    rpc: async (name, args) => {
      rpcCalls.push({ name, args })
      if (options.rpcFailure) return { data: null, error: new Error('PRIVATE ledger data') }
      if (name === 'claim_session_notification') {
        if (options.claimState) return { data: { state: options.claimState }, error: null }
        const key = [args.p_booking_id, args.p_recipient_id, args.p_type, args.p_channel, args.p_occurrence].join('|')
        let entry = ledger.get(key)
        if (entry?.delivered) return { data: { state: 'sent', id: entry.id }, error: null }
        if (!entry) {
          entry = { id: `synthetic-delivery-${++nextId}`, payload: structuredClone(options.frozenPayload ?? args.p_payload), key }
          ledger.set(key, entry)
        }
        entry.token = args.p_token
        return { data: { state: 'claimed', id: entry.id, payload: entry.payload }, error: null }
      }
      if (name === 'complete_session_notification' || name === 'fail_session_notification') {
        const id = args.p_delivery_id ?? args.p_id
        const entry = [...ledger.values()].find(item => item.id === id)
        assert.ok(entry, `Completion must reference an existing claimed delivery: ${JSON.stringify(args)}`)
        if (name === 'complete_session_notification') entry.delivered = true
        return { data: true, error: null }
      }
      throw new Error(`Unexpected RPC: ${name}`)
    },
  }
  const template = name => data => { templates.push({ name, data }); return `${name}:${JSON.stringify(data)}` }
  const modules = {
    '@/lib/supabase/server': { createServiceClient: async () => service },
    '@/lib/email': { FROM: 'Ardore <noreply@example.test>', sendEmail: async (payload, requestOptions) => {
      emails.push({ payload, requestOptions })
      if (options.emailGate) await options.emailGate
      if (typeof emailFailure === 'function' ? emailFailure(payload) : emailFailure) throw new Error('PRIVATE provider data')
      return { id: `synthetic-provider-${emails.length}` }
    } },
    '@/lib/email/templates': {
      sessionReminderHtml: template('reminder-html'), sessionReminderText: template('reminder-text'),
      sessionReviewPromptHtml: template('review-html'), sessionReviewPromptText: template('review-text'),
    },
    '@/lib/app-url': { appOrigin: () => 'https://ardore.example.test' },
  }
  const helper = load('src/lib/session-cron.ts', modules)
  return {
    run: (kind = 'session_reminder', now = NOW) => helper.runSessionNotifications(kind, now),
    ledger, queries, rpcCalls, emails, templates, authReads,
    setEmailFailure: value => { emailFailure = value },
    setPreferenceFailure: value => { preferenceFailure = value },
  }
}

test('reminders cover upcoming sessions outside old 23–25h slice without reminding past or distant sessions', async () => {
  const f = fixture({ bookings: [booking(), booking({ id: 'synthetic-soon', scheduled_at: iso(0.5) }),
    booking({ id: 'synthetic-ended', scheduled_at: iso(-0.1) }), booking({ id: 'synthetic-later', scheduled_at: iso(24.1) })] })
  const result = await f.run()
  assert.equal(result.failed, 0)
  assert.equal(f.emails.length, 4)
  assert.deepEqual(new Set(f.rpcCalls.filter(call => call.name === 'claim_session_notification').map(call => call.args.p_booking_id)), new Set(['synthetic-booking', 'synthetic-soon']))
})

test('successful recipient/channel deliveries are durable and skipped on rerun', async () => {
  const f = fixture()
  assert.equal((await f.run()).failed, 0)
  assert.equal(f.ledger.size, 4)
  assert.equal(f.emails.length, 2)
  const result = await f.run()
  assert.equal(result.failed, 0)
  assert.equal(f.emails.length, 2)
  assert.equal([...f.ledger.values()].filter(entry => entry.delivered).length, 4)
})

test('buyer email failure does not suppress coach or in-app deliveries and retry sends only failed channel', async () => {
  const f = fixture({ emailFailure: payload => payload.to === 'synthetic-buyer@example.test' })
  const first = await f.run()
  assert.equal(first.failed, 1)
  assert.equal(f.emails.length, 2)
  assert.equal([...f.ledger.values()].filter(entry => entry.delivered).length, 3)
  f.setEmailFailure(false)
  assert.equal((await f.run()).failed, 0)
  assert.equal(f.emails.length, 3)
  assert.equal(f.emails.at(-1).payload.to, 'synthetic-buyer@example.test')
  assert.equal([...f.ledger.values()].filter(entry => entry.delivered).length, 4)
})

test('review work is awaited until pending email finishes, rather than detached after response', async () => {
  let release
  const emailGate = new Promise(resolve => { release = resolve })
  const f = fixture({ bookings: [booking({ scheduled_at: iso(-3) })], emailGate })
  let settled = false
  const pending = f.run('session_review_prompt').then(result => { settled = true; return result })
  for (let i = 0; i < 100 && f.emails.length === 0; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.emails.length, 1)
  assert.equal(settled, false)
  release()
  assert.equal((await pending).failed, 0)
})

test('claimed frozen email is used unchanged with stable provider idempotency key', async () => {
  const frozenPayload = { from: 'Ardore <noreply@example.test>', to: 'frozen@example.test', subject: 'Frozen subject', html: '<p>Frozen</p>', text: 'Frozen' }
  const f = fixture({ frozenPayload, preferences: { 'synthetic-coach': { inapp_session_reminder: false, email_session_reminder: false },
    'synthetic-buyer': { inapp_session_reminder: false, email_session_reminder: true } }, emailFailure: true })
  assert.equal((await f.run()).failed, 1)
  f.setEmailFailure(false)
  assert.equal((await f.run('session_reminder', new Date(NOW.getTime() + 5 * 60_000))).failed, 0)
  assert.equal(f.emails.length, 2)
  assert.deepEqual(f.emails[0].payload, frozenPayload)
  assert.deepEqual(f.emails[1].payload, frozenPayload)
  assert.deepEqual(f.emails[0].requestOptions, f.emails[1].requestOptions)
  assert.match(f.emails[0].requestOptions.idempotencyKey, /^session-notification\/synthetic-delivery-/)
})

test('reminder preference failure fails closed; explicit opt-outs are not overridden', async () => {
  const failed = fixture({ preferenceFailure: true })
  assert.ok((await failed.run()).failed > 0)
  assert.equal(failed.emails.length, 0)
  assert.equal(failed.rpcCalls.length, 0)
  const optedOut = fixture({ preferences: Object.fromEntries(['synthetic-buyer', 'synthetic-coach'].map(id => [id, { inapp_session_reminder: false, email_session_reminder: false }])) })
  assert.equal((await optedOut.run()).failed, 0)
  assert.equal(optedOut.emails.length, 0)
  assert.equal(optedOut.rpcCalls.length, 0)
  assert.equal(optedOut.authReads.length, 0)
})

test('email account lookup failure leaves each valid in-app delivery independent', async () => {
  const f = fixture({ authFailure: true })
  const result = await f.run()
  assert.equal(result.failed, 2)
  assert.equal(result.sent, 2)
  assert.equal(f.emails.length, 0)
  assert.equal([...f.ledger.values()].filter(entry => entry.delivered).length, 2)
  assert.equal(f.rpcCalls.filter(call => call.name === 'claim_session_notification').every(call => call.args.p_channel === 'inapp'), true)
})

test('query failures are explicit without leaking private provider/database details', async () => {
  for (const failure of ['bookingFailure', 'rpcFailure', 'reviewFailure']) {
    const f = fixture({ [failure]: true, bookings: [booking({ scheduled_at: iso(-3) })] })
    let result
    try { result = await f.run('session_review_prompt') }
    catch (error) { result = { failed: 1, message: error.message } }
    assert.ok(result.failed > 0)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/)
    assert.equal(f.emails.length, 0)
  }
})

test('canceled, rescheduled or no-longer-entitled fresh booking is not sent from stale scan data', async () => {
  for (const freshBooking of [null, booking({ status: 'cancelled' }), booking({ scheduled_at: iso(30) }), booking({ payment_status: 'paid', stripe_livemode: false })]) {
    const f = fixture({ freshBooking })
    assert.equal((await f.run()).failed, 0)
    assert.equal(f.emails.length, 0)
    assert.equal(f.rpcCalls.filter(call => call.name === 'claim_session_notification').length, 0)
  }
})

test('recipient is still a participant of the refreshed booking before any private notification', async () => {
  for (const freshBooking of [booking({ buyer_id: 'synthetic-new-buyer' }), booking({
    creator_profiles: { user_id: 'synthetic-new-coach', display_name: 'Synthetic new coach' },
  })]) {
    const f = fixture({ freshBooking })
    assert.equal((await f.run()).failed, 0)
    const valid = new Set([freshBooking.buyer_id, freshBooking.creator_profiles.user_id])
    assert.equal(f.emails.length, 1)
    assert.equal(f.rpcCalls.filter(call => call.name === 'claim_session_notification').every(call => valid.has(call.args.p_recipient_id)), true)
  }
})

test('pre-email refresh rechecks participant membership after in-app delivery', async () => {
  for (const scenario of [
    { changeAt: 4, removed: 'synthetic-buyer', changed: { buyer_id: 'synthetic-new-buyer' } },
    { changeAt: 2, removed: 'synthetic-coach', changed: { creator_profiles: { user_id: 'synthetic-new-coach', display_name: 'Synthetic new coach' } } },
  ]) {
    const f = fixture({ freshBooking: read => booking(read >= scenario.changeAt ? scenario.changed : {}) })
    const result = await f.run()
    assert.equal(result.failed, 0)
    assert.equal(result.sent, 3)
    assert.equal(result.skipped, 1)
    assert.equal(f.emails.length, 1)
    assert.equal(f.emails.some(email => email.payload.to === `${scenario.removed}@example.test`), false)
    assert.equal(f.rpcCalls.filter(call => call.name === 'claim_session_notification' && call.args.p_channel === 'email')
      .some(call => call.args.p_recipient_id === scenario.removed), false)
  }
})

test('payment eligibility is preserved: paid test or unconfirmed bookings receive no reminders', async () => {
  const f = fixture({ bookings: [booking({ payment_status: 'paid', stripe_livemode: false }), booking({ id: 'synthetic-pending', status: 'pending_payment' })] })
  assert.equal((await f.run()).failed, 0)
  assert.equal(f.emails.length, 0)
})

test('review catch-up includes delayed runs and 8h sessions, but not ongoing, too-old or reviewed sessions', async () => {
  const f = fixture({ bookings: [booking({ id: 'synthetic-long', scheduled_at: iso(-7 * 24 - 7), duration_minutes: 480 }),
    booking({ id: 'synthetic-delayed', scheduled_at: iso(-48) }), booking({ id: 'synthetic-ongoing', scheduled_at: iso(-1), duration_minutes: 480 }),
    booking({ id: 'synthetic-old', scheduled_at: iso(-7 * 24 - 9), duration_minutes: 480 })] })
  assert.equal((await f.run('session_review_prompt')).failed, 0)
  assert.equal(f.emails.length, 2)
  const ids = new Set(f.rpcCalls.filter(call => call.name === 'claim_session_notification').map(call => call.args.p_booking_id))
  assert.deepEqual(ids, new Set(['synthetic-long', 'synthetic-delayed']))
  const reviewed = fixture({ reviewed: true, bookings: [booking({ scheduled_at: iso(-3) })] })
  assert.equal((await reviewed.run('session_review_prompt')).failed, 0)
  assert.equal(reviewed.emails.length, 0)
})

test('busy and held deliveries are observable failures rather than false successful sends', async () => {
  for (const claimState of ['busy', 'held']) {
    const f = fixture({ claimState })
    const result = await f.run()
    assert.ok(result.failed > 0)
    assert.ok(result[claimState] > 0)
    assert.equal(f.emails.length, 0)
  }
})

test('legacy and successful ledger rows are skipped without new email delivery', async () => {
  for (const claimState of ['sent', 'legacy_skipped']) {
    const f = fixture({ claimState })
    const result = await f.run()
    assert.equal(result.failed, 0)
    assert.equal(result.skipped, 4)
    assert.equal(result.legacySkipped, claimState === 'legacy_skipped' ? 4 : 0)
    assert.equal(f.emails.length, 0)
  }
})

test('candidate pagination processes bookings beyond the first 200-row page', async () => {
  const preferences = Object.fromEntries(['synthetic-buyer', 'synthetic-coach'].map(id => [id, {
    inapp_session_reminder: false, email_session_reminder: false,
  }]))
  const f = fixture({ preferences, bookings: Array.from({ length: 201 }, (_, index) => booking({
    id: `synthetic-booking-${String(index).padStart(3, '0')}`,
  })) })
  assert.equal((await f.run()).failed, 0)
  assert.deepEqual(f.queries.filter(query => query.table === 'bookings' && !query.single).map(query => [query.start, query.end]), [[0, 199], [200, 399]])
  assert.equal(f.queries.filter(query => query.table === 'bookings' && query.single).length, 402)
})

test('absolute reminder copy remains truthful after frozen retry instead of saying tomorrow or zero minutes', () => {
  const templates = load('src/lib/email/templates.ts')
  const details = { recipientName: 'Synthetic buyer', coachName: 'Synthetic coach',
    scheduledDate: '16. Oktober 2026', scheduledTime: '02:00', minutesUntil: 0,
    sessionUrl: 'https://ardore.example.test/session/synthetic-booking', role: 'buyer', meetingReady: false }
  for (const name of ['sessionReminderHtml', 'sessionReminderText']) {
    const body = templates[name](details)
    assert.match(body, /am 16\. Oktober 2026/)
    assert.match(body, /02:00/)
    assert.match(body, /Europe\/Berlin/)
    assert.doesNotMatch(body, /morgen|in 0 Minuten/)
  }
})

test('thin session routes reject unauthorized access and expose failed deliveries as non-2xx without private detail', async () => {
  for (const [route, kind] of [['session-reminders', 'session_reminder'], ['session-review-prompts', 'session_review_prompt']]) {
    let calls = 0
    let throws = false
    const modules = { '@/lib/coaching-emails': { runCoachingEmails: async () => ({ sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }) }, '@/lib/session-cron': { runSessionNotifications: async supplied => {
      calls++
      assert.equal(supplied, kind)
      if (throws) throw new Error('PRIVATE service details')
      return { sent: 1, skipped: 0, failed: 1, legacySkipped: 0, busy: 0, held: 0 }
    } }, '@/lib/group-session-reminders': { runGroupSessionReminders: async () => ({ sent: 0, skipped: 0, failed: 0, legacySkipped: 0, busy: 0, held: 0 }) } }
    const api = load(`src/app/api/cron/${route}/route.ts`, modules)
    assert.equal((await api.GET(new Request('https://ardore.example.test'))).status, 401)
    assert.equal(calls, 0)
    const request = () => new Request('https://ardore.example.test', { headers: { authorization: 'Bearer synthetic-cron-only' } })
    const failed = await api.GET(request())
    assert.equal(failed.status, 503)
    assert.match(failed.headers.get('cache-control'), /no-store/)
    assert.equal((await failed.json()).failed, 1)
    throws = true
    const outage = await api.GET(request())
    assert.equal(outage.status, 503)
    assert.doesNotMatch(await outage.text(), /PRIVATE/)
  }
})

test('cron auth rejects missing/empty secrets and literal Bearer undefined before any data access', () => {
  for (const [secret, supplied] of [[undefined, 'Bearer undefined'], ['', 'Bearer '], ['synthetic-cron-only', 'Bearer wrong']]) {
    const { isCronAuthorized } = load('src/lib/cron.ts', {}, { CRON_SECRET: secret })
    assert.equal(isCronAuthorized(new Request('https://ardore.example.test', { headers: { authorization: supplied } })), false)
  }
  const { isCronAuthorized, cronJson } = load('src/lib/cron.ts')
  assert.equal(isCronAuthorized(new Request('https://ardore.example.test', { headers: { authorization: 'Bearer synthetic-cron-only' } })), true)
  assert.match(cronJson({ sent: 0 }).headers.get('cache-control'), /no-store/)
})
