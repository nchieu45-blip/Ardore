import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

// Execute the real public loader with a read-only in-memory query substitute.
// No credentials, network, authentication, booking, or database writes are used.
function fixture(responses, clientError = false) {
  const queries = []
  const client = {
    from(table) {
      const query = { table, selected: null, filters: [], order: null }
      queries.push(query)
      const builder = {
        select(fields) { query.selected = fields; return builder },
        eq(field, value) { query.filters.push(['eq', field, value]); return builder },
        in(field, value) { query.filters.push(['in', field, value]); return builder },
        order(field, options) { query.order = [field, options]; return builder },
        then(resolve, reject) {
          const response = responses[table]
          return (response instanceof Error ? Promise.reject(response) : Promise.resolve(response ?? { data: [], error: null })).then(resolve, reject)
        },
      }
      return builder
    },
  }
  const { loadPublicCoachingMarketplace } = loadUiComponent('src/lib/publicCoachingMarketplace.ts', {
    '@/lib/supabase/server': { createClient: async () => { if (clientError) throw new Error('fixture client unavailable'); return client } },
  })
  return { load: loadPublicCoachingMarketplace, queries }
}

function profile(overrides = {}) {
  return {
    id: 'coach-a', slug: 'coach-a', display_name: 'Anna', avatar_url: '/anna.webp',
    category: 'yoga', categories: ['yoga', 'mental'], is_verified: true, is_published: true,
    ...overrides,
  }
}

function coaching(overrides = {}) {
  return {
    id: 'offer-a', creator_id: 'coach-a', is_enabled: true,
    description: 'Individuelle Begleitung', price_cents: 8500, duration_minutes: 60,
    created_at: '2026-10-01T12:00:00Z', creator_profiles: profile(), ...overrides,
  }
}

function group(overrides = {}) {
  return {
    ...coaching(), id: 'group-a', title: 'Yoga am Morgen', active: true,
    schedule_type: 'once', starts_at: '2099-10-01T12:00:00Z', recurring_weekday: null,
    recurring_time: null, max_participants: 8, included_in_subscription: false,
    ...overrides,
  }
}

function data(rows) { return { data: rows, error: null } }

test('1:1 inventory queries only enabled public offers and narrow public session reviews', async () => {
  const { load, queries } = fixture({
    coaching_offers: data([coaching()]),
    public_session_reviews: data([{ id: 'review-a', creator_id: 'coach-a', rating: 5 }]),
  })
  const result = await load('coaching')
  assert.equal(result.error, false)
  assert.equal(result.ratingsUnavailable, false)
  assert.equal(result.offers.length, 1)
  assert.deepEqual(queries.map((query) => query.table), ['coaching_offers', 'public_session_reviews'])
  assert.deepEqual(queries[0].filters, [['eq', 'is_enabled', true], ['eq', 'creator_profiles.is_published', true]])
  assert.deepEqual(queries[0].order, ['created_at', { ascending: false }])
  assert.match(queries[0].selected, /creator_profiles!inner\(/)
  assert.deepEqual(queries[1].filters, [['in', 'creator_id', ['coach-a']]])
  assert.equal(queries[1].selected, 'id, creator_id, rating')
  for (const query of queries) {
    assert.doesNotMatch(query.selected, /\*|user_id|buyer_id|email|stripe|daily_room|meeting|booking_id/)
  }
  assert.deepEqual(result.offers[0], {
    id: 'offer-a', kind: 'coaching', title: '1:1 Coaching mit Anna',
    description: 'Individuelle Begleitung', priceCents: 8500, durationMinutes: 60,
    createdAt: '2026-10-01T12:00:00Z',
    creator: { id: 'coach-a', slug: 'coach-a', display_name: 'Anna', avatar_url: '/anna.webp', category: 'yoga', categories: ['yoga', 'mental'], is_verified: true },
    rating: { avg: 5, count: 1 }, scheduleType: null, startsAt: null,
    recurringWeekday: null, recurringTime: null, maxParticipants: null, includedInSubscription: false,
  })
})

test('group inventory reads its own active offers and never borrows 1:1 or product ratings', async () => {
  const { load, queries } = fixture({ video_classes: data([group()]) })
  const result = await load('group')
  assert.equal(result.error, false)
  assert.deepEqual(queries.map((query) => query.table), ['video_classes'])
  assert.deepEqual(queries[0].filters, [['eq', 'active', true], ['eq', 'creator_profiles.is_published', true]])
  const offer = result.offers[0]
  assert.equal(offer.kind, 'group')
  assert.equal(offer.title, 'Yoga am Morgen')
  assert.equal(offer.rating, null)
  assert.equal(offer.startsAt, '2099-10-01T12:00:00Z')
  assert.equal(offer.scheduleType, 'once')
  assert.equal(offer.maxParticipants, 8)
  assert.equal(offer.includedInSubscription, false)
})

test('defensive publication and enabled checks exclude owner-visible private or inactive rows', async () => {
  const offers = [
    coaching({ id: 'disabled', is_enabled: false }),
    coaching({ id: 'private', creator_profiles: profile({ is_published: false }) }),
    coaching({ id: 'missing-profile', creator_profiles: null }),
    coaching({ id: 'mismatched-profile', creator_profiles: profile({ id: 'someone-else' }) }),
    coaching({ id: 'valid', creator_profiles: [profile()] }),
  ]
  const { load, queries } = fixture({ coaching_offers: data(offers) })
  assert.deepEqual((await load('coaching')).offers.map((offer) => offer.id), ['valid'])
  assert.deepEqual(queries[1].filters, [['in', 'creator_id', ['coach-a']]])
  const groups = fixture({ video_classes: data([group({ active: false }), group({ creator_profiles: profile({ is_published: false }) })]) })
  assert.deepEqual((await groups.load('group')).offers, [])
})

test('invalid prices, durations, creation dates and profile links never become marketplace offers', async () => {
  const invalid = []
  for (const value of [-1, 0.5, NaN, Infinity, '100', null, Number.MAX_SAFE_INTEGER + 1]) invalid.push(coaching({ id: `price-${invalid.length}`, price_cents: value }))
  for (const value of [0, -1, 0.5, NaN, Infinity, '60', null]) invalid.push(coaching({ id: `duration-${invalid.length}`, duration_minutes: value }))
  for (const value of ['', null, 'invalid']) invalid.push(coaching({ id: `date-${invalid.length}`, created_at: value }))
  invalid.push(coaching({ id: 'bad-slug', creator_profiles: profile({ slug: '../../private' }) }))
  invalid.push(coaching({ id: 'missing-name', creator_profiles: profile({ display_name: '  ' }) }))
  const { load } = fixture({ coaching_offers: data([...invalid, coaching({ id: 'free', price_cents: 0 })]) })
  const result = await load('coaching')
  assert.deepEqual(result.offers.map((offer) => offer.id), ['free'])
  assert.equal(result.offers[0].priceCents, 0)
})

test('only valid unique session reviews from returned creators contribute to 1:1 ratings', async () => {
  const rows = [
    { id: 'one', creator_id: 'coach-a', rating: 5 },
    { id: 'one', creator_id: 'coach-a', rating: 1 },
    { id: 'two', creator_id: 'coach-a', rating: 3 },
    { id: 'foreign', creator_id: 'private-coach', rating: 1 },
    ...[0, -1, 5.1, 2.5, NaN, Infinity, '5', null].map((rating, index) => ({ id: `invalid-${index}`, creator_id: 'coach-a', rating })),
    { id: '', creator_id: 'coach-a', rating: 1 }, null,
  ]
  const { load } = fixture({ coaching_offers: data([coaching()]), public_session_reviews: data(rows) })
  assert.deepEqual((await load('coaching')).offers[0].rating, { avg: 4, count: 2 })
})

test('unrated coaching has null ratings, not invented stars', async () => {
  const { load } = fixture({ coaching_offers: data([coaching()]) })
  const result = await load('coaching')
  assert.equal(result.offers[0].rating, null)
  assert.equal(result.ratingsUnavailable, false)
})

test('optional review read failures preserve offers and identify unavailable ratings', async () => {
  for (const response of [{ data: null, error: { message: 'fixture failure' } }, new Error('fixture connection'), { data: null, error: null }]) {
    const { load } = fixture({ coaching_offers: data([coaching()]), public_session_reviews: response })
    const result = await load('coaching')
    assert.equal(result.error, false)
    assert.equal(result.ratingsUnavailable, true)
    assert.equal(result.offers.length, 1)
    assert.equal(result.offers[0].rating, null)
  }
})

test('primary read and client failures return explicit errors instead of a successful empty collection', async () => {
  for (const kind of ['coaching', 'group']) {
    const table = kind === 'coaching' ? 'coaching_offers' : 'video_classes'
    for (const response of [{ data: [], error: { message: 'fixture read failure' } }, new Error('fixture connection'), { data: null, error: null }]) {
      const { load, queries } = fixture({ [table]: response })
      assert.deepEqual(await load(kind), { offers: [], error: true, ratingsUnavailable: false })
      assert.equal(queries.length, 1)
    }
  }
  assert.deepEqual(await fixture({}, true).load('coaching'), { offers: [], error: true, ratingsUnavailable: false })
})

test('successful empty inventory does not query reviews or fabricate offers', async () => {
  const { load, queries } = fixture({ coaching_offers: data([]) })
  assert.deepEqual(await load('coaching'), { offers: [], error: false, ratingsUnavailable: false })
  assert.equal(queries.length, 1)
})

test('ended or invalid one-time classes are omitted, upcoming and ongoing classes retain actual dates', async () => {
  const now = Date.now()
  const ongoing = new Date(now - 10 * 60_000).toISOString()
  const future = new Date(now + 60_000).toISOString()
  const { load } = fixture({ video_classes: data([
    group({ id: 'ended', starts_at: '2000-01-01T12:00:00Z' }),
    group({ id: 'invalid', starts_at: 'invalid' }),
    group({ id: 'missing', starts_at: null }),
    group({ id: 'ongoing', starts_at: ongoing }),
    group({ id: 'future', starts_at: future }),
  ]) })
  const result = await load('group')
  assert.deepEqual(result.offers.map((offer) => offer.id), ['ongoing', 'future'])
  assert.deepEqual(result.offers.map((offer) => offer.startsAt), [ongoing, future])
})

test('recurring classes retain real weekday/time without generating a next event date', async () => {
  const { load } = fixture({ video_classes: data([
    group({ id: 'weekly', schedule_type: 'recurring', starts_at: '2000-01-01T12:00:00Z', recurring_weekday: 0, recurring_time: '09:30:00', max_participants: null, included_in_subscription: true }),
    group({ id: 'weekly-short', schedule_type: 'recurring', starts_at: null, recurring_weekday: 6, recurring_time: '23:59' }),
  ]) })
  const result = await load('group')
  assert.equal(result.offers.length, 2)
  assert.equal(result.offers[0].scheduleType, 'recurring')
  assert.equal(result.offers[0].startsAt, null)
  assert.equal(result.offers[0].recurringWeekday, 0)
  assert.equal(result.offers[0].recurringTime, '09:30:00')
  assert.equal(result.offers[0].maxParticipants, 199)
  assert.equal(result.offers[0].includedInSubscription, true)
})

test('invalid group schedules, titles and participant counts are not advertised', async () => {
  const invalid = [group({ title: ' ' }), group({ schedule_type: 'unknown' })]
  for (const value of [-1, 7, 1.5, null, '1']) invalid.push(group({ schedule_type: 'recurring', recurring_weekday: value, recurring_time: '18:00' }))
  for (const value of ['24:00', '18:60', '18:00:60', '9:30', '', null]) invalid.push(group({ schedule_type: 'recurring', recurring_weekday: 1, recurring_time: value }))
  for (const value of [0, -1, 1.5, '8']) invalid.push(group({ max_participants: value }))
  const { load } = fixture({ video_classes: data(invalid) })
  assert.deepEqual((await load('group')).offers, [])
})

test('duplicate offer IDs collapse and private source fields never enter the returned model', async () => {
  const row = coaching({ buyer_email: 'fixture@example.invalid', daily_room_url: 'https://private.invalid', stripe_price_id: 'private-fixture', creator_profiles: profile({ user_id: 'private-fixture', stripe_account_id: 'private-fixture' }) })
  const { load } = fixture({ coaching_offers: data([row, row]) })
  const result = await load('coaching')
  assert.equal(result.offers.length, 1)
  assert.doesNotMatch(JSON.stringify(result.offers), /private-fixture|fixture@example|private\.invalid|buyer_email|daily_room_url|stripe/)
  const source = readFileSync(new URL('../src/lib/publicCoachingMarketplace.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /createServiceClient|SERVICE_ROLE|\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
})
