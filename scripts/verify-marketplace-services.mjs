import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const {
  buildServiceRows,
  formatServiceSchedule,
  sortMarketplaceServices,
} = loadUiComponent('src/lib/marketplaceServices.ts')
const { CoachingOfferCard } = loadUiComponent('src/components/ui/CoachingOfferCard.tsx')
const now = Date.parse('2026-10-17T12:00:00Z')

function offer(id, overrides = {}) {
  return {
    id,
    kind: 'coaching',
    title: `Angebot ${id}`,
    description: 'Persönliche Begleitung für deinen Alltag.',
    priceCents: 6900,
    durationMinutes: 60,
    createdAt: '2026-10-01T12:00:00Z',
    creator: {
      id: 'fixture-creator',
      slug: 'fixture-coach',
      display_name: 'Fixture Coach',
      avatar_url: null,
      categories: ['yoga'],
      category: 'yoga',
      is_verified: false,
    },
    rating: null,
    scheduleType: null,
    startsAt: null,
    recurringWeekday: null,
    recurringTime: null,
    maxParticipants: null,
    includedInSubscription: false,
    ...overrides,
  }
}

function ids(items) {
  return items.map((item) => item.id)
}

test('service sections contain their own offers and no empty or duplicate recommendations', () => {
  const coaching = offer('one')
  const group = offer('group', { kind: 'group' })
  assert.deepEqual(buildServiceRows([], 'coaching', now), [])
  assert.deepEqual(buildServiceRows([coaching], 'group', now), [])
  const rows = buildServiceRows([coaching, group], 'coaching', now)
  assert.equal(rows.length, 1)
  assert.deepEqual(ids(rows[0].offers), ['one'])
  assert.equal(rows[0].href, '/marketplace?area=coaching&sort=newest')
  const oneReviewed = offer('one', { rating: { avg: 5, count: 2 } })
  assert.equal(buildServiceRows([oneReviewed], 'coaching', now).length, 1)
})

test('best-rated 1:1 coaching uses actual session scores and never group or invalid ratings', () => {
  const invalid = [
    null, { avg: 0, count: 1 }, { avg: 5.1, count: 2 },
    { avg: NaN, count: 1 }, { avg: 5, count: 0 },
    { avg: 5, count: 1.5 }, { avg: 4, count: Infinity },
  ].map((rating, i) => offer(`invalid-${i}`, { rating }))
  const inventory = [
    offer('one-review', { rating: { avg: 4.9, count: 1 } }),
    offer('established', { rating: { avg: 4.8, count: 20 } }),
    offer('group-fake-rating', { kind: 'group', rating: { avg: 5, count: 9999 } }),
    ...invalid,
  ]
  const rows = buildServiceRows(inventory, 'coaching', now)
  assert.equal(rows.length, 2)
  assert.equal(rows[1].title, 'Best bewertet')
  assert.match(rows[1].description, /abgeschlossenen Sessions/)
  assert.deepEqual(ids(rows[1].offers), ['established', 'one-review'])
  assert.equal(rows[1].href, '/marketplace?area=coaching&sort=top_rated')
  assert.deepEqual(ids(sortMarketplaceServices(inventory, 'top_rated', now)).slice(0, 2), ['established', 'one-review'])
})

test('newest and price sorts keep complete immutable results with stable ties and honest zero prices', () => {
  const inventory = Object.freeze([
    Object.freeze(offer('invalid', { createdAt: 'not-a-date', priceCents: NaN })),
    Object.freeze(offer('older', { createdAt: '1960-01-01T00:00:00Z', priceCents: 100 })),
    Object.freeze(offer('b', { priceCents: 0 })),
    Object.freeze(offer('a', { priceCents: 0 })),
  ])
  const before = structuredClone(inventory)
  assert.deepEqual(ids(sortMarketplaceServices(inventory, 'newest')), ['a', 'b', 'older', 'invalid'])
  assert.deepEqual(ids(sortMarketplaceServices(inventory, 'price_asc')), ['a', 'b', 'older', 'invalid'])
  assert.deepEqual(ids(sortMarketplaceServices(inventory, 'price_desc')), ['older', 'a', 'b', 'invalid'])
  assert.deepEqual(inventory, before)
})

test('only service previews cap at twelve and at most two shelves are created', () => {
  const inventory = Array.from({ length: 25 }, (_, i) => offer(String(i).padStart(2, '0'), {
    createdAt: `2026-10-${String((i % 15) + 1).padStart(2, '0')}T00:00:00Z`,
    rating: i < 15 ? { avg: 4 + i / 20, count: 10 } : null,
  }))
  const rows = buildServiceRows(inventory, 'coaching', now)
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.offers.length === 12))
  const complete = sortMarketplaceServices(inventory, 'top_rated', now)
  assert.equal(complete.length, 25)
  assert.equal(new Set(ids(complete)).size, 25)
})

test('upcoming groups are real future one-time dates, without inventing recurring occurrences', () => {
  const inventory = [
    offer('later', { kind: 'group', scheduleType: 'once', startsAt: '2026-11-01T12:00:00Z' }),
    offer('recurring', { kind: 'group', scheduleType: 'recurring', recurringWeekday: 1, recurringTime: '10:00' }),
    offer('past', { kind: 'group', scheduleType: 'once', startsAt: '2026-10-16T12:00:00Z' }),
    offer('soon', { kind: 'group', scheduleType: 'once', startsAt: '2026-10-18T12:00:00Z' }),
    offer('bad', { kind: 'group', scheduleType: 'once', startsAt: 'invalid' }),
  ]
  const rows = buildServiceRows(inventory, 'group', now)
  assert.equal(rows.length, 2)
  assert.deepEqual(ids(rows[1].offers), ['soon', 'later'])
  assert.equal(rows[1].href, '/marketplace?area=groups&sort=upcoming')
  const complete = sortMarketplaceServices(inventory, 'upcoming', now)
  assert.deepEqual(ids(complete).slice(0, 2), ['soon', 'later'])
  assert.equal(complete.length, inventory.length)
})

test('group schedules use Berlin daylight saving time and valid recurring patterns only', () => {
  assert.match(formatServiceSchedule(offer('summer', { kind: 'group', scheduleType: 'once', startsAt: '2026-07-20T12:30:00Z' })), /14:30 Uhr \(Berlin\)/)
  assert.match(formatServiceSchedule(offer('winter', { kind: 'group', scheduleType: 'once', startsAt: '2026-12-20T12:30:00Z' })), /13:30 Uhr \(Berlin\)/)
  assert.equal(formatServiceSchedule(offer('recurring', { kind: 'group', scheduleType: 'recurring', recurringWeekday: 0, recurringTime: '09:30:00' })), 'Jeden Sonntag, 09:30 Uhr (Berlin)')
  for (const overrides of [
    { recurringWeekday: 7, recurringTime: '09:00' },
    { recurringWeekday: 1, recurringTime: '25:00' },
    { recurringWeekday: 1, recurringTime: '09:61' },
    { recurringWeekday: null, recurringTime: '09:00' },
  ]) assert.equal(formatServiceSchedule(offer('bad', { kind: 'group', scheduleType: 'recurring', ...overrides })), null)
  assert.equal(formatServiceSchedule(offer('coaching')), null)
})

test('1:1 cards label genuine session ratings, exact duration and base price with profile-only actions', () => {
  const html = render(React.createElement(CoachingOfferCard, { offer: offer('one', { rating: { avg: 4.7, count: 2 } }) }))
  assert.ok(html.includes('1:1 Coaching'))
  assert.ok(html.includes('60 Min.'))
  assert.ok(html.includes('69,00'))
  assert.ok(html.includes('Je 1:1 Session'))
  assert.ok(html.includes('4,7 / 5 · 2 Sessionbewertungen'))
  assert.ok(html.includes('Angebot ansehen'))
  assert.ok(!/Produktbewertung|Verifiziert|Jetzt buchen|Gratis für Abonnenten/.test(html))
  for (const anchor of html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs)) assert.ok(!/<button|<a\b/.test(anchor[1]))
  for (const href of html.matchAll(/href="([^"]+)"/g)) assert.equal(href[1], '/creators/fixture-coach')
})

test('group cards lead to per-session booking and expose maximum capacity and conditional subscription information honestly', () => {
  const html = render(React.createElement(CoachingOfferCard, { offer: offer('group', {
    kind: 'group',
    includedInSubscription: true,
    maxParticipants: 8,
    rating: { avg: 5, count: 10 },
    creator: { ...offer('one').creator, is_verified: true },
  }) }))
  assert.ok(html.includes('Gruppencoaching'))
  assert.ok(html.includes('Max. 8 Personen'))
  assert.ok(html.includes('69,00'))
  assert.ok(html.includes('Jeder Termin wird separat gebucht.'))
  assert.ok(html.includes('href="/creators/fixture-coach#group-group"'))
  assert.ok(html.includes('Abo-Konditionen im Coach-Profil.'))
  assert.ok(html.includes('Verifiziert'))
  assert.ok(!/Kostenlos|Gratis|Sessionbewertung|Produktbewertung|Plätze frei|Jetzt buchen/.test(html))
  const free = render(React.createElement(CoachingOfferCard, { offer: offer('free', { kind: 'group', priceCents: 0 }) }))
  assert.ok(free.includes('Kostenlos'))
  assert.ok(!free.includes('Bezahlte Gruppenbuchung'))
  assert.ok(!free.includes('Max.'))
})
