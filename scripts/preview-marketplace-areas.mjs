// Local visual QA only: in-memory synthetic inventory, no auth, database, payment or email access.
// Run after `npm run build`: node scripts/preview-marketplace-areas.mjs
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const h = React.createElement
const port = 3013
const root = resolve(new URL('..', import.meta.url).pathname)
const cssDirectory = resolve(root, '.next/static/css')
const fontDirectory = resolve(root, '.next/static/media')
const day = 86_400_000
const now = Date.now()

function creator(index) {
  return {
    id: `synthetic-creator-${index}`,
    slug: `synthetic-coach-${index}`,
    display_name: index % 4 === 0
      ? 'Ein außergewöhnlich langer Coachname mit zusätzlicher Bezeichnung'
      : ['Lena Beispiel', 'Max Muster', 'Alex Test', 'Sam Beispiel'][index % 4],
    avatar_url: null,
    categories: index % 2 === 0 ? ['yoga', 'beweglichkeit'] : ['ernaehrung'],
    category: index % 2 === 0 ? 'yoga' : 'ernaehrung',
    is_verified: index % 5 === 0,
  }
}

function baseOffer(index) {
  return {
    id: `synthetic-coaching-${index}`,
    kind: 'coaching',
    title: index % 4 === 0
      ? 'Persönliches Coaching für einen strukturierten und entspannten Alltag mit langfristiger Begleitung'
      : ['Deine persönliche Yoga-Praxis', 'Ernährung, die zu dir passt', 'Beweglicher durch den Alltag', 'Klarheit für deinen nächsten Schritt'][index % 4],
    description: 'Synthetische Angebotsbeschreibung für die lokale Prüfung: Gemeinsam entwickeln wir einen konkreten Plan für deinen Alltag und deine persönlichen Ziele.',
    priceCents: [0, 3900, 6900, 12900][index % 4],
    durationMinutes: [30, 45, 60, 90][index % 4],
    createdAt: new Date(now - index * day).toISOString(),
    creator: creator(index),
    // Synthetic completed-session review fixtures, never production endorsements.
    rating: index % 3 === 0 ? null : { avg: [4.2, 4.8, 5][index % 3], count: index + 1 },
    scheduleType: null,
    startsAt: null,
    recurringWeekday: null,
    recurringTime: null,
    maxParticipants: null,
    includedInSubscription: false,
  }
}

const coaching = Array.from({ length: 24 }, (_, index) => baseOffer(index))
const groups = Array.from({ length: 12 }, (_, index) => ({
  ...baseOffer(index),
  id: `synthetic-group-${index}`,
  kind: 'group',
  title: index % 4 === 0
    ? 'Gemeinsam beweglich bleiben: ein ausführlich benannter Gruppentermin für deinen Alltag'
    : ['Yoga am Morgen', 'Ernährung gemeinsam verstehen', 'Beweglichkeit in der Gruppe', 'Entspannt in den Abend'][index % 4],
  priceCents: [0, 1900, 2900][index % 3],
  rating: null,
  scheduleType: index % 2 === 0 ? 'once' : 'recurring',
  startsAt: index % 2 === 0 ? new Date(now + (12 - index) * day).toISOString() : null,
  recurringWeekday: index % 2 === 0 ? null : index % 7,
  recurringTime: index % 2 === 0 ? null : '18:30:00',
  maxParticipants: index % 3 === 0 ? null : [8, 12, 20][index % 3],
  includedInSubscription: index % 3 === 1,
}))
const products = Array.from({ length: 8 }, (_, index) => ({
  id: `synthetic-product-${index}`,
  title: ['Yoga für den Alltag', 'Dein persönlicher Ernährungsplan', 'Beweglichkeit Schritt für Schritt', 'Ein Kurs für deine täglichen Routinen'][index % 4],
  description: 'Synthetischer digitaler Inhalt für die lokale Darstellung.',
  type: index % 3 === 0 ? 'course' : 'pdf',
  price: index % 4 === 0 ? 0 : 29,
  thumbnail_url: null,
  createdAt: new Date(now - index * day).toISOString(),
  categories: creator(index).categories,
  equipment: [],
  level: 'anfaenger',
  duration: '30_60',
  creator: creator(index),
}))

function pageFor(url) {
  // A fresh module cache per request keeps the URL hooks tied to this page only.
  return loadUiComponent('src/app/marketplace/MarketplacePageClient.tsx', {
    'next/navigation': {
      useSearchParams: () => url.searchParams,
      useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
    },
    '@/components/HeartButton': {
      __esModule: true,
      default: () => h('button', {
        type: 'button',
        'aria-label': 'Synthetischer Favorit, in Vorschau ohne Funktion',
        className: 'icon-button absolute right-3 top-3 z-20 border border-border bg-surface',
      }, 'Merken'),
    },
  }).default
}

createServer((req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end('Diese lokale Vorschau erlaubt nur lesende Anfragen.')
      return
    }
    if (url.pathname === '/style.css') {
      const css = readdirSync(cssDirectory)
        .filter(name => name.endsWith('.css'))
        .sort()
        .map(name => readFileSync(resolve(cssDirectory, name), 'utf8'))
        .join('\n')
      if (!css) throw new Error('Keine gebaute CSS-Datei vorhanden. Zuerst npm run build ausführen.')
      res.setHeader('Content-Type', 'text/css; charset=utf-8')
      res.end(css)
      return
    }
    // Built Next font URLs can be relative to CSS or absolute under /_next/static.
    const font = url.pathname.match(/^\/(?:_next\/static\/)?media\/([a-zA-Z0-9._-]+\.woff2)$/)
    if (font) {
      res.setHeader('Content-Type', 'font/woff2')
      res.end(readFileSync(resolve(fontDirectory, font[1])))
      return
    }
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/marketplace?area=coaching' })
      res.end()
      return
    }
    if (url.pathname !== '/marketplace') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Nur lokale Marktplatz-Vorschau. Coach- und Produktdetails sind hier nicht angebunden.')
      return
    }
    const Page = pageFor(url)
    const state = url.searchParams.get('state')
    const content = h(Page, {
      products: state === 'empty' ? [] : products,
      salesCounts: {},
      ratings: {},
      serviceOffers: state === 'empty' ? [] : [...coaching, ...groups],
      serviceError: state === 'error',
      ratingsUnavailable: state === 'ratings-unavailable',
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html>' + renderToStaticMarkup(
      h('html', { lang: 'de', style: { '--font-geist-sans': 'Geist, "Geist Fallback", sans-serif' } },
        h('head', null,
          h('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }),
          h('meta', { name: 'robots', content: 'noindex,nofollow' }),
          h('title', null, 'Synthetische lokale Marktplatz-Vorschau'),
          h('link', { rel: 'stylesheet', href: '/style.css' }),
        ),
        h('body', null,
          h('aside', { className: 'border-b border-border bg-brand-soft px-4 py-3 text-sm leading-relaxed text-brand-dark' },
            h('div', { className: 'ardore-container' },
              h('p', { className: 'font-semibold' }, 'Lokale UI-Prüfung · ausschließlich synthetische Angebote und Bewertungen'),
              h('p', null, 'Statische Darstellung ohne Anmeldung, Buchung oder Datenänderung. Seitlich scrollen und Links funktionieren; Suche, Filter und Pfeilbuttons benötigen die echte Anwendung.'),
            ),
          ),
          h('main', null, content),
        ),
      ),
    ))
  } catch (error) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Lokale Vorschau nicht verfügbar: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Synthetic marketplace UI: http://127.0.0.1:${port}/marketplace?area=coaching`)
  console.log(`Groups: http://127.0.0.1:${port}/marketplace?area=groups`)
  console.log('URL fixtures: category, q, sort, max_price, page; optional state=empty|error|ratings-unavailable')
})
