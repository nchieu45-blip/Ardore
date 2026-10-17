import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

// All inventory, navigation and favorites in this file are isolated local mocks.
// Render the actual page/rail/card components; no network or service writes occur.
const h = React.createElement

function product(id, overrides = {}) {
  return {
    id,
    title: `Product ${id}`,
    description: 'A published digital offer',
    type: 'pdf',
    price: 20,
    thumbnail_url: null,
    createdAt: '2026-10-01T12:00:00Z',
    categories: [],
    equipment: [],
    level: null,
    duration: null,
    creatorHasCoaching: false,
    creatorHasVideoClasses: false,
    creator: {
      id: `coach-${id}`,
      display_name: `Coach ${id}`,
      avatar_url: null,
      slug: `coach-${id}`,
      category: null,
      categories: [],
    },
    ...overrides,
  }
}

function page(query = '', products = [], ratings = {}) {
  const pushes = []
  const selects = []
  const capture = (create) => (type, props, key) => {
    if (type === 'select') selects.push(props)
    return create(type, props, key)
  }
  const Page = loadUiComponent('src/app/marketplace/MarketplacePageClient.tsx', {
    'next/navigation': {
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({ push: (...args) => pushes.push(args), replace() {} }),
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
    html: renderToStaticMarkup(h(Page, { products, ratings, salesCounts: {} })),
    pushes,
    selects,
  }
}

function section(html, id) {
  const result = html.match(new RegExp(`<section\\b[^>]*aria-labelledby="${id}-title"[^>]*>([\\s\\S]*?)</section>`))
  assert.ok(result, `Expected the ${id} shelf`)
  return result[1]
}

function ids(html) {
  return [...html.matchAll(/href="\/products\/([^"?]+)"/g)].map(match => match[1])
}

function links(html) {
  return [...html.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(match => ({ href: match[1].replaceAll('&amp;', '&'), content: match[2] }))
}

function topics(html) {
  return html.match(/<nav aria-label="Nach Thema entdecken"[\s\S]*?<\/nav>/)?.[0] ?? ''
}

test('marketplace overview keeps only newest and review shelves while formats and topics remain filterable', () => {
  const inventory = [
    product('yoga-a', { categories: ['yoga'], type: 'course' }),
    product('yoga-b', { categories: ['yoga'], price: 0 }),
    product('nutrition', { categories: ['ernaehrung'] }),
  ]
  const { html } = page('', inventory)
  assert.deepEqual(ids(section(html, 'marketplace-newest')).sort(), inventory.map(item => item.id).sort())
  assert.equal((html.match(/class="discovery-rail"/g) ?? []).length, 2)
  assert.ok(!html.includes('marketplace-courses-title'))
  assert.ok(!html.includes('marketplace-free-title'))
  assert.ok(!html.includes('marketplace-category-yoga-title'))
  assert.match(html, /Online-Kurse/)
  assert.ok(topics(html).includes('/marketplace?category=yoga'))
  const best = section(html, 'marketplace-best-rated')
  assert.match(best, /sobald Bewertungen vorliegen/)
  assert.deepEqual(ids(best), [])
  assert.ok(!best.includes('discovery-rail-track'))
  assert.ok(!html.includes('marketplace-results-title'))
  assert.ok(!html.includes('Seitennavigation der Marktplatz-Ergebnisse'))
  assert.ok(!/Bestseller|Beliebteste|Meistverkauft/.test(html))
  const newest = section(html, 'marketplace-newest')
  assert.match(newest, /role="list" tabindex="0"/)
  assert.match(newest, /aria-describedby="marketplace-newest-hint"/)
  assert.match(newest, /aria-controls="marketplace-newest-items"/)
})

test('best-rated shelf includes reviewed products and leaves unrated offers in newest', () => {
  const inventory = [product('unrated'), product('reviewed'), product('more-reviewed')]
  const { html } = page('', inventory, {
    reviewed: { avg: 4.5, count: 2 },
    'more-reviewed': { avg: 4.8, count: 5 },
  })
  assert.deepEqual(ids(section(html, 'marketplace-best-rated')), ['more-reviewed', 'reviewed'])
  assert.ok(ids(section(html, 'marketplace-newest')).includes('unrated'))
  assert.ok(!section(html, 'marketplace-best-rated').includes('sobald Bewertungen vorliegen'))
})

test('overview links open the complete 20-per-page result rail and every item remains reachable', () => {
  const inventory = Array.from({ length: 45 }, (_, index) => product(`p-${String(index + 1).padStart(2, '0')}`, {
    createdAt: new Date(Date.UTC(2026, 8, index + 1)).toISOString(),
  }))
  const overview = page('', inventory)
  const newest = section(overview.html, 'marketplace-newest')
  assert.equal(ids(newest).length, 12)
  const completeHref = links(newest).find(link => link.content.includes('Alle ansehen'))?.href
  assert.equal(completeHref, '/marketplace?sort=newest')

  const seen = []
  for (const [query, expectedLength, expectedRange] of [
    ['sort=newest', 20, 'Ergebnisse 1–20 von 45'],
    ['sort=newest&page=2', 20, 'Ergebnisse 21–40 von 45'],
    ['sort=newest&page=3', 5, 'Ergebnisse 41–45 von 45'],
  ]) {
    const { html } = page(query, inventory)
    const results = section(html, 'marketplace-results')
    assert.equal(ids(results).length, expectedLength)
    assert.ok(results.includes(expectedRange))
    assert.match(results, /aria-labelledby="marketplace-results-title"/)
    assert.ok(!links(results).some(link => link.content.includes('Alle ansehen')))
    assert.ok(html.includes('Seitennavigation der Marktplatz-Ergebnisse'))
    assert.ok(!html.includes('marketplace-newest-title'))
    seen.push(...ids(results))
  }
  assert.equal(new Set(seen).size, 45)
  assert.deepEqual(seen, [...inventory].reverse().map(item => item.id))

  // Older direct page links must also retain their complete result set.
  assert.deepEqual(ids(section(page('page=2', inventory).html, 'marketplace-results')), seen.slice(20, 40))
})

test('combined search and product filters apply to the complete rail before pagination', () => {
  const matches = Array.from({ length: 23 }, (_, index) => product(`matching-${index}`, {
    title: 'Daily practice',
    description: 'Simple breathing reset',
    type: 'course',
    price: 0,
    categories: ['yoga'],
    equipment: ['yoga_matte'],
    level: 'anfaenger',
    duration: '30_60',
    creatorHasCoaching: true,
    creatorHasVideoClasses: true,
  }))
  const excluded = [
    { price: 1 }, { categories: ['mental'] }, { type: 'pdf' },
    { equipment: ['mit_hanteln'] }, { level: 'experte' }, { duration: 'unter_30' },
    { creatorHasCoaching: false }, { creatorHasVideoClasses: false },
    { description: 'Unrelated content' },
  ].map((overrides, index) => ({ ...matches[0], id: `excluded-${index}`, ...overrides }))
  const query = 'q=++breathing+++reset++&category=yoga&type=course&max_price=0&equipment=yoga_matte&level=anfaenger&duration=30_60&coaching=true&group=true&sort=newest'
  const inventory = [...matches, ...excluded]
  const first = page(query, inventory).html
  const second = page(`${query}&page=2`, inventory).html
  assert.match(first, /23<\/span> Produkte gefunden/)
  assert.equal(ids(section(first, 'marketplace-results')).length, 20)
  assert.equal(ids(section(second, 'marketplace-results')).length, 3)
  assert.deepEqual(new Set([...ids(first), ...ids(second)]), new Set(matches.map(item => item.id)))
  assert.match(first, /Deine Suchergebnisse/)
  assert.match(first, /Preis bis 0/)
  assert.ok(!first.includes('marketplace-newest-title'))
})

test('topic links preserve search, zero price, explicit newest and other filters while resetting page', () => {
  const inventory = [
    product('yoga', { categories: ['yoga'] }),
    product('mental', { creator: { ...product('mental').creator, category: 'mental', categories: [] } }),
    product('legacy', { creator: { ...product('legacy').creator, categories: ['ernaehrung', 'unknown-topic'] } }),
  ]
  const query = 'q=++Daily+++practice++&category=yoga&type=course&max_price=0&equipment=yoga_matte&level=anfaenger&duration=30_60&coaching=true&group=true&sort=newest&page=2'
  const { html } = page(query, inventory)
  const topicNav = topics(html)
  assert.ok(topicNav.includes('aria-current="page"'))
  assert.ok(!topicNav.includes('unknown-topic'))
  const topicLinks = links(topicNav)
  assert.equal(topicLinks.length, 4)
  assert.deepEqual(topicLinks.map(link => new URL(link.href, 'http://localhost').searchParams.get('category')).sort(), [null, 'ernaehrung', 'mental', 'yoga'].sort())
  for (const { href } of topicLinks) {
    const url = new URL(href, 'http://localhost')
    assert.equal(url.pathname, '/marketplace')
    assert.equal(url.searchParams.get('q'), 'Daily practice')
    assert.equal(url.searchParams.get('max_price'), '0')
    assert.equal(url.searchParams.get('sort'), 'newest')
    assert.equal(url.searchParams.get('type'), 'course')
    assert.equal(url.searchParams.get('equipment'), 'yoga_matte')
    assert.equal(url.searchParams.get('level'), 'anfaenger')
    assert.equal(url.searchParams.get('duration'), '30_60')
    assert.equal(url.searchParams.get('coaching'), 'true')
    assert.equal(url.searchParams.get('group'), 'true')
    assert.equal(url.searchParams.get('page'), null)
  }
})

test('explicit sort choice is retained as results mode and Übersicht returns to discovery', () => {
  const inventory = [product('one'), product('two')]
  const overview = page('', inventory)
  const overviewSorts = overview.selects.filter(select => select['aria-label'] === 'Produkte sortieren')
  assert.equal(overviewSorts.length, 2)
  assert.ok(overviewSorts.every(select => select.value === ''))
  for (const select of overviewSorts) select.onChange({ target: { value: 'newest' } })
  assert.deepEqual(overview.pushes, [
    ['/marketplace?sort=newest', { scroll: false }],
    ['/marketplace?sort=newest', { scroll: false }],
  ])

  const sorted = page('sort=newest', inventory)
  const sortedSelect = sorted.selects.find(select => select['aria-label'] === 'Produkte sortieren')
  assert.equal(sortedSelect.value, 'newest')
  assert.ok(sorted.html.includes('marketplace-results-title'))
  sortedSelect.onChange({ target: { value: '' } })
  assert.deepEqual(sorted.pushes, [['/marketplace', { scroll: false }]])
  assert.ok(page('', inventory).html.includes('marketplace-newest-title'))
})

test('price and rating sorts retain existing ordering inside one complete results rail', () => {
  const inventory = [
    product('expensive', { price: 70 }),
    product('free', { price: 0 }),
    product('middle', { price: 20 }),
  ]
  assert.deepEqual(ids(section(page('sort=price_asc', inventory).html, 'marketplace-results')), ['free', 'middle', 'expensive'])
  assert.deepEqual(ids(section(page('sort=price_desc', inventory).html, 'marketplace-results')), ['expensive', 'middle', 'free'])
  const rated = page('sort=top_rated', inventory, {
    free: { avg: 5, count: 1 },
    middle: { avg: 4.5, count: 100 },
  })
  assert.deepEqual(ids(section(rated.html, 'marketplace-results')), ['middle', 'free', 'expensive'])
  assert.ok(!rated.html.includes('marketplace-best-rated-title'))
  const overview = page('', inventory, {
    free: { avg: 5, count: 1 },
    middle: { avg: 4.5, count: 100 },
  })
  assert.deepEqual(ids(section(overview.html, 'marketplace-best-rated')), ['middle', 'free'])
})

test('empty filtered results expose the existing recovery actions and no unrelated shelves', () => {
  const { html } = page('q=missing&category=yoga', [product('unrelated')])
  assert.match(html, /Keine Produkte gefunden/)
  assert.match(html, /Zurücksetzen/)
  assert.ok(links(html).some(link => link.href === '/coaches?q=missing&category=yoga'))
  assert.deepEqual(ids(html), [])
  assert.ok(!html.includes('discovery-rail-track'))
  assert.ok(!html.includes('Seitennavigation der Marktplatz-Ergebnisse'))
})
