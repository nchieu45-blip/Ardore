// Local-only provider/route fixtures. No environment loading, real video rooms,
// tokens, database users, network requests, payments or email are created.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, mocks = {}) {
  mocks = { '@/lib/group-effective-schedule': { effectiveGroupStart: async (_client, _class, start) => start }, ...mocks }
  const loadedModule = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'exports', 'module', source)(name => mocks[name] ?? require(name), loadedModule.exports, loadedModule)
  return loadedModule.exports
}

const capacity = load('src/lib/group-capacity.ts')
const video = load('src/lib/video-provider.ts', { '@/lib/group-capacity': capacity })
const payment = load('src/lib/coaching-payment.ts')
const actor = '00000000-0000-4000-8000-000000000001'
const buyer = '00000000-0000-4000-8000-000000000002'
const stranger = '00000000-0000-4000-8000-000000000003'
const bookingId = '10000000-0000-4000-8000-000000000001'
const start = () => new Date(Date.now() - 5 * 60_000).toISOString()
const token = 'synthetic.token.signature'
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const credential = process.env.DAILY_API_KEY
process.env.DAILY_API_KEY = 'synthetic-daily-test-credential'
process.on('exit', () => { if (credential === undefined) delete process.env.DAILY_API_KEY; else process.env.DAILY_API_KEY = credential })

function provider(options = {}) {
  const calls = []
  let created = null
  const input = {
    kind: 'coaching', identity: bookingId, startsAt: start(), durationMinutes: 60,
    userId: buyer, userName: 'Fixture participant', isOwner: false,
    reauthorize: async () => {}, ...options.input,
  }
  const room = () => ({ name: video.videoRoomName(input.kind, input.identity, input.startsAt), api_created: true,
    privacy: 'private', url: `https://synthetic.daily.co/${video.videoRoomName(input.kind, input.identity, input.startsAt)}`,
    config: { nbf: Math.floor((Date.parse(input.startsAt) - 15 * 60_000) / 1000),
      exp: Math.floor((Date.parse(input.startsAt) + input.durationMinutes * 60_000) / 1000),
      enable_knocking: false, eject_at_room_exp: true, enforce_unique_user_ids: true, max_participants: input.kind === 'coaching' ? 2 : capacity.GROUP_ROOM_CAPACITY },
  })
  const fetch = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, init, body })
    assert.ok(url.startsWith('https://api.daily.co/v1/'), 'Only the fixed official provider may receive credentials')
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
    if (options.failure) throw new Error('private-provider-secret')
    if (init.method === 'GET') {
      if (options.lookupStatus) return json({}, options.lookupStatus)
      if (options.absent && !created) return json({}, 404)
      return json({ ...room(), ...options.room, config: { ...room().config, ...options.config } })
    }
    if (url.endsWith('/rooms')) {
      created = body
      return options.conflict ? json({}, 409) : json({ ...room(), ...options.room, config: { ...room().config, ...options.config } })
    }
    assert.ok(url.endsWith('/meeting-tokens'))
    return json({ token: options.token ?? token })
  }
  return { input, calls, fetch, get created() { return created } }
}

test('video window opens 15 minutes before the appointment and closes at its end', () => {
  const at = Date.parse('2026-10-18T12:00:00.000Z')
  assert.throws(() => video.videoJoinWindow('invalid', 60, at), { status: 409 })
  assert.throws(() => video.videoJoinWindow('2026-10-18T12:00:00Z', 0, at), { status: 409 })
  assert.throws(() => video.videoJoinWindow('2026-10-18T12:00:00Z', 60, at - 15 * 60_000 - 1), { status: 409 })
  assert.equal(video.videoJoinWindow('2026-10-18T12:00:00Z', 60, at - 15 * 60_000).end, at + 60 * 60_000)
  assert.throws(() => video.videoJoinWindow('2026-10-18T12:00:00Z', 60, at + 60 * 60_000), { status: 410 })
})

test('deterministic rooms isolate booking kinds, reschedules and recurring occurrences', () => {
  const stamp = '2026-10-18T12:00:00.000Z'
  const name = video.videoRoomName('coaching', bookingId, stamp)
  assert.match(name, /^ardore-v2-coaching-[a-f0-9]{40}$/)
  assert.equal(name, video.videoRoomName('coaching', bookingId, '2026-10-18T14:00:00+02:00'))
  assert.notEqual(name, video.videoRoomName('group', bookingId, stamp))
  assert.notEqual(name, video.videoRoomName('coaching', bookingId, '2026-10-19T12:00:00Z'))
  assert.equal(video.canonicalOccurrenceStart('2026-10-18'), null)
  assert.equal(video.canonicalOccurrenceStart('2026-10-18T12:00:00'), null)
  assert.equal(video.canonicalOccurrenceStart('2026-02-30T12:00:00Z'), null)
  assert.equal(video.canonicalOccurrenceStart('2026-10-18T14:00:00.123456+02:00'), '2026-10-18T12:00:00.123456Z')
  assert.equal(video.canonicalOccurrenceStart('2026-10-18T14:00:00.123400+02:00'), '2026-10-18T12:00:00.1234Z')
  assert.equal(video.canonicalOccurrenceStart('2026-10-18T12:00:00.1234Z'), '2026-10-18T12:00:00.1234Z')
  assert.notEqual(video.videoRoomName('group', bookingId, '2026-10-18T12:00:00.123456Z'), video.videoRoomName('group', bookingId, '2026-10-18T12:00:00.123457Z'))
})

test('new rooms are private, cannot be entered by knocking and eject everyone at the session end', async () => {
  const fixture = provider({ absent: true })
  const access = await video.createVideoAccess(fixture.input, fixture.fetch)
  assert.equal(access.token, token)
  assert.equal(fixture.created.privacy, 'private')
  assert.equal(fixture.created.properties.enable_knocking, false)
  assert.equal(fixture.created.properties.eject_at_room_exp, true)
  assert.equal(fixture.created.properties.enforce_unique_user_ids, true)
  assert.equal(fixture.created.properties.max_participants, 2)
  const properties = fixture.calls.find(call => call.url.endsWith('/meeting-tokens')).body.properties
  assert.equal(properties.is_owner, false)
  assert.equal(properties.room_name, fixture.created.name)
  assert.equal(properties.exp, fixture.created.properties.exp)
  assert.equal(properties.nbf, fixture.created.properties.nbf)
  assert.equal(properties.eject_at_token_exp, true)
  assert.notEqual(properties.user_id, buyer, 'Provider receives a room-scoped pseudonym')
  assert.equal(properties.enable_recording_ui, false)
})

test('only the authorized coach gets owner privileges and group room capacity includes the coach', async () => {
  const fixture = provider({ absent: true, input: { kind: 'group', userId: actor, isOwner: true } })
  await video.createVideoAccess(fixture.input, fixture.fetch)
  assert.equal(fixture.created.properties.max_participants, 10)
  assert.equal(fixture.calls.find(call => call.url.endsWith('/meeting-tokens')).body.properties.is_owner, true)
})

test('an existing private room is validated before reuse and never recreated', async () => {
  const fixture = provider()
  await video.createVideoAccess(fixture.input, fixture.fetch)
  assert.equal(fixture.created, null)
  assert.equal(fixture.calls.length, 2)
})

test('racing deterministic room creation recovers through a private room lookup', async () => {
  const fixture = provider({ absent: true, conflict: true })
  await video.createVideoAccess(fixture.input, fixture.fetch)
  assert.equal(fixture.calls.filter(call => call.url.endsWith('/rooms')).length, 1)
  assert.equal(fixture.calls.filter(call => call.init.method === 'GET').length, 2)
})

test('unsafe, legacy or mismatched provider rooms never receive a participant token', async () => {
  const variants = [
    { room: { privacy: 'public' } }, { room: { api_created: false } }, { room: { name: 'legacy-room' } },
    { room: { url: 'https://untrusted.invalid/room' } }, { room: { url: 'https://synthetic.daily.co/foreign-room' } },
    { config: { enable_knocking: true } }, { config: { exp: 9999999999 } }, { config: { nbf: 0 } },
    { config: { eject_at_room_exp: false } }, { config: { max_participants: 500 } }, { config: { enforce_unique_user_ids: false } },
  ]
  for (const variant of variants) {
    const fixture = provider(variant)
    await assert.rejects(video.createVideoAccess(fixture.input, fixture.fetch), { status: 503 })
    assert.equal(fixture.calls.filter(call => call.url.endsWith('/meeting-tokens')).length, 0)
  }
})

test('missing provider configuration, outages and malformed tokens return explicit failures', async () => {
  const fixture = provider()
  delete process.env.DAILY_API_KEY
  await assert.rejects(video.createVideoAccess(fixture.input, fixture.fetch), { status: 503 })
  assert.equal(fixture.calls.length, 0)
  process.env.DAILY_API_KEY = 'synthetic-daily-test-credential'
  for (const options of [{ failure: true }, { lookupStatus: 403 }, { token: 'malformed' }]) {
    const local = provider(options)
    await assert.rejects(video.createVideoAccess(local.input, local.fetch), error => error.status === 503 && !error.message.includes('private-provider-secret'))
  }
})

test('revoked entitlement is checked again before token creation and before returning access', async () => {
  for (const deniedCall of [2, 3]) {
    let checked = 0
    const fixture = provider({ input: { reauthorize: async () => { if (++checked === deniedCall) throw new video.VideoAccessError(409, 'Revoked') } } })
    await assert.rejects(video.createVideoAccess(fixture.input, fixture.fetch), { status: 409 })
    if (deniedCall === 2) assert.equal(fixture.calls.filter(call => call.url.endsWith('/meeting-tokens')).length, 0)
  }
})

function coachingRoute(options = {}) {
  const fixture = provider()
  const booking = {
    id: bookingId, buyer_id: buyer, buyer_name: 'Synthetic buyer', price_cents: 0,
    status: 'confirmed', payment_status: 'not_required', stripe_livemode: null,
    refund_status: 'not_requested', scheduled_at: fixture.input.startsAt, duration_minutes: 60,
    creator_profiles: { user_id: actor, display_name: 'Synthetic coach' }, ...options.booking,
  }
  const calls = []
  let reads = 0
  const client = {
    auth: { getUser: async () => ({ data: { user: options.user === null ? null : { id: options.user ?? buyer } }, error: options.authError ?? null }) },
    from(table) {
      assert.equal(table, 'bookings')
      return { select() { return this }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, bookingId); return this },
        async maybeSingle() { reads++; return { data: options.missing ? null : (options.changed && reads > 1 ? { ...booking, status: 'cancelled' } : booking), error: options.databaseError ?? null } } }
    },
  }
  const route = load('src/app/api/coaching/meeting/[id]/join/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/app-url': { appOrigin: () => 'https://ardore.synthetic' },
    '@/lib/features': { VIDEO_CALLS_ENABLED: options.enabled ?? true },
    '@/lib/coaching-payment': payment,
    '@/lib/video-provider': { ...video, createVideoAccess: async input => { calls.push(input); return video.createVideoAccess(input, fixture.fetch) } },
  })
  return { calls, fixture, async post(input = {}, headers = {}) {
    const response = await route.POST(new Request('https://ardore.synthetic/api/coaching/meeting/' + bookingId + '/join', {
      method: 'POST', headers: { Origin: 'https://ardore.synthetic', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
    }), { params: Promise.resolve({ id: bookingId }) })
    return { response, body: await response.json() }
  } }
}

test('1:1 joining authenticates and validates exact buyer/coach entitlement before touching the provider', async () => {
  for (const options of [
    { user: null }, { user: stranger }, { missing: true }, { booking: { status: 'cancelled' } },
    { booking: { payment_status: 'pending', price_cents: 100 } },
    { booking: { payment_status: 'paid', stripe_livemode: false, price_cents: 100 } },
    { booking: { payment_status: 'refunded' } }, { booking: { refund_status: 'pending' } },
    { booking: { price_cents: 100, payment_status: 'not_required' } },
    { booking: { scheduled_at: new Date(Date.now() + 3600_000).toISOString() } },
    { booking: { scheduled_at: new Date(Date.now() - 7200_000).toISOString() } },
    { databaseError: { message: 'private-database-detail' } }, { enabled: false },
  ]) {
    const local = coachingRoute(options)
    const result = await local.post()
    assert.ok(result.response.status >= 400)
    assert.equal(local.calls.length, 0)
    assert.equal(local.fixture.calls.length, 0)
    assert.ok(!JSON.stringify(result.body).includes('private-database-detail'))
    assert.equal(result.response.headers.get('Cache-Control'), 'private, no-store')
  }
})

test('1:1 buyer and coach receive different privilege levels; valid LIVE payment is accepted', async () => {
  for (const user of [buyer, actor]) {
    const local = coachingRoute({ user, booking: { price_cents: 5000, payment_status: 'paid', stripe_livemode: true } })
    const result = await local.post()
    assert.equal(result.response.status, 200)
    assert.equal(result.body.token, token)
    assert.equal(local.calls[0].isOwner, user === actor)
    assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer')
  }
})

test('1:1 rejects cross-site calls, injected owner/room fields and concurrent cancellation', async () => {
  for (const [body, headers] of [[{}, { Origin: 'https://foreign.invalid' }], [{ isOwner: true }, {}], [{ roomUrl: 'https://foreign.invalid' }, {}], [[], {}]]) {
    const local = coachingRoute()
    assert.ok((await local.post(body, headers)).response.status >= 400)
    assert.equal(local.calls.length, 0)
  }
  const local = coachingRoute({ changed: true })
  assert.equal((await local.post()).response.status, 409)
  assert.equal(local.fixture.calls.length, 0)
})

test('confirmation and rescheduling perform no eager video-provider room mutations', () => {
  for (const path of ['src/lib/coaching-confirmation.ts', 'src/app/api/coaching/reschedule/route.ts']) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /api\.daily\.co|DAILY_API_KEY|daily_room_name|daily_room_url/)
  }
})

const classId = '20000000-0000-4000-8000-000000000001'
const profileId = '30000000-0000-4000-8000-000000000001'
const reservationId = '40000000-0000-4000-8000-000000000001'

function groupRoute(options = {}) {
  const fixture = provider({ input: { kind: 'group', identity: classId, ...options.input } })
  const user = options.user === null ? null : { id: options.user ?? buyer }
  const course = { id: classId, creator_id: profileId, duration_minutes: 60,
    creator_profiles: { user_id: actor, display_name: 'Synthetic group coach' }, ...options.course }
  const booking = {
    id: bookingId, user_id: buyer, video_class_id: classId, occurrence_start: fixture.input.startsAt,
    duration_minutes: 60, status: 'confirmed', price_paid_cents: options.paid ? 5000 : 0,
    payment_status: options.paid ? 'paid' : 'not_required', stripe_livemode: options.paid ? true : null,
    refund_status: 'not_requested', amount_refunded_cents: 0,
    payment_order_id: options.paid ? reservationId : null, reservation_id: reservationId, ...options.booking,
  }
  const occurrence = { video_class_id: classId, starts_at: fixture.input.startsAt, duration_minutes: 60,
    class_title: 'Synthetic group class', ...options.occurrence }
  const order = { id: reservationId, kind: 'group', buyer_id: buyer, creator_id: profileId,
    state: 'fulfilled', gross_cents: 5000, stripe_livemode: true,
    reference: { reservationId, videoClassId: classId, occurrenceStart: fixture.input.startsAt, durationMinutes: 60 }, ...options.order }
  const reservation = { id: reservationId, buyer_id: buyer, creator_id: profileId, video_class_id: classId,
    occurrence_start: fixture.input.startsAt, duration_minutes: 60, price_cents: 5000, stripe_livemode: true,
    status: 'confirmed', booking_id: bookingId, payment_order_id: reservationId,
    refund_status: 'not_requested', amount_refunded_cents: 0, ...options.reservation }
  const privateReads = [], rpcCalls = [], calls = []
  let bookingReads = 0
  let canonicalPresent = !options.canonicalMissing
  const query = (table, privileged = false) => {
    const filters = {}
    if (privileged) privateReads.push(table)
    return { select() { return this }, eq(key, value) { filters[key] = value; return this }, async maybeSingle() {
      if (!privileged) {
        if (table === 'video_classes') return { data: options.classMissing ? null : course, error: options.classError ?? null }
        assert.equal(table, 'video_class_bookings')
        assert.equal(filters.video_class_id, classId)
        assert.equal(filters.user_id, user?.id, 'Authenticated actor controls the participant query')
        assert.equal(filters.occurrence_start, fixture.input.startsAt)
        assert.equal(filters.status, 'confirmed')
        bookingReads++
        return { data: options.bookingMissing ? null : (options.changed && bookingReads > 1 ? { ...booking, status: 'cancelled' } : booking), error: options.bookingError ?? null }
      }
      if (table === 'video_class_occurrences') {
        assert.equal(filters.video_class_id, classId); assert.equal(filters.starts_at, fixture.input.startsAt)
        return { data: canonicalPresent ? occurrence : null, error: options.occurrenceError ?? null }
      }
      if (table === 'payment_orders') {
        assert.equal(filters.id, reservationId)
        return { data: options.orderMissing ? null : order, error: options.paymentError ?? null }
      }
      assert.equal(table, 'group_booking_reservations')
      assert.equal(filters.id, reservationId)
      return { data: options.reservationMissing ? null : reservation, error: options.paymentError ?? null }
    } }
  }
  const client = { auth: { getUser: async () => ({ data: { user }, error: options.authError ?? null }) }, from: table => query(table) }
  const service = {
    from: table => query(table, true),
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      assert.equal(user?.id, actor, 'Only the owning coach may create a canonical occurrence')
      assert.equal(name, 'ensure_group_class_occurrence')
      assert.deepEqual(args, { p_class_id: classId, p_occurrence_start: fixture.input.startsAt })
      canonicalPresent = !options.ensureError
      return { data: options.ensureUnavailable ? { error: 'not_available' } : occurrence, error: options.ensureError ?? null }
    },
  }
  const route = load('src/app/api/video-classes/[id]/meeting/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client, createServiceClient: async () => service },
    '@/lib/app-url': { appOrigin: () => 'https://ardore.synthetic' },
    '@/lib/features': { VIDEO_CALLS_ENABLED: options.enabled ?? true },
    '@/lib/video-provider': { ...video, createVideoAccess: async input => { calls.push(input); return video.createVideoAccess(input, fixture.fetch) } },
  })
  return { calls, fixture, privateReads, rpcCalls, async post(input = { occurrenceStart: fixture.input.startsAt }, headers = {}) {
    const response = await route.POST(new Request('https://ardore.synthetic/api/video-classes/' + classId + '/meeting', {
      method: 'POST', headers: { Origin: 'https://ardore.synthetic', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input),
    }), { params: Promise.resolve({ id: classId }) })
    return { response, body: await response.json() }
  } }
}

test('group joining authenticates and matches the exact participant and occurrence before private reads', async () => {
  for (const options of [
    { user: null }, { classMissing: true }, { user: stranger, bookingMissing: true }, { bookingMissing: true },
    { booking: { user_id: stranger } }, { booking: { occurrence_start: null } },
    { booking: { occurrence_start: new Date(Date.now() + 86400_000).toISOString() } },
    { booking: { video_class_id: profileId } }, { booking: { status: 'cancelled' } },
    { booking: { payment_status: 'paid', stripe_livemode: false, price_paid_cents: 5000, payment_order_id: reservationId } },
    { booking: { payment_status: 'refunded' } }, { booking: { refund_status: 'pending' } },
    { booking: { amount_refunded_cents: 100 } }, { booking: { reservation_id: null } },
    { booking: { price_paid_cents: 5000 } }, { enabled: false },
  ]) {
    const local = groupRoute(options)
    const result = await local.post()
    assert.ok(result.response.status >= 400, JSON.stringify(options))
    assert.equal(local.calls.length, 0)
    assert.equal(local.privateReads.length, 0)
    assert.equal(local.rpcCalls.length, 0)
    assert.equal(local.fixture.calls.length, 0)
    assert.equal(result.response.headers.get('Cache-Control'), 'private, no-store')
  }
})

test('a confirmed free group enrollment joins only its canonical dated session', async () => {
  const local = groupRoute()
  const result = await local.post()
  assert.equal(result.response.status, 200)
  assert.equal(result.body.token, token)
  assert.equal(local.calls[0].isOwner, false)
  assert.deepEqual([...new Set(local.privateReads)], ['video_class_occurrences'])
  assert.equal(local.rpcCalls.length, 0)
  for (const options of [{ canonicalMissing: true }, { occurrence: { duration_minutes: 90 } }]) {
    const invalid = groupRoute(options)
    assert.equal((await invalid.post()).response.status, 409)
    assert.equal(invalid.fixture.calls.length, 0)
  }
})

test('a paid group enrollment requires current LIVE order and reservation ownership and fulfillment', async () => {
  const local = groupRoute({ paid: true })
  assert.equal((await local.post()).response.status, 200)
  assert.ok(local.privateReads.includes('payment_orders'))
  assert.ok(local.privateReads.includes('group_booking_reservations'))
  const variants = [
    { orderMissing: true }, { reservationMissing: true }, { order: { buyer_id: stranger } },
    { order: { creator_id: classId } }, { order: { kind: 'products' } }, { order: { state: 'created' } },
    { order: { gross_cents: 4000 } }, { order: { stripe_livemode: false } },
    { order: { reference: { reservationId, videoClassId: classId, occurrenceStart: '2026-01-01T00:00:00Z', durationMinutes: 60 } } },
    { reservation: { buyer_id: stranger } }, { reservation: { status: 'refund_pending' } },
    { reservation: { booking_id: classId } }, { reservation: { payment_order_id: bookingId } },
    { reservation: { price_cents: 1 } }, { reservation: { duration_minutes: 90 } },
    { reservation: { refund_status: 'pending' } }, { reservation: { amount_refunded_cents: 10 } },
  ]
  for (const variant of variants) {
    const invalid = groupRoute({ paid: true, ...variant })
    assert.equal((await invalid.post()).response.status, 409, JSON.stringify(variant))
    assert.equal(invalid.fixture.calls.length, 0)
  }
})

test('only the actual group coach may initialize an occurrence and receive an owner token', async () => {
  const local = groupRoute({ user: actor, canonicalMissing: true })
  const result = await local.post()
  assert.equal(result.response.status, 200)
  assert.equal(local.calls[0].isOwner, true)
  assert.equal(local.rpcCalls.length, 1)
  for (const options of [{ ensureUnavailable: true }, { ensureError: { message: 'private-SQL' } }]) {
    const invalid = groupRoute({ user: actor, canonicalMissing: true, ...options })
    const result = await invalid.post()
    assert.ok(result.response.status >= 400)
    assert.ok(!JSON.stringify(result.body).includes('private-SQL'))
    assert.equal(invalid.fixture.calls.length, 0)
  }
})

test('group host initialization does not freeze future/ended occurrences or a missing provider configuration', async () => {
  for (const offset of [3600_000, -7200_000]) {
    const local = groupRoute({ user: actor, canonicalMissing: true, input: { startsAt: new Date(Date.now() + offset).toISOString() } })
    assert.ok((await local.post()).response.status >= 400)
    assert.equal(local.rpcCalls.length, 0)
    assert.equal(local.fixture.calls.length, 0)
  }
  delete process.env.DAILY_API_KEY
  const local = groupRoute({ user: actor, canonicalMissing: true })
  assert.equal((await local.post()).response.status, 503)
  assert.equal(local.rpcCalls.length, 0)
  process.env.DAILY_API_KEY = 'synthetic-daily-test-credential'
})

test('group access rejects malformed/cross-site identities and notices cancellation before provider calls', async () => {
  for (const [body, headers] of [[{}, {}], [{ occurrenceStart: 'not-a-date' }, {}], [{ occurrenceStart: start(), isOwner: true }, {}], [{ occurrenceStart: start() }, { Origin: 'https://foreign.invalid' }]]) {
    const local = groupRoute()
    assert.ok((await local.post(body, headers)).response.status >= 400)
    assert.equal(local.calls.length, 0)
    assert.equal(local.rpcCalls.length, 0)
  }
  const local = groupRoute({ changed: true })
  assert.equal((await local.post()).response.status, 404)
  assert.equal(local.fixture.calls.length, 0)
})

test('a moved paid group keeps original order/booking identity while joining the effective video room',async()=>{
 const original=new Date(Date.now()-86400000).toISOString(),effective=new Date(Date.now()-5*60000).toISOString()
 let minted=0,scheduleReads=0,changed=false,seen
 const classId='20000000-0000-4000-8000-000000000001',creatorId='10000000-0000-4000-8000-000000000001',rid='30000000-0000-4000-8000-000000000001'
 const course={id:classId,creator_id:creatorId,duration_minutes:60,creator_profiles:{user_id:actor,display_name:'Coach'}}
 const booking={id:bookingId,user_id:buyer,video_class_id:classId,occurrence_start:original,duration_minutes:60,status:'confirmed',price_paid_cents:700,payment_status:'paid',stripe_livemode:true,payment_order_id:rid,reservation_id:rid,refund_status:'not_requested',amount_refunded_cents:0}
 const rows={video_classes:course,video_class_bookings:booking,video_class_occurrences:{video_class_id:classId,starts_at:original,duration_minutes:60},payment_orders:{id:rid,kind:'group',buyer_id:buyer,creator_id:creatorId,state:'fulfilled',gross_cents:700,stripe_livemode:true,reference:{reservationId:rid,videoClassId:classId,occurrenceStart:original,durationMinutes:60}},group_booking_reservations:{id:rid,buyer_id:buyer,creator_id:creatorId,video_class_id:classId,occurrence_start:original,duration_minutes:60,price_cents:700,stripe_livemode:true,status:'confirmed',booking_id:bookingId,payment_order_id:rid,refund_status:'not_requested',amount_refunded_cents:0}}
 const client={auth:{getUser:async()=>({data:{user:{id:buyer}},error:null})},from(table){const q={select:()=>q,eq:(k,v)=>{if(k==='occurrence_start')assert.equal(v,original);return q},maybeSingle:async()=>({data:rows[table],error:null})};return q}}
 const api=load('src/app/api/video-classes/[id]/meeting/route.ts',{
  '@/lib/supabase/server':{createClient:async()=>client,createServiceClient:async()=>client},'@/lib/app-url':{appOrigin:()=> 'https://ardore.synthetic'},'@/lib/features':{VIDEO_CALLS_ENABLED:true},
  '@/lib/group-effective-schedule':{effectiveGroupStart:async()=>{scheduleReads++;return changed&&scheduleReads>1?new Date(Date.parse(effective)+3600000).toISOString():effective}},
  '@/lib/video-provider':{...video,createVideoAccess:async input=>{seen=input;await input.reauthorize();minted++;return {url:'https://synthetic.daily.co/fixture',token:'fixture'}}},
 })
 const post=()=>api.POST(new Request('https://ardore.synthetic/api/video-classes/'+classId+'/meeting',{method:'POST',headers:{Origin:'https://ardore.synthetic','Content-Type':'application/json'},body:JSON.stringify({occurrenceStart:original})}),{params:Promise.resolve({id:classId})})
 assert.equal((await post()).status,200);assert.equal(seen.startsAt,effective);assert.equal(minted,1)
 changed=true;scheduleReads=0;assert.equal((await post()).status,409);assert.equal(minted,1,'A schedule race must not mint another token')
})
