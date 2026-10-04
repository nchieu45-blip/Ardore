import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, overrides = {}, globals = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const mod = { exports: {} }
  const resolve = name => {
    if (name in overrides) return overrides[name]
    if (name.startsWith('@/lib/')) return load(`src/lib/${name.slice(6)}.ts`, overrides, globals)
    return require(name)
  }
  new Function('require', 'module', 'exports', 'fetch', code)(resolve, mod, mod.exports, globals.fetch)
  return mod.exports
}
const meeting = load('src/lib/session-meeting.ts')
const id = '12345678-1234-1234-1234-123456789012'
const coachId = 'trusted-coach', buyerId = 'trusted-buyer'
const booking = () => ({ id, creator_id: 'creator', buyer_id: buyerId, buyer_name: 'Synthetic buyer',
  buyer_email: 'delivered@resend.dev', scheduled_at: new Date(Date.now() + 86400000).toISOString(),
  duration_minutes: 60, price_cents: 0, status: 'confirmed', payment_status: 'not_required',
  stripe_livemode: null, daily_room_url: null, notes: null,
  creator_profiles: { display_name: 'Synthetic coach', user_id: coachId } })
const url = 'https://meet.google.com/abc-defg-hij'
const context = { params: Promise.resolve({ id }) }
const request = (value = url, options = {}) => new Request(`https://www.ardore-health.com/api/coaching/meeting/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingUrl: value, coachUserId: 'attacker', status: 'completed' }), ...options,
})

for (const url of ['https://meet.google.com/abc-defg-hij', 'https://example.zoom.us/j/123?pwd=abc', 'https://teams.microsoft.com/l/meetup-join/test', 'https://meet.jit.si/ArdoreTest']) {
  test(`valid HTTPS meeting provider ${new URL(url).hostname}`, () => assert.equal(meeting.normalizeMeetingUrl(url), url))
}
for (const value of ['http://meet.google.com/x', 'javascript:alert(1)', 'data:text/html,test', 'ftp://zoom.us/x', '//zoom.us/x',
  'https://user:password@zoom.us/x', 'https://zoom.us:8080/x', 'https://localhost/x', 'https://127.0.0.1/x',
  'https://[::1]/x', 'https://host.local/x', 'https://zoom.us/ x', 'https://zoom.us/\nsecret', 'https:\\zoom.us\\x',
  'https://zoom.us/' + 'a'.repeat(2048), null, {}, 123]) {
  test(`reject unsafe meeting input ${typeof value === 'string' ? value.slice(0,40).replaceAll('\n','newline') : typeof value}`, () => assert.equal(meeting.normalizeMeetingUrl(value), null))
}
test('normalizes URLs and surrounding whitespace without losing provider query/fragment', () => {
  assert.equal(meeting.normalizeMeetingUrl('  https://ZOOM.us:443/j/123?pwd=abc#join  '), 'https://zoom.us/j/123?pwd=abc#join')
})
test('session attendance requires confirmed, entitled and unexpired booking; never grants paid TEST access', () => {
  const row = booking(), now = Date.now()
  assert.equal(meeting.canAccessSessionMeeting(row, now), true)
  for (const status of ['completed','cancelled','pending_payment','payment_failed','expired','refunded','reversed']) {
    assert.equal(meeting.canAccessSessionMeeting({ ...row, status }, now), false)
  }
  for (const payment_status of ['pending','failed','expired','refunded','reversed','unpaid']) {
    assert.equal(meeting.canAccessSessionMeeting({ ...row, payment_status }, now), false)
  }
  assert.equal(meeting.canAccessSessionMeeting({ ...row, payment_status: 'paid', stripe_livemode: false }, now), false)
  assert.equal(meeting.canAccessSessionMeeting({ ...row, payment_status: 'paid', stripe_livemode: true }, now), true)
  assert.equal(meeting.canAccessSessionMeeting({ ...row, scheduled_at: 'invalid' }, now), false)
  assert.equal(meeting.canAccessSessionMeeting({ ...row, scheduled_at: new Date(now - 3600000).toISOString() }, now), false)
})

function routeHarness({ userId = coachId, row = booking(), link = url, rpcResult = 'saved', rpcError = null, queryError = null, linkError = null } = {}) {
  const calls = [], reads = []
  const client = { auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from(table) {
      reads.push(table)
      const builder = { select: () => builder, eq: () => builder,
        maybeSingle: async () => ({ data: table === 'bookings' ? row : link ? { meeting_url: link } : null,
          error: table === 'bookings' ? queryError : linkError }) }
      return builder
    } }
  const service = { rpc: async (name, args) => { calls.push({ name, args }); return { data: rpcResult, error: rpcError } } }
  let services = 0
  const api = load('src/app/api/coaching/meeting/[id]/route.ts', { '@/lib/supabase/server': {
    createClient: async () => client, createServiceClient: async () => { services++; return service },
  } })
  return { api, calls, reads, services: () => services }
}
test('unauthenticated meeting read/write/request never obtains service permissions', async () => {
  const h = routeHarness({ userId: null })
  for (const verb of ['GET','PATCH','POST']) assert.equal((await h.api[verb](request(), context)).status, 401)
  assert.equal(h.services(), 0); assert.equal(h.calls.length, 0)
})
test('coach save scopes the atomic write to authenticated identity, ignoring client authority', async () => {
  const h = routeHarness()
  const response = await h.api.PATCH(request(), context)
  assert.equal(response.status, 200)
  assert.deepEqual(h.calls, [{ name: 'set_booking_meeting_link', args: { p_booking_id: id, p_coach_user_id: coachId, p_meeting_url: url } }])
  assert.match(response.headers.get('cache-control'), /no-store/)
  assert.deepEqual(await response.json(), { ok: true })
})
test('malformed, non-JSON and unsafe writes never reach privileged mutation', async () => {
  const h = routeHarness()
  assert.equal((await h.api.PATCH(request('http://zoom.us/x'), context)).status, 400)
  assert.equal((await h.api.PATCH(request(url, { headers: { 'Content-Type': 'text/plain' } }), context)).status, 400)
  assert.equal((await h.api.PATCH(request(url, { body: 'bad json' }), context)).status, 400)
  assert.equal((await h.api.PATCH(request(), { params: Promise.resolve({ id: 'invalid' }) })).status, 404)
  assert.equal(h.services(), 0)
})
test('write ownership/state race refusals and provider errors fail without exposing details', async () => {
  for (const [rpcResult, status] of [['not_found',404],['not_editable',409],['invalid_url',409]]) {
    const h = routeHarness({ rpcResult })
    assert.equal((await h.api.PATCH(request(), context)).status, status)
  }
  const h = routeHarness({ rpcError: { message: 'private database detail' } })
  const response = await h.api.PATCH(request(), context)
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private database detail/)
})
test('both owners open the current link with no cache or referrer; no booking state change', async () => {
  for (const userId of [coachId, buyerId]) {
    const h = routeHarness({ userId })
    const response = await h.api.GET(request(), context)
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), url)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.equal(h.services(), 0); assert.equal(h.calls.length, 0)
  }
})
test('foreign users cannot get a meeting even if a faulty row query returned the booking', async () => {
  const h = routeHarness({ userId: 'foreign-user' })
  assert.equal((await h.api.GET(request(), context)).status, 404)
  assert.deepEqual(h.reads, ['bookings'])
})
test('stale join buttons cannot access cancelled/completed/expired/unpaid sessions', async () => {
  for (const overrides of [{ status: 'cancelled' }, { status: 'completed' }, { payment_status: 'pending' },
    { scheduled_at: new Date(Date.now() - 7200000).toISOString() }]) {
    const h = routeHarness({ row: { ...booking(), ...overrides }, userId: buyerId })
    assert.equal((await h.api.GET(request(), context)).status, 410)
    assert.deepEqual(h.reads, ['bookings'])
  }
})
test('missing, invalid or failed meeting lookups never redirect', async () => {
  for (const [options, status] of [[{ link: null },409],[{ link: 'http://zoom.us/x' },409],
    [{ queryError: { message: 'private detail' } },503],[{ linkError: { message: 'private detail' } },503]]) {
    const response = await routeHarness(options).api.GET(request(), context)
    assert.equal(response.status, status); assert.equal(response.headers.get('location'), null)
    assert.doesNotMatch(await response.text(), /private detail/)
  }
})
test('missing link requests are scoped to authenticated buyer and guarded JSON', async () => {
  const h = routeHarness({ userId: buyerId, rpcResult: 'requested' })
  assert.equal((await h.api.POST(request(), context)).status, 200)
  assert.deepEqual(h.calls[0], { name: 'request_booking_meeting_link', args: { p_booking_id: id, p_buyer_id: buyerId } })
  assert.equal((await h.api.POST(request(url, { headers: { 'Content-Type': 'text/plain' } }), context)).status, 400)
  assert.equal(h.calls.length, 1)
})

const ui = load('src/app/session/[id]/MeetingAccess.tsx', { 'next/navigation': { useRouter: () => ({ refresh() {} }) } })
const markup = props => renderToStaticMarkup(React.createElement(ui.default, { bookingId: id, meetingUrl: null, isCoach: false, loadFailed: false, ...props }))
test('coach has labelled mobile form and missing-link warning, customer has request action', () => {
  const coach = markup({ isCoach: true }), buyer = markup({})
  assert.match(coach, /Noch kein Meeting-Link/); assert.match(coach, /for="meeting-url"/)
  assert.match(coach, /type="url"/); assert.match(coach, /maxLength="2048"/)
  assert.match(coach, /w-full min-w-0/); assert.match(coach, /min-h-11/)
  assert.match(buyer, /Meeting-Link beim Coach anfragen/); assert.doesNotMatch(buyer, /<input|<form|buyer\/chat/)
})
test('owner meeting UI uses protected join route, external-tab notice and readable provider', () => {
  const html = markup({ meetingUrl: url })
  assert.match(html, new RegExp(`/api/coaching/meeting/${id}`))
  assert.match(html, /rel="noopener noreferrer"/); assert.match(html, /Dienst: meet.google.com/)
  assert.match(html, /Europe\/Berlin/); assert.doesNotMatch(html, /href="https:\/\/meet.google.com/)
  assert.doesNotMatch(html, /Meeting-Link beim Coach anfragen/)
})
test('meeting load error is distinct from a missing link and does not offer a spurious request', () => {
  const html = markup({ loadFailed: true })
  assert.match(html, /role="alert"/); assert.doesNotMatch(html, /Meeting-Link beim Coach anfragen/)
})

function find(element, predicate) {
  if (!element || typeof element !== 'object') return null
  if (predicate(element)) return element
  for (const child of React.Children.toArray(element.props?.children)) { const found = find(child,predicate); if (found) return found }
  return null
}
function editorHarness(reply, isCoach = true) {
  const states = [], calls = []
  let index = 0, refreshes = 0
  const component = load('src/app/session/[id]/MeetingAccess.tsx', {
    react: { ...React, useState(initial) {
      const slot = index++; if (!(slot in states)) states[slot] = initial
      return [states[slot], value => { states[slot] = value }]
    } },
    'next/navigation': { useRouter: () => ({ refresh() { refreshes++ } }) },
  }, { fetch: async (_url, options) => { calls.push(options); return reply() } }).default
  return { tree: () => { index = 0; return component({ bookingId:id,meetingUrl:null,isCoach,loadFailed:false }) },
    calls, refreshes: () => refreshes }
}
test('failed/network/non-JSON save keeps the editor retryable without claiming the meeting is ready', async () => {
  for (const reply of [async () => ({ ok:false,json:async () => ({ error:'Retryable synthetic error' }) }),
    async () => { throw new Error('network') }, async () => ({ ok:true,json:async () => { throw new SyntaxError('json') } })]) {
    const h = editorHarness(reply)
    find(h.tree(),e => e.type === 'input').props.onChange({ target:{ value:url } })
    await find(h.tree(),e => e.type === 'form').props.onSubmit({ preventDefault() {} })
    const html = renderToStaticMarkup(h.tree())
    assert.match(html,/role="alert"/); assert.doesNotMatch(html,/Meeting öffnen|Meeting-Link gespeichert/)
    assert.equal(find(h.tree(),e => e.type === 'button').props.disabled,false); assert.equal(h.refreshes(),0)
  }
})
test('successful editor sends only commercial-neutral meeting value and shows guarded join without changing booking state', async () => {
  const h = editorHarness(async () => ({ ok:true,json:async () => ({ ok:true }) }))
  find(h.tree(),e => e.type === 'input').props.onChange({ target:{ value:url } })
  await find(h.tree(),e => e.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(JSON.parse(h.calls[0].body),{ meetingUrl:url }); assert.equal(h.calls[0].method,'PATCH')
  assert.equal(h.refreshes(),1); assert.match(renderToStaticMarkup(h.tree()),/Meeting-Link gespeichert/)
  assert.match(renderToStaticMarkup(h.tree()),/Meeting öffnen/)
})
test('buyer link request reports success and blocks a second local request without exposing an editor', async () => {
  const h = editorHarness(async () => ({ ok:true,json:async () => ({ ok:true,ready:false }) }),false)
  await find(h.tree(),e => e.type === 'button').props.onClick()
  assert.equal(h.calls.length,1); assert.equal(h.calls[0].method,'POST')
  await find(h.tree(),e => e.type === 'button').props.onClick()
  assert.equal(h.calls.length,1); assert.match(renderToStaticMarkup(h.tree()),/Coach benachrichtigt/)
  assert.equal(find(h.tree(),e => e.type === 'button').props.disabled,true)
})

function pageHarness(userId = buyerId, row = booking()) {
  const reads = [], videos = [], meetings = []
  const client = { auth:{ getUser:async () => ({ data:{ user:userId ? { id:userId } : null } }) }, from(table) {
    reads.push(table)
    const builder = { select:() => builder, eq:() => builder,
      single:async () => ({ data:row }), maybeSingle:async () => ({ data:{ meeting_url:url } }) }
    return builder
  } }
  const page = load('src/app/session/[id]/page.tsx', {
    '@/lib/supabase/server': { createClient:async () => client },
    '@/lib/features': { VIDEO_CALLS_ENABLED:false },
    'next/navigation': { redirect:path => { throw new Error(`redirect:${path}`) }, notFound:() => { throw new Error('not_found') } },
    'next/link': { __esModule:true,default:({ children }) => children },
    './VideoRoom': { __esModule:true,default:props => { videos.push(props); return null } },
    './MeetingAccess': { __esModule:true,default:props => { meetings.push(props); return React.createElement('p',null,'Private synthetic meeting UI') } },
  }).default
  return { page, reads, videos, meetings }
}
test('unauthenticated session preserves safe login return, foreign returned rows fail before any link read', async () => {
  const anonymous = pageHarness(null)
  await assert.rejects(anonymous.page(context),/redirect:\/login\?redirect=%2Fsession%2F/)
  assert.deepEqual(anonymous.reads,[])
  const foreign = pageHarness('foreign')
  await assert.rejects(foreign.page(context),/not_found/)
  assert.deepEqual(foreign.reads,['bookings'])
})
test('owned session renders external method and no Daily component; completed/stornied pages do not load private link', async () => {
  const owner = pageHarness(coachId,{ ...booking(),daily_room_url:'https://private.daily.co/synthetic' })
  renderToStaticMarkup(await owner.page(context))
  assert.equal(owner.meetings.length,1); assert.equal(owner.meetings[0].isCoach,true); assert.equal(owner.videos.length,0)
  for (const status of ['completed','cancelled']) {
    const h = pageHarness(coachId,{ ...booking(),status })
    const html = renderToStaticMarkup(await h.page(context))
    assert.deepEqual(h.reads,['bookings']); assert.equal(h.meetings.length,0)
    assert.match(html,/kein Meeting-Zugang/); assert.doesNotMatch(html,/Live jetzt|Zahlung ausstehend/)
    if (status === 'cancelled') assert.match(html,/beim Anbieter/)
  }
})

const emails = load('src/lib/email/templates.ts', { '@/lib/features': { VIDEO_CALLS_ENABLED: false } })
test('confirmation/reminder identify missing versus ready method, roles and Berlin time, without raw meeting URLs', () => {
  const data = { recipientName: 'Synthetic', coachName: 'Synthetic coach', scheduledDate: '10. Oktober 2026',
    scheduledTime: '12:00', durationMinutes: 60, minutesUntil: 1440, sessionUrl: `https://www.ardore-health.com/session/${id}` }
  for (const role of ['buyer','creator']) for (const meetingReady of [false,true]) {
    const fixture = { ...data, role, meetingReady }
    for (const format of ['bookingConfirmationHtml','bookingConfirmationText','sessionReminderHtml','sessionReminderText']) {
      const body = emails[format](fixture)
      assert.ok(body.includes(data.sessionUrl)); assert.match(body, /Europe\/Berlin/)
      assert.doesNotMatch(body, /bald verfügbar|https:\/\/meet.google.com/)
      assert.match(body, meetingReady ? /immer den aktuellen Link/ : role === 'creator' ? /hinterlege vor dem Termin/ : /beim Coach anfragen/)
    }
  }
})

test('reminder cron forwards current method presence and role for both participants without emailing raw URL', async () => {
  for (const ready of [true,false]) {
    const sent = []
    const service = { auth: { admin: { getUserById: async owner => ({ data: { user: { email: `${owner}@resend.dev` } } }) } }, from(table) {
      const result = table === 'bookings' ? { data: [booking()] } : table === 'booking_meeting_links' ? { data: ready ? [{ booking_id: id }] : [] } : { count: 0 }
      const builder = new Proxy({ then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) }, {
        get: (target, key) => key in target ? target[key] : () => builder,
      })
      return builder
    } }
    const cron = load('src/app/api/cron/session-reminders/route.ts', {
      '@/lib/supabase/server': { createServiceClient: async () => service },
      '@/lib/notifications': { createNotification: async () => {}, checkNotificationPreference: async () => true },
      '@/lib/email/send': { sendSessionReminder: async (_to, data) => sent.push(data) },
    })
    const oldSecret = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'synthetic-unit-only'
    try {
      const response = await cron.GET(new Request('https://www.ardore-health.com/api/cron/session-reminders', { headers: { authorization: 'Bearer synthetic-unit-only' } }))
      assert.equal(response.status, 200); assert.equal(sent.length, 2)
      assert.deepEqual(sent.map(data => data.role), ['creator','buyer'])
      for (const data of sent) {
        assert.equal(data.meetingReady, ready); assert.ok(data.scheduledDate)
        assert.ok(data.sessionUrl.endsWith(`/session/${id}`)); assert.ok(!JSON.stringify(data).includes(url))
      }
    } finally { if (oldSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret }
  }
})

test('migration isolates private URLs and serializes authenticated-owner-only writes without financial changes', () => {
  const directory = new URL('../supabase/migrations/', import.meta.url)
  const name = readdirSync(directory).find(name => name.endsWith('_private_booking_meeting_links.sql'))
  const sql = readFileSync(new URL(name, directory), 'utf8')
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public.booking_meeting_links FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /GRANT SELECT ON public.booking_meeting_links TO authenticated/)
  assert.doesNotMatch(sql, /GRANT.*(?:INSERT|UPDATE|DELETE).*TO authenticated/)
  assert.match(sql, /c.user_id = p_coach_user_id/); assert.match(sql, /booking.buyer_id = p_buyer_id/)
  assert.match(sql, /FOR UPDATE OF booking/); assert.match(sql, /ON CONFLICT \(booking_id\) DO UPDATE/)
  assert.equal((sql.match(/SECURITY INVOKER SET search_path = ''/g) ?? []).length, 2)
  assert.equal((sql.match(/FROM PUBLIC, anon, authenticated/g) ?? []).length, 3)
  assert.doesNotMatch(sql, /UPDATE public.bookings|UPDATE public.creator_profiles|stripe\.transfers|auth.users/)
  assert.match(readFileSync(new URL('../src/lib/features.ts', import.meta.url), 'utf8'), /VIDEO_CALLS_ENABLED = false/)
})
