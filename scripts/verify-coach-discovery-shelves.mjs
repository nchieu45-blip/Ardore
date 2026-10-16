import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const h = React.createElement
const { buildCoachDiscoveryRows } = loadUiComponent('src/lib/coachDiscovery.ts')

function coach(id, overrides = {}) {
  return {
    id,
    slug: id,
    display_name: `Coach ${id}`,
    bio: 'Begleitung für den Alltag',
    category: 'yoga',
    categories: ['yoga'],
    qualifications: [],
    languages: ['de'],
    is_verified: false,
    avatar_url: null,
    createdAt: '2026-10-01T00:00:00Z',
    productCount: 0,
    rating: null,
    hasVideoCoaching: false,
    hasGroupClasses: false,
    coachingPrice: null,
    hasSubscription: false,
    ...overrides,
  }
}

function page(coaches, query = '') {
  const Page = loadUiComponent('src/app/coaches/CoachesPageClient.tsx', {
    'next/navigation': {
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({ push() {}, replace() {} }),
    },
    '@/components/HeartButton': {
      __esModule: true,
      default: () => h('button', { 'aria-label': 'Favorit' }, 'Merken'),
    },
  }).default
  return render(h(Page, { coaches }))
}

function rail(html, id) {
  const match = html.match(new RegExp(`<ul[^>]*id="${id}-items"[^>]*>(.*?)</ul>`, 's'))
  assert.ok(match, `Missing rail ${id}`)
  return match[1]
}

test('coach discovery uses actual active formats and topic subsets without mutating inventory', () => {
  const coaches = [
    coach('yoga-one', { hasVideoCoaching: true }),
    coach('yoga-two', { hasSubscription: true }),
    coach('legacy-fitness', { categories: [], category: 'fitness' }),
  ]
  const snapshot = structuredClone(coaches)
  const rows = buildCoachDiscoveryRows(coaches, ['yoga', 'fitness', 'unknown'])
  assert.deepEqual(rows.find(row => row.id === 'coaching').coaches.map(c => c.id), ['yoga-one'])
  assert.deepEqual(rows.find(row => row.id === 'subscriptions').coaches.map(c => c.id), ['yoga-two'])
  assert.deepEqual(rows.find(row => row.id === 'category-yoga').coaches.map(c => c.id), ['yoga-one', 'yoga-two'])
  assert.ok(!rows.some(row => row.id === 'category-fitness' || row.id === 'category-unknown'))
  assert.ok(!rows.some(row => /bewertet|beliebt/i.test(row.title)))
  assert.deepEqual(coaches, snapshot)
  assert.deepEqual(buildCoachDiscoveryRows([], ['yoga']), [])
})

test('new profiles are ordered deterministically, limited previews link to the complete list', () => {
  const inventory = Array.from({ length: 15 }, (_, index) => coach(`c${String(index).padStart(2, '0')}`, {
    createdAt: index === 0 ? 'invalid' : `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
  }))
  const [newest] = buildCoachDiscoveryRows(inventory, ['yoga'])
  assert.equal(newest.coaches.length, 12)
  assert.equal(newest.coaches[0].id, 'c14')
  assert.equal(newest.href, '/coaches?sort=newest')
  assert.equal(buildCoachDiscoveryRows([coach('b'), coach('a')], [])[0].coaches[0].id, 'a')
  const html = page(inventory, 'sort=newest')
  const results = rail(html, 'coaches-results')
  assert.equal((results.match(/<article\b/g) ?? []).length, 15)
  assert.ok(results.indexOf('Coach c14') < results.indexOf('Coach c13'))
  assert.ok(results.indexOf('Coach c01') < results.indexOf('Coach c00'))
  assert.ok(!html.includes('coaches-newest-items'))
})

test('coach browse shelves and navigation expose only real inventory topics', () => {
  const html = page([
    coach('yoga-one', { hasVideoCoaching: true }),
    coach('yoga-two'),
    coach('pilates-one', { categories: ['pilates'], category: 'pilates', hasSubscription: true }),
  ])
  assert.ok(html.includes('coaches-newest-items'))
  assert.ok(html.includes('coaches-coaching-items'))
  assert.ok(html.includes('coaches-subscriptions-items'))
  assert.ok(html.includes('coaches-category-yoga-items'))
  assert.ok(html.includes('/coaches?category=pilates'))
  assert.ok(!html.includes('/coaches?category=mental'))
  assert.ok(html.includes('<option value="" selected="">Übersicht</option>'))
  assert.ok(!html.includes('coaches-results-items'))
})

test('combined coach filters stay scoped in one complete horizontal result list and topic links', () => {
  const coaches = [
    coach('match', { hasVideoCoaching: true, productCount: 2 }),
    coach('match-more', { hasVideoCoaching: true, productCount: 5 }),
    coach('wrong-language', { languages: ['en'], hasVideoCoaching: true }),
    coach('wrong-format'),
    coach('wrong-topic', { categories: ['pilates'], category: 'pilates', hasVideoCoaching: true }),
  ]
  const html = page(coaches, 'q=Alltag&category=yoga&language=de&videocoaching=true&sort=most_products')
  const results = rail(html, 'coaches-results')
  assert.equal((results.match(/<article\b/g) ?? []).length, 2)
  assert.ok(results.indexOf('Coach match-more') < results.indexOf('Coach match<'))
  assert.ok(!results.includes('wrong-'))
  assert.ok(!html.includes('coaches-newest-items'))
  assert.ok(html.includes('/coaches?q=Alltag&amp;category=pilates&amp;language=de&amp;videocoaching=true&amp;sort=most_products'))
  assert.ok(html.includes('href="/coaches"'))
})

test('legacy group and rating filters retain their explicit scope and empty-state recovery', () => {
  const coaches = [
    coach('group', { hasGroupClasses: true, rating: { avg: 3, count: 1 } }),
    coach('higher-group', { hasGroupClasses: true, rating: { avg: 5, count: 2 } }),
    coach('other'),
  ]
  const html = page(coaches, 'groupclasses=true&sort=top_rated')
  const results = rail(html, 'coaches-results')
  assert.equal((results.match(/<article\b/g) ?? []).length, 2)
  assert.ok(results.indexOf('Coach higher-group') < results.indexOf('Coach group<'))
  assert.ok(html.includes('Nach Produktbewertungen'))
  assert.ok(html.includes('Gruppen-Sessions (bestehender Filter)'))
  const empty = page(coaches, 'category=unknown')
  assert.ok(empty.includes('Keine Coaches gefunden'))
  assert.ok(empty.includes('Zurücksetzen'))
  assert.ok(!empty.includes('coaches-results-items'))
})
