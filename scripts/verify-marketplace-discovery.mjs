import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup as render } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const h = React.createElement
const mocks = {
  '@/components/HeartButton': {
    __esModule: true,
    default: () => h('button', { 'aria-label': 'Favorit' }, 'Merken'),
  },
}
const product = {
  id: 'synthetic-product',
  title: 'Ein sehr langer Titel mit wichtigen Informationen für den Alltag',
  type: 'pdf',
  price: 39,
  thumbnail_url: null,
  createdAt: '2026-10-01T00:00:00Z',
  categories: ['yoga'],
  equipment: [],
  level: 'anfaenger',
  duration: '30_60',
  creator: {
    id: 'synthetic-coach',
    display_name: 'Synthetic Coach Name',
    avatar_url: null,
    slug: 'synthetic-coach',
    category: 'yoga',
    categories: ['yoga'],
  },
}
const coach = {
  id: product.creator.id,
  slug: product.creator.slug,
  display_name: product.creator.display_name,
  avatar_url: null,
  bio: 'Yoga für deinen Alltag',
  category: 'yoga',
  categories: ['yoga'],
  qualifications: [],
  languages: ['de'],
  is_verified: false,
  createdAt: product.createdAt,
  productCount: 1,
  rating: null,
  hasVideoCoaching: true,
  hasGroupClasses: false,
  hasSubscription: false,
  coachingPrice: { price_cents: 6900, duration_minutes: 60 },
}
function clientMocks(query) {
  return {
    ...mocks,
    'next/navigation': {
      useSearchParams: () => new URLSearchParams(query),
      useRouter: () => ({ push() {}, replace() {} }),
    },
  }
}

test('product cards retain creator/avatar on mobile and separate interactive controls', () => {
  const Card = loadUiComponent(
    'src/components/ui/ProductCard.tsx',
    mocks
  ).ProductCard
  const html = render(h(Card, { product, rating: { avg: 0, count: 0 } }))
  assert.ok(html.includes('aspect-video'))
  assert.ok(html.includes('min-h-11 line-clamp-2'))
  assert.ok(html.includes('/creators/synthetic-coach'))
  assert.ok(html.includes('Synthetic Coach Name'))
  assert.ok(!html.includes('hidden sm:'))
  assert.ok(!html.includes('Bestseller'))
  assert.ok(!html.includes('aria-label="Bewertung'))
  assert.ok(html.includes('Einmaliger Kauf'))
  assert.ok(html.includes('Anfänger'))
  assert.ok(html.includes('30–60 Min'))
  for (const anchor of html.matchAll(/<a\b[^>]*>(.*?)<\/a>/gs))
    assert.ok(!/<button|<a\b/.test(anchor[1]))
})
test('coaching price comes only from an active 1:1 service and absent trust data stays absent', () => {
  const Card = loadUiComponent(
    'src/components/ui/CoachCard.tsx',
    mocks
  ).CoachCard
  const html = render(h(Card, { coach }))
  assert.ok(html.includes('aspect-[4/5]'))
  assert.ok(html.includes('69,00'))
  assert.ok(html.includes('60 Min.'))
  assert.ok(!html.includes('Verifiziert'))
  assert.ok(!html.includes('Gruppen'))
  assert.ok(!html.includes('Nächster'))
  const noService = render(
    h(Card, {
      coach: { ...coach, hasVideoCoaching: false, coachingPrice: null },
    })
  )
  assert.ok(!noService.includes('Coaching ab'))
  assert.ok(!noService.includes('39,00'))
  const trusted = render(
    h(Card, {
      coach: { ...coach, is_verified: true, rating: { avg: 4, count: 2 } },
    })
  )
  assert.ok(trusted.includes('Verifiziert'))
  assert.ok(trusted.includes('Produktbewertungen'))
})
test('search intention links preserve normalized search/category and drop incompatible product filters', () => {
  const { discoveryHref, DiscoveryNavigation } = loadUiComponent(
    'src/components/ui/DiscoveryNavigation.tsx'
  )
  assert.equal(
    discoveryHref('/coaches', '  Yoga   Alltag  ', 'yoga'),
    '/coaches?q=Yoga+Alltag&category=yoga'
  )
  const html = render(
    h(DiscoveryNavigation, {
      active: 'products',
      search: 'Coach Name',
      category: 'yoga',
    })
  )
  assert.ok(html.includes('aria-current="page"'))
  assert.ok(html.includes('/coaches?q=Coach+Name'))
})
test('coach search works from URL and includes biography and translated taxonomy', () => {
  const Page = loadUiComponent(
    'src/app/coaches/CoachesPageClient.tsx',
    clientMocks('q=alltag')
  ).default
  assert.ok(
    render(h(Page, { coaches: [coach] })).includes('Synthetic Coach Name')
  )
  const Empty = loadUiComponent(
    'src/app/coaches/CoachesPageClient.tsx',
    clientMocks('q=nothing-matches')
  ).default
  const html = render(h(Empty, { coaches: [coach] }))
  assert.ok(html.includes('Keine Coaches gefunden'))
  assert.ok(!html.includes('Synthetic Coach Name'))
  assert.ok(html.includes('Produkte ansehen'))
})
test('product search, price filter and legacy coach filters keep explicit scoped results', () => {
  const Page = loadUiComponent(
    'src/app/marketplace/MarketplacePageClient.tsx',
    clientMocks('q=Synthetic+Coach')
  ).default
  assert.ok(
    render(
      h(Page, { products: [product], salesCounts: {}, ratings: {} })
    ).includes(product.title)
  )
  const Cheap = loadUiComponent(
    'src/app/marketplace/MarketplacePageClient.tsx',
    clientMocks('max_price=25')
  ).default
  const html = render(
    h(Cheap, { products: [product], salesCounts: {}, ratings: {} })
  )
  assert.ok(html.includes('Keine Produkte gefunden'))
  assert.ok(!html.includes(product.title))
  assert.ok(html.includes('Preis bis 25'))
  assert.ok(!html.includes('Beliebteste'))
  assert.ok(html.includes('Hier findest du Produkte'))
})
test('home uses shared person/product cards and inventory precedes collapsed optional AI assistance', () => {
  const Home = loadUiComponent('src/app/MarketplaceClient.tsx', {
    ...mocks,
    '@/components/CoachFinderWidget': {
      __esModule: true,
      default: () => h('p', null, 'AI content'),
    },
  }).default
  const html = render(
    h(Home, {
      coaches: [coach],
      products: [product],
      salesCounts: {},
      ratings: {},
    })
  )
  assert.ok(
    html.indexOf('home-coaches-title') < html.indexOf('home-products-title')
  )
  assert.ok(
    html.indexOf('home-products-title') < html.indexOf('Hilfe bei der Auswahl')
  )
  assert.ok(!html.includes('AI content'))
  assert.ok(!html.includes('Gruppen'))
  assert.ok(!html.includes('qualifizierten'))
  assert.ok(html.includes('action="/coaches"'))
  assert.ok(html.includes('name="q"'))
  assert.ok(html.includes('Meeting-Link'))
})
test('public coach model respects publish scope, public prices and safe read errors', async () => {
  const calls = []
  const rows = {
    creator_profiles: [{ ...coach, created_at: coach.createdAt }],
    products: [{ id: product.id, creator_id: coach.id }],
    public_product_reviews: [],
    coaching_offers: [
      { creator_id: coach.id, price_cents: 6900, duration_minutes: 60 },
    ],
    video_classes: [],
    subscription_tiers: [],
  }
  const client = {
    from(table) {
      return {
        select(value) {
          calls.push([table, 'select', value])
          return this
        },
        eq(k, v) {
          calls.push([table, 'eq', k, v])
          return this
        },
        in() {
          return this
        },
        order() {
          return this
        },
        then(resolve) {
          resolve({ data: rows[table], error: null })
        },
      }
    },
  }
  const loader = loadUiComponent('src/lib/publicCoaches.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
  })
  const result = await loader.loadPublicCoaches()
  assert.deepEqual(result[0].coachingPrice, {
    creator_id: coach.id,
    price_cents: 6900,
    duration_minutes: 60,
  })
  assert.ok(
    calls.some(
      (x) =>
        x[0] === 'creator_profiles' &&
        x[1] === 'eq' &&
        x[2] === 'is_published' &&
        x[3] === true
    )
  )
  assert.ok(
    calls.some(
      (x) =>
        x[0] === 'coaching_offers' &&
        x[1] === 'eq' &&
        x[2] === 'is_enabled' &&
        x[3] === true
    )
  )
  assert.ok(calls.every((x) => !String(x).includes('stripe_account')))
})
