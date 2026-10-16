import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const { buildHomeProductRows } = loadUiComponent('src/lib/homeDiscovery.ts')

function product(id, overrides = {}) {
  return {
    id,
    title: `Fixture ${id}`,
    type: 'pdf',
    price: 20,
    createdAt: '2026-10-01T12:00:00Z',
    categories: [],
    creator: { category: null, categories: [] },
    ...overrides,
  }
}

function ids(row) {
  return row.products.map((item) => item.id)
}

test('empty inventory has no synthetic product shelves', () => {
  assert.deepEqual(buildHomeProductRows([], {}), [])
})

test('newest uses actual dates, deterministic ties, and puts invalid dates last', () => {
  const rows = buildHomeProductRows([
    product('invalid', { createdAt: 'not-a-date' }),
    product('older', { createdAt: '1960-01-01T00:00:00Z' }),
    product('b'),
    product('newest', { createdAt: '2026-10-16T12:00:00Z' }),
    product('a'),
  ], {})
  assert.deepEqual(ids(rows[0]), ['newest', 'a', 'b', 'older', 'invalid'])
})

test('best-rated ranks real averages, review counts, dates, then stable IDs', () => {
  const products = [
    product('low-many'), product('perfect'), product('same-fewer'),
    product('same-older', { createdAt: '2026-09-01T12:00:00Z' }),
    product('same-b'), product('same-a'), product('unrated'),
  ]
  const rows = buildHomeProductRows(products, {
    'low-many': { avg: 4.5, count: 100 },
    perfect: { avg: 5, count: 1 },
    'same-fewer': { avg: 4.8, count: 2 },
    'same-older': { avg: 4.8, count: 3 },
    'same-a': { avg: 4.8, count: 3 },
    'same-b': { avg: 4.8, count: 3 },
  })
  assert.deepEqual(ids(rows.find((row) => row.id === 'best-rated')), [
    'perfect', 'same-a', 'same-b', 'same-older', 'same-fewer', 'low-many',
  ])
})

test('invalid rating data never turns into a best-rated recommendation', () => {
  const invalid = [
    undefined,
    { avg: 0, count: 1 },
    { avg: -1, count: 1 },
    { avg: 5.1, count: 1 },
    { avg: NaN, count: 1 },
    { avg: Infinity, count: 1 },
    { avg: 5, count: 0 },
    { avg: 5, count: -1 },
    { avg: 5, count: 1.5 },
    { avg: 5, count: Infinity },
    { avg: 5, count: NaN },
  ]
  const products = invalid.map((_, index) => product(`invalid-${index}`))
  const ratings = Object.fromEntries(invalid.map((rating, index) => [`invalid-${index}`, rating]))
  const row = buildHomeProductRows(products, ratings).find((item) => item.id === 'best-rated')
  assert.equal(row.title, 'Best bewertet')
  assert.deepEqual(row.products, [])
})

test('seven unrated products still expose honest newest, empty review, and course rows', () => {
  const inventory = Array.from({ length: 7 }, (_, i) => product(`p-${i}`, {
    type: i === 0 ? 'course' : 'video',
  }))
  const rows = buildHomeProductRows(inventory, {})
  assert.deepEqual(rows.map((row) => row.id), ['newest', 'best-rated', 'courses'])
  assert.deepEqual(rows[1].products, [])
  assert.deepEqual(ids(rows[2]), ['p-0'])
  assert.ok(rows.every((row) => !/bestseller|beliebtest|meistverkauft/i.test(row.title)))
})

test('course and free shelves use exact product fields and supported marketplace URLs', () => {
  const rows = buildHomeProductRows([
    product('course', { type: 'course' }),
    product('free', { price: 0 }),
    product('negative', { price: -5 }),
    product('video', { type: 'video' }),
  ], {})
  assert.deepEqual(ids(rows.find((row) => row.id === 'courses')), ['course'])
  assert.deepEqual(ids(rows.find((row) => row.id === 'free')), ['free'])
  const hrefs = Object.fromEntries(rows.map((row) => [row.id, new URL(row.href, 'http://localhost')]))
  assert.equal(hrefs.newest.searchParams.get('sort'), 'newest')
  assert.equal(hrefs['best-rated'].searchParams.get('sort'), 'top_rated')
  assert.equal(hrefs.courses.searchParams.get('type'), 'course')
  assert.equal(hrefs.free.searchParams.get('max_price'), '0')
  assert.ok(Object.values(hrefs).every((url) => url.pathname === '/marketplace'))
})

test('topic shelves match real product and coach categories, with a two-topic limit', () => {
  const rows = buildHomeProductRows([
    product('a', { categories: ['yoga', 'mental', 'krafttraining', 'unknown-topic'] }),
    product('b', { creator: { category: 'yoga', categories: ['mental', 'krafttraining', 'unknown-topic'] } }),
    product('c'),
  ], {})
  const topics = rows.filter((row) => row.id.startsWith('category-'))
  assert.deepEqual(topics.map((row) => row.id), ['category-yoga', 'category-mental'])
  for (const row of topics) {
    assert.deepEqual(ids(row), ['a', 'b'])
    assert.equal(new URL(row.href, 'http://localhost').searchParams.get('category'), row.id.slice('category-'.length))
  }
})

test('single-item, unknown, and whole-inventory topics are omitted', () => {
  const rows = buildHomeProductRows([
    product('a', { categories: ['yoga', 'mental', 'mental', 'unknown-topic'] }),
    product('b', { categories: ['yoga', 'unknown-topic'] }),
  ], {})
  assert.ok(!rows.some((row) => row.id.startsWith('category-')))
})

test('all populated shelves cap at twelve without sorting or changing source data', () => {
  const inventory = Array.from({ length: 15 }, (_, i) => Object.freeze(product(`p-${String(i).padStart(2, '0')}`, {
    type: 'course',
    price: 0,
    categories: Object.freeze(i < 14 ? ['yoga'] : []),
    creator: Object.freeze({ category: null, categories: Object.freeze([]) }),
    createdAt: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
  })))
  const ratings = Object.freeze(Object.fromEntries(inventory.map((item) => [item.id, Object.freeze({ avg: 4, count: 1 })])))
  const before = structuredClone(inventory)
  Object.freeze(inventory)
  const rows = buildHomeProductRows(inventory, ratings)
  assert.ok(rows.every((row) => row.products.length === 12))
  assert.deepEqual(inventory, before)
  assert.equal(rows[0].products[0], inventory[14])
  assert.deepEqual(ids(rows[0]).slice(0, 2), ['p-14', 'p-13'])
})
