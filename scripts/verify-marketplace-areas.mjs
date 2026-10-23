import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

// Real presentation components with local inventory, router and server mocks.
// This suite never accesses a service, changes bookings or writes public data.
const h = React.createElement

function offer(id, overrides = {}) {
  return {
    id,
    kind: 'coaching',
    title: `Session ${id}`,
    description: 'Persönliche Atemübungen für deinen Alltag',
    priceCents: 4500,
    durationMinutes: 45,
    createdAt: '2026-10-01T12:00:00Z',
    creator: {
      id: `creator-${id}`,
      slug: `creator-${id}`,
      display_name: `Coach ${id}`,
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

function product(id, overrides = {}) {
  return {
    id,
    title: `Product ${id}`,
    description: 'Digitaler Trainingsplan',
    type: 'pdf',
    price: 20,
    thumbnail_url: null,
    createdAt: '2026-10-01T12:00:00Z',
    categories: ['yoga'],
    equipment: [],
    level: null,
    duration: null,
    creatorHasCoaching: true,
    creatorHasVideoClasses: true,
    creator: offer(id).creator,
    ...overrides,
  }
}

function page(query = '', props = {}) {
  const pushes = []
  const replaces = []
  const refreshes = []
  const elements = []
  const capture = create => (type, attributes, key) => {
    if (typeof type === 'string') elements.push({ type, props: attributes })
    return create(type, attributes, key)
  }
  const Page = loadUiComponent('src/app/marketplace/MarketplacePageClient.tsx', {
    'next/navigation': {
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({
        push: (...args) => pushes.push(args),
        replace: (...args) => replaces.push(args),
        refresh: (...args) => refreshes.push(args),
      }),
    },
    'react/jsx-runtime': {
      ...jsxRuntime,
      jsx: capture(jsxRuntime.jsx),
      jsxs: capture(jsxRuntime.jsxs),
    },
    '@/components/HeartButton': {
      __esModule: true,
      default: () => h('button', { 'aria-label': 'Favorit' }, 'Merken'),
    },
  }).default
  return {
    html: renderToStaticMarkup(h(Page, props)),
    elements,
    pushes,
    replaces,
    refreshes,
  }
}

function nav(html, label) {
  const found = html.match(new RegExp(`<nav\\b[^>]*aria-label="${label}"[^>]*>[\\s\\S]*?</nav>`))
  assert.ok(found, `Expected navigation: ${label}`)
  return found[0]
}

function links(html) {
  return [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(match => ({ href: match[1].replaceAll('&amp;', '&'), content: match[2] }))
}

function rails(html) {
  return [...html.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)]
    .map(match => ({ id: match[1], html: match[2] }))
}

function offerIds(html) {
  return [...html.matchAll(/<h3\b[^>]*>\s*<a\b[^>]*>Session ([^<]+)<\/a>/g)]
    .map(match => match[1])
}

function text(children) {
  if (Array.isArray(children)) return children.map(text).join('')
  if (React.isValidElement(children)) return text(children.props.children)
  return children === null || children === undefined || typeof children === 'boolean' ? '' : String(children)
}

function clickButton(result, label) {
  const button = result.elements.find(({ type, props }) => type === 'button' && (props['aria-label'] === label || text(props.children) === label))
  assert.ok(button, `Expected button: ${label}`)
  button.props.onClick()
}

test('all three marketplace areas keep search intention while removing incompatible filters', () => {
  const query = 'q=++Atem+++Alltag++&category=yoga&type=course&equipment=yoga_matte&level=anfaenger&duration=30_60&max_price=0&sort=price_asc&page=2&coaching=true&group=true'
  for (const area of ['products', 'coaching', 'groups']) {
    const { html } = page(`${query}&area=${area}`)
    const areaNav = nav(html, 'Angebotsbereiche im Marktplatz')
    const destinations = links(areaNav)
    assert.equal(destinations.length, 3)
    assert.equal((areaNav.match(/aria-current="page"/g) ?? []).length, 1)
    for (const { href } of destinations) {
      const url = new URL(href, 'http://localhost')
      assert.equal(url.pathname, '/marketplace')
      assert.equal(url.searchParams.get('q'), 'Atem Alltag')
      assert.equal(url.searchParams.get('category'), 'yoga')
      assert.deepEqual([...url.searchParams.keys()].sort(), url.searchParams.has('area') ? ['area', 'category', 'q'] : ['category', 'q'])
    }
    assert.ok(destinations.some(({ href }) => href.includes('area=coaching')))
    assert.ok(destinations.some(({ href }) => href.includes('area=groups')))
    assert.ok(destinations.some(({ href }) => !href.includes('area=')))
  }
})

test('server loads only the selected service area and passes its errors through to the client', async () => {
  for (const [area, expectedKind] of [['coaching', 'coaching'], ['groups', 'group'], [['coaching', 'groups'], 'coaching']]) {
    const calls = []
    const received = []
    const inventory = { offers: [offer(area, { kind: expectedKind })], error: true, ratingsUnavailable: true }
    const ServerPage = loadUiComponent('src/app/marketplace/page.tsx', {
      '@/lib/supabase/server': { createClient() { throw new Error('Service navigation must not load the product inventory') } },
      '@/lib/publicCoachingMarketplace': {
        loadPublicCoachingMarketplace: async kind => { calls.push(kind); return inventory },
      },
      './MarketplacePageClient': {
        __esModule: true,
        default: props => { received.push(props); return h('div', null, 'Selected inventory') },
      },
    }).default
    renderToStaticMarkup(await ServerPage({ searchParams: Promise.resolve({ area }) }))
    assert.deepEqual(calls, [expectedKind])
    assert.equal(received.length, 1)
    assert.deepEqual(received[0].serviceOffers, inventory.offers)
    assert.equal(received[0].serviceError, true)
    assert.equal(received[0].ratingsUnavailable, true)
    assert.equal(received[0].products, undefined)
  }
})

test('default and malformed areas retain the existing product inventory without loading services', async () => {
  for (const area of [undefined, 'unknown', ['unknown', 'coaching']]) {
    const tables = []
    const received = []
    const query = {
      select() { return this },
      eq() { return this },
      order: async () => ({ data: [], error: null }),
    }
    const ServerPage = loadUiComponent('src/app/marketplace/page.tsx', {
      '@/lib/supabase/server': {
        createClient: async () => ({ from: table => { tables.push(table); return query } }),
      },
      '@/lib/publicCoachingMarketplace': {
        loadPublicCoachingMarketplace() { throw new Error('Product navigation must not load service inventory') },
      },
      './MarketplacePageClient': {
        __esModule: true,
        default: props => { received.push(props); return h('div', null, 'Product inventory') },
      },
    }).default
    renderToStaticMarkup(await ServerPage({ searchParams: Promise.resolve({ area }) }))
    assert.deepEqual(tables, ['products'])
    assert.equal(received.length, 1)
    assert.deepEqual(received[0].products, [])
    assert.equal(received[0].serviceOffers, undefined)
  }
})

test('each area has at most two horizontal discovery rows without generating extra topic rows', () => {
  const inventory = [
    offer('unrated', { createdAt: '2026-10-16T12:00:00Z' }),
    offer('reviewed', { rating: { avg: 4.8, count: 4 } }),
    offer('group-later', { kind: 'group', scheduleType: 'once', startsAt: '2099-12-10T12:00:00Z', createdAt: '2026-10-10T12:00:00Z', rating: { avg: 5, count: 999 } }),
    offer('group-sooner', { kind: 'group', scheduleType: 'once', startsAt: '2099-12-01T12:00:00Z', createdAt: '2026-10-01T12:00:00Z', rating: { avg: 5, count: 999 } }),
  ]
  const products = [product('course', { type: 'course' }), product('free', { price: 0 }), product('other', { categories: ['mental'] })]
  for (const area of ['products', 'coaching', 'groups']) {
    const result = page(`area=${area}`, { products, ratings: { free: { avg: 4.8, count: 5 } }, serviceOffers: inventory })
    const shelves = rails(result.html)
    assert.equal(shelves.length, 2, `${area} must stay concise`)
    assert.equal((result.html.match(/class="discovery-rail-track"/g) ?? []).length, 2)
    assert.ok(!result.html.includes('marketplace-category-'))
    if (area === 'products') {
      assert.match(result.html, /Neu im Marktplatz/)
      assert.match(result.html, /Best bewertet/)
      assert.deepEqual(offerIds(result.html), [])
    } else {
      for (const shelf of shelves) {
        assert.match(shelf.html, /role="list" tabindex="0"/)
        assert.match(shelf.html, /Seitlich wischen/)
      }
      const ids = offerIds(result.html)
      assert.ok(ids.length > 0)
      assert.ok(ids.every(id => area === 'groups' ? id.startsWith('group-') : !id.startsWith('group-')))
      assert.ok(!result.html.includes('/products/'))
    }
  }
})

test('group discovery uses upcoming appointments and never inherits session or product reviews', () => {
  const result = page('area=groups', {
    products: [product('reviewed-product')],
    ratings: { 'reviewed-product': { avg: 5, count: 200 } },
    serviceOffers: [
      offer('group-later', { kind: 'group', scheduleType: 'once', startsAt: '2099-12-10T12:00:00Z', createdAt: '2026-10-10T12:00:00Z', rating: { avg: 5, count: 999 } }),
      offer('group-sooner', { kind: 'group', scheduleType: 'once', startsAt: '2099-12-01T12:00:00Z', createdAt: '2026-10-01T12:00:00Z', rating: { avg: 4, count: 123 } }),
    ],
  })
  const upcoming = rails(result.html).find(row => row.id === 'marketplace-groups-upcoming-title')
  assert.ok(upcoming)
  assert.deepEqual(offerIds(upcoming.html), ['group-sooner', 'group-later'])
  assert.ok(links(upcoming.html).some(link => link.href === '/marketplace?area=groups&sort=upcoming'))
  assert.ok(!/Sessionbewertung|Produktbewertung|Best bewertet|\/ 5/.test(result.html))
  assert.match(result.html, /Jeder Termin wird separat gebucht/)
  assert.doesNotMatch(result.html, /Video-Teilnahme an Gruppenangeboten ist derzeit noch nicht verfügbar/)
})

test('newest preview links retain every service through the complete 20-card result pages', () => {
  for (const [area, kind] of [['coaching', 'coaching'], ['groups', 'group']]) {
    const inventory = Array.from({ length: 45 }, (_, index) => offer(`${area}-${String(index).padStart(2, '0')}`, {
      kind,
      createdAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
    }))
    const overview = page(`area=${area}`, { serviceOffers: inventory })
    const newest = rails(overview.html)[0]
    assert.equal(offerIds(newest.html).length, 12)
    assert.ok(links(newest.html).some(link => link.href === `/marketplace?area=${area}&sort=newest`))
    const seen = []
    for (const [pageNumber, count, range] of [[1, 20, '1–20'], [2, 20, '21–40'], [3, 5, '41–45']]) {
      const result = page(`area=${area}&sort=newest&page=${pageNumber}`, { serviceOffers: inventory })
      const shelves = rails(result.html)
      assert.equal(shelves.length, 1)
      assert.equal(shelves[0].id, `marketplace-${area}-results-title`)
      assert.equal(offerIds(shelves[0].html).length, count)
      assert.ok(shelves[0].html.includes(`Ergebnisse ${range} von 45`))
      assert.ok(!links(shelves[0].html).some(link => link.content.includes('Alle ansehen')))
      assert.ok(result.html.includes('Ergebnisseiten'))
      seen.push(...offerIds(shelves[0].html))
    }
    assert.equal(new Set(seen).size, inventory.length)
    assert.deepEqual(seen, [...inventory].reverse().map(item => item.id))
    assert.deepEqual(offerIds(page(`area=${area}&sort=newest&page=9999`, { serviceOffers: inventory }).html), seen.slice(40))
    for (const invalidPage of ['0', '-1', '1.5', 'no-page', '999999999999999999999']) {
      assert.deepEqual(offerIds(page(`area=${area}&sort=newest&page=${invalidPage}`, { serviceOffers: inventory }).html), seen.slice(0, 20))
    }
  }
})

test('service search, topic and zero-price filters apply within the selected area before pagination', () => {
  for (const [area, kind] of [['coaching', 'coaching'], ['groups', 'group']]) {
    const matching = Array.from({ length: 23 }, (_, index) => offer(`${area}-match-${index}`, { kind, priceCents: 0 }))
    const excluded = [
      offer('paid', { kind, priceCents: 1 }),
      offer('wrong-category', { kind, priceCents: 0, creator: { ...offer('wrong-category').creator, categories: ['mental'], category: 'mental' } }),
      offer('wrong-search', { kind, priceCents: 0, description: 'Anderes Thema' }),
      offer('wrong-area', { kind: kind === 'coaching' ? 'group' : 'coaching', priceCents: 0 }),
    ]
    const inventory = [...matching, ...excluded]
    const query = `area=${area}&q=++Atemübungen+++für++&category=yoga&max_price=0&sort=newest`
    const first = page(query, { serviceOffers: inventory })
    const second = page(`${query}&page=2`, { serviceOffers: inventory })
    assert.match(first.html, /<strong[^>]*>23<\/strong> Angebote/)
    assert.match(first.html, /Deine Suchergebnisse/)
    assert.equal(offerIds(first.html).length, 20)
    assert.equal(offerIds(second.html).length, 3)
    assert.deepEqual(new Set([...offerIds(first.html), ...offerIds(second.html)]), new Set(matching.map(item => item.id)))
    assert.match(first.html, /value="0" selected=""/)
    assert.equal(rails(first.html).length, 1)
    assert.equal(rails(second.html).length, 1)
  }
  const translated = page('area=coaching&q=Ernährung', {
    serviceOffers: [offer('nutrition', { creator: { ...offer('nutrition').creator, categories: [], category: 'ernaehrung' } })],
  })
  assert.deepEqual(offerIds(translated.html), ['nutrition'])
})

test('service filter callbacks preserve normalized search, selected area, explicit sorting and free prices', () => {
  const result = page('area=coaching&q=++Atemübungen+++für++&category=yoga&max_price=0&sort=newest&page=2&type=course&equipment=yoga_matte', {
    serviceOffers: [offer('one', { priceCents: 0 })],
  })
  const select = label => {
    const found = result.elements.find(({ type, props }) => type === 'select' && props['aria-label'] === `1:1 Coaching: ${label}`)
    assert.ok(found, `Expected service ${label} control`)
    return found.props
  }
  select('Thema').onChange({ target: { value: 'mental' } })
  select('Preis').onChange({ target: { value: '' } })
  select('Sortierung').onChange({ target: { value: 'price_asc' } })
  for (const [index, [href, options]] of result.pushes.entries()) {
    const params = new URL(href, 'http://localhost').searchParams
    assert.equal(params.get('area'), 'coaching')
    assert.equal(params.get('q'), 'Atemübungen für')
    assert.equal(params.get('category'), index === 0 ? 'mental' : 'yoga')
    assert.equal(params.get('sort'), index === 2 ? 'price_asc' : 'newest')
    assert.equal(params.get('max_price'), index === 1 ? null : '0')
    assert.equal(params.get('page'), null)
    assert.equal(params.get('type'), null)
    assert.equal(params.get('equipment'), null)
    assert.deepEqual(options, { scroll: false })
  }
  clickButton(result, 'Filter zurücksetzen')
  assert.deepEqual(result.pushes.at(-1), ['/marketplace?area=coaching', { scroll: false }])

  const overview = page('area=groups', { serviceOffers: [offer('group', { kind: 'group' })] })
  const sorter = overview.elements.find(({ type, props }) => type === 'select' && props['aria-label'] === 'Gruppencoaching: Sortierung').props
  assert.equal(sorter.value, '')
  sorter.onChange({ target: { value: 'newest' } })
  assert.deepEqual(overview.pushes, [['/marketplace?area=groups&sort=newest', { scroll: false }]])
  const sorted = page('area=groups&sort=newest', { serviceOffers: [offer('group', { kind: 'group' })] })
  sorted.elements.find(({ type, props }) => type === 'select' && props['aria-label'] === 'Gruppencoaching: Sortierung').props.onChange({ target: { value: '' } })
  assert.deepEqual(sorted.pushes, [['/marketplace?area=groups', { scroll: false }]])
})

test('explicit service sorts keep the complete result rail and use session ratings only', () => {
  const inventory = [
    offer('expensive', { priceCents: 7000 }),
    offer('free', { priceCents: 0, rating: { avg: 5, count: 1 } }),
    offer('middle', { priceCents: 2000, rating: { avg: 4.5, count: 100 } }),
  ]
  const props = { serviceOffers: inventory, ratings: { expensive: { avg: 5, count: 1000 } } }
  for (const [sort, expected] of [
    ['price_asc', ['free', 'middle', 'expensive']],
    ['price_desc', ['expensive', 'middle', 'free']],
    ['top_rated', ['middle', 'free', 'expensive']],
  ]) {
    const result = page(`area=coaching&sort=${sort}`, props)
    assert.deepEqual(offerIds(result.html), expected)
    assert.equal(rails(result.html).length, 1)
    assert.equal(rails(result.html)[0].id, 'marketplace-coaching-results-title')
  }

  // Existing unknown sort links remain a complete view and survive filter edits;
  // they must not silently turn back into a capped discovery preview.
  const legacy = page('area=coaching&sort=popular&max_price=100', props)
  assert.equal(rails(legacy.html)[0].id, 'marketplace-coaching-results-title')
  legacy.elements.find(({ type, props }) => type === 'select' && props['aria-label'] === '1:1 Coaching: Preis').props.onChange({ target: { value: '0' } })
  assert.equal(new URL(legacy.pushes[0][0], 'http://localhost').searchParams.get('sort'), 'popular')
})

test('service errors, missing ratings and empty filtered inventories have honest recovery actions', () => {
  const error = page('area=coaching', { serviceOffers: [offer('not-visible')], serviceError: true })
  assert.match(error.html, /1:1 Coaching konnte nicht geladen werden/)
  assert.deepEqual(offerIds(error.html), [])
  assert.equal(rails(error.html).length, 0)
  clickButton(error, 'Erneut versuchen')
  assert.deepEqual(error.refreshes, [[]])

  const missingRatings = page('area=coaching', { serviceOffers: [offer('unrated')], ratingsUnavailable: true })
  assert.match(missingRatings.html, /Session-Bewertungen konnten gerade nicht geladen werden/)
  assert.deepEqual(offerIds(missingRatings.html), ['unrated'])
  assert.equal(rails(missingRatings.html).length, 1)
  assert.ok(rails(missingRatings.html).every(row => !row.id.includes('best-rated')))

  for (const [area, kind] of [['coaching', 'coaching'], ['groups', 'group']]) {
    const empty = page(`area=${area}&q=missing&max_price=0`, { serviceOffers: [offer('other', { kind })] })
    assert.match(empty.html, /Keine passenden Angebote/)
    assert.deepEqual(offerIds(empty.html), [])
    assert.equal(rails(empty.html).length, 0)
    assert.ok(!empty.html.includes('Ergebnisseiten'))
    assert.ok(links(empty.html).some(link => link.href === '/coaches'))
    clickButton(empty, 'Filter zurücksetzen')
    assert.deepEqual(empty.pushes, [[`/marketplace?area=${area}`, { scroll: false }]])
    assert.match(page(`area=${area}`).html, /Noch keine Angebote/)
  }
})
