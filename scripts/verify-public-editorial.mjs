import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const h = React.createElement
const overrides = {
  '@/components/HeartButton': { __esModule: true, default: () => h('button', { 'aria-label': 'Favorit' }, '♡') },
  '@/components/CoachFinderWidget': { __esModule: true, default: () => h('p', null, 'Optional AI') },
}
const Home = loadUiComponent('src/app/MarketplaceClient.tsx', overrides).default
const creator = { id: 'synthetic', slug: 'synthetic', display_name: 'Test Coach', avatar_url: null, category: 'yoga', categories: ['yoga'] }
const product = { id: 'synthetic-product', title: 'Actual fixture title', type: 'pdf', price: 19, thumbnail_url: null, categories: ['yoga'], creator }
const coach = { ...creator, bio: '', is_verified: false, productCount: 1, hasVideoCoaching: false, hasSubscription: false, rating: null, coachingPrice: null }
const renderHome = (props = {}) => renderToStaticMarkup(h(Home, { products: [product], coaches: [coach], ratings: {}, salesCounts: {}, ...props }))
test('editorial discovery advertises only supported inventory and links to matching filters', () => {
  const html = renderHome()
  assert.match(html, /In Bewegung bleiben/)
  assert.match(html, /href="\/coaches\?category=yoga"/)
  for (const unsupported of ['Stärker werden', 'Gewicht bewusst gestalten', 'Ernährung entdecken', 'Mehr Ruhe finden']) assert.ok(!html.includes(unsupported))
  const empty = renderHome({ products: [], coaches: [] })
  assert.ok(!empty.includes('id="areas-title"'))
  assert.ok(!empty.includes('id="goals-title"'))
  assert.ok(!empty.includes('/coaches?subscription=true'))
})
test('story uses actual public ProductCard data and does not fabricate private UI or credibility', () => {
  const html = renderHome()
  assert.match(html, /Ardore · Einblick in den Marktplatz/)
  assert.equal(html.split('Actual fixture title').length - 1, 2)
  assert.ok(!html.includes('Optional AI'))
  assert.ok(!html.includes('Verifiziert</'))
  assert.doesNotMatch(html, /[0-9]+ Produktbewertungen/)
  assert.match(html, /Ohne Profilfoto/)
  assert.ok(!html.includes('<img'))
})
test('approved visual assets replace fallback geometry through existing media without altering card facts', () => {
  const html = renderHome({ heroImage: { src: '/approved-hero.jpg', alt: 'Approved lifestyle scene' }, categoryImages: { yoga: { src: '/approved-yoga.jpg', alt: 'Approved yoga scene' } } })
  assert.match(html, /src="\/approved-hero.jpg"/)
  assert.match(html, /alt="Approved lifestyle scene"/)
  assert.match(html, /src="\/approved-yoga.jpg"/)
  assert.match(html, /alt="Approved yoga scene"/)
  assert.match(html, /hero-visual/)
  assert.match(html, /19,00/)
})
