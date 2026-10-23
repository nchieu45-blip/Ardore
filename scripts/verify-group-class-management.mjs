// Local-only management/authorization fixtures. No database or provider access.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const input = loadUiComponent('src/lib/group-class-input.ts')
const course = () => ({ title: 'Abend-Yoga', description: null, schedule_type: 'recurring', starts_at: null, recurring_weekday: 1, recurring_time: '18:00', duration_minutes: 60, max_participants: 8, price_cents: 1200, included_in_subscription: false, active: true })
const id = '12345678-1234-4234-8234-123456789012'
const context = { params: Promise.resolve({ id }) }
function request(method, body, headers = {}) {
  return new Request(`http://localhost:3010/api/video-classes/${id}`, { method, headers: { origin: 'http://localhost:3010', 'content-type': 'application/json', ...headers }, body: method === 'DELETE' ? undefined : JSON.stringify(body) })
}
function management({ user = 'coach', creator = 'owner', current = course(), error = null, deleted = { id } } = {}) {
  const writes = [], reads = []
  const client = { auth: { getUser: async () => ({ data: { user: user && { id: user } } }) }, from(table) {
    const read = { table, filters: [] }; reads.push(read)
    let writing = false
    const query = {
      select: () => query, eq(key, value) { read.filters.push([key, value]); return query },
      insert(value) { writing = true; writes.push({ kind: 'insert', value, read }); return query },
      update(value) { writing = true; writes.push({ kind: 'update', value, read }); return query },
      delete() { writing = true; writes.push({ kind: 'delete', read }); return query },
      single: async () => ({ data: table === 'creator_profiles' ? creator && { id: creator } : course(), error: writing ? error : null }),
      maybeSingle: async () => ({ data: writing ? deleted : current, error: writing ? error : null }),
    }
    return query
  } }
  const overrides = { '@/lib/supabase/server': { createClient: async () => client }, '@/lib/app-url': { appOrigin: () => 'http://localhost:3010' } }
  return { reads, writes, api: loadUiComponent('src/app/api/video-classes/[id]/route.ts', overrides), create: loadUiComponent('src/app/api/video-classes/route.ts', overrides) }
}

test('course input preserves valid terms but refuses unknown authority, fractional prices and unsupported room sizes', () => {
  assert.equal(input.parseGroupClassInput(course()).price_cents, 1200)
  assert.equal(input.parseGroupClassInput({ ...course(), max_participants: null }).max_participants, 199)
  for (const bad of [{ price_cents: 1 }, { price_cents: 12.5 }, { price_cents: -1 }, { price_cents: Infinity }, { max_participants: 200 }, { max_participants: 0 }, { duration_minutes: 4 }, { duration_minutes: 481 }, { recurring_weekday: 7 }, { recurring_time: '02:30:01' }, { recurring_time: '25:00' }, { title: ' ' }, { creator_id: 'attacker' }, { daily_room_url: 'https://example.test' }]) assert.equal(input.parseGroupClassInput({ ...course(), ...bad }), null, JSON.stringify(bad))
  for (const bad of [null, [], {}, { creator_id: 'attacker' }]) assert.equal(input.groupClassBodyKeysValid(bad), false)
})

test('course create binds the authenticated coach and rejects unsafe or past requests before writes', async () => {
  const h = management()
  assert.equal((await h.create.POST(request('POST', course()))).status, 200)
  assert.equal(h.writes[0].value.creator_id, 'owner')
  assert.equal(h.writes[0].value.active, true)
  for (const [body, headers, status] of [[{ ...course(), creator_id: 'other' }, {}, 400], [course(), { origin: 'https://evil.test' }, 403], [course(), { 'content-type': 'text/plain' }, 400], [{ ...course(), schedule_type: 'once', starts_at: '2000-01-01T00:00:00Z' }, {}, 400]]) {
    const rejected = management()
    assert.equal((await rejected.create.POST(request('POST', body, headers))).status, status)
    assert.equal(rejected.writes.length, 0)
  }
  const anonymous = management({ user: null })
  assert.equal((await anonymous.create.POST(request('POST', course()))).status, 401)
  assert.equal(anonymous.writes.length, 0)
})

test('course edits scope read and write to the owner and never overwrite unrelated snapshot fields', async () => {
  const h = management()
  assert.equal((await h.api.PATCH(request('PATCH', { active: false }), context)).status, 200)
  assert.deepEqual(h.writes[0].value, { active: false })
  assert.deepEqual(h.writes[0].read.filters, [['id', id], ['creator_id', 'owner']])
  assert.ok(h.reads.filter(read => read.table === 'video_classes').every(read => read.filters.some(([key, value]) => key === 'creator_id' && value === 'owner')))
  const missing = management({ current: null })
  assert.equal((await missing.api.PATCH(request('PATCH', { price_cents: 1500 }), context)).status, 404)
  assert.equal(missing.writes.length, 0)
})

test('blocked course mutations are honest conflicts, preserve data and hide database details', async () => {
  for (const method of ['PATCH', 'DELETE']) {
    const h = management({ error: { code: '23514', message: 'private SQL detail' } })
    const response = await h.api[method](request(method, { duration_minutes: 90 }), context)
    assert.equal(response.status, 409)
    assert.match(await response.text(), /Bereits gebuchte Termine bleiben erhalten/)
    assert.equal(h.writes.length, 1)
  }
  const vanished = management({ deleted: null })
  assert.equal((await vanished.api.DELETE(request('DELETE'), context)).status, 404)
  const denied = management()
  assert.equal((await denied.api.DELETE(request('DELETE', null, { origin: 'https://evil.test' }), context)).status, 403)
  assert.equal(denied.writes.length, 0)
})

const reservation = overrides => ({ id: 'reservation', video_class_id: id, occurrence_start: '2026-12-01T12:00:00Z', duration_minutes: 60, class_title: 'Yoga', creator_slug: 'coach', price_cents: 1200, status: 'confirmed', booking_id: 'booking', refund_status: 'not_requested', amount_refunded_cents: 0, stripe_livemode: true, ...overrides })
function buyerPage(rows, error = null) {
  const reads = []
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'buyer' } } }) }, from(table) {
    const read = { table }; reads.push(read)
    const query = { select(fields) { read.fields = fields; return query }, eq: () => query, is: () => query, order: async () => ({ data: table === 'group_booking_status' ? rows : [], error: table === 'group_booking_status' ? error : null }) }
    return query
  } }
  const page = loadUiComponent('src/app/buyer/video-classes/page.tsx', { '@/lib/supabase/server': { createClient: async () => client }, '@/components/GroupBookingActions': { __esModule: true, default: () => null }, 'next/navigation': { redirect() { throw new Error('redirect') } } }).default
  return { reads, html: async () => renderToStaticMarkup(await page({ searchParams: Promise.resolve({ checkout: 'success' }) })) }
}

test('Stripe return query is informational; only confirmed live unrefunded reservations offer video access', async () => {
  for (const changes of [{ stripe_livemode: null }, { stripe_livemode: false }, { status: 'processing' }, { status: 'refund_pending' }, { refund_status: 'pending' }, { amount_refunded_cents: 1 }]) {
    const h = buyerPage([reservation(changes)])
    const html = await h.html()
    assert.doesNotMatch(html, /Termin und Videozugang öffnen/)
    assert.match(html, /Rückkehr von Stripe bestätigt allein noch keine Teilnahme/)
    assert.ok(h.reads.every(read => !/daily_room_url|stripe_checkout|request_id|buyer_email/.test(read.fields)))
  }
  assert.match(await buyerPage([reservation()]).html(), /Termin und Videozugang öffnen/)
  assert.match(await buyerPage([reservation({ price_cents: 0, stripe_livemode: null })]).html(), /Termin und Videozugang öffnen/)
  assert.match(await buyerPage([], { code: '42703' }).html(), /nicht vollständig geladen/)
})

function sessionPage({ user = 'buyer', own = null, coach = 'coach' } = {}) {
  let privilegedReads = 0
  const course = { id, creator_id: 'creator', title: 'Yoga', duration_minutes: 60, creator_profiles: { user_id: coach, display_name: 'Coach' } }
  const client = { auth: { getUser: async () => ({ data: { user: user && { id: user } } }) }, from(table) {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'video_classes' ? course : own }), order: () => q, limit: async () => ({ data: [] }) }; return q
  } }
  const api = loadUiComponent('src/app/group-session/[id]/page.tsx', {
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => { privilegedReads++; return { from() { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { video_class_id: id, starts_at: '2026-12-01T12:00:00.000Z', duration_minutes: 60, class_title: 'Snapshot title' } }) }; return q } } } },
    'next/navigation': { notFound() { throw new Error('not found') }, redirect() { throw new Error('login') } },
    '@/components/ProtectedVideoRoom': { __esModule: true, default: ({ endpoint }) => React.createElement('div', { 'data-video-endpoint': endpoint }) },
    '@/components/GroupBookingActions': { __esModule: true, default: () => null },
  }).default
  return { call: () => api({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ occurrenceStart: '2026-12-01T12:00:00Z' }) }), get privilegedReads() { return privilegedReads } }
}

test('group session never performs privileged reads for anonymous or unregistered users', async () => {
  for (const [options, message] of [[{ user: null }, /login/], [{ own: null }, /not found/], [{ own: { user_id: 'other' } }, /not found/]]) {
    const h = sessionPage(options)
    await assert.rejects(h.call(), message)
    assert.equal(h.privilegedReads, 0)
  }
})

test('group session uses frozen metadata and withholds video for cancelled, TEST or unpaid registrations', async () => {
  const attendee = { user_id: 'buyer', reservation_id: 'reservation', status: 'confirmed', price_paid_cents: 1200, payment_status: 'paid', stripe_livemode: true, refund_status: 'not_requested', amount_refunded_cents: 0 }
  for (const changes of [{ status: 'cancelled' }, { stripe_livemode: false }, { stripe_livemode: null }, { reservation_id: null }, { payment_status: 'pending' }, { refund_status: 'pending' }]) {
    const h = sessionPage({ own: { ...attendee, ...changes } })
    const html = renderToStaticMarkup(await h.call())
    assert.doesNotMatch(html, /data-video-endpoint/)
    assert.match(html, /Snapshot title/)
  }
  assert.match(renderToStaticMarkup(await sessionPage({ own: attendee }).call()), /data-video-endpoint/)
})
