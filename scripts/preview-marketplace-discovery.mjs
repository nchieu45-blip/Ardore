// Local-only visual edge cases. Actual components, in-memory fixtures, no database/payment/auth mutations.
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const h = React.createElement
const mocks = {
  '@/components/HeartButton': {
    __esModule: true,
    default: () =>
      h(
        'button',
        {
          'aria-label': 'Favorit',
          className:
            'icon-button absolute right-3 top-3 z-20 bg-white border border-border',
        },
        '♡'
      ),
  },
}
const product = {
  id: 'synthetic-product',
  title:
    'Ein außergewöhnlich langer Produktname für einen strukturierten und entspannten Trainingsalltag mit sehr vielen zusätzlichen Informationen',
  type: 'pdf',
  price: 39,
  thumbnail_url: null,
  level: 'anfaenger',
  duration: '30_60',
  creator: {
    id: 'synthetic-coach',
    slug: 'synthetic-coach',
    display_name:
      'Ein außergewöhnlich langer Coachname mit zusätzlicher Bezeichnung',
    avatar_url: null,
    categories: ['yoga'],
    category: 'yoga',
  },
}
const coach = {
  ...product.creator,
  bio: 'Eine bewusst lange Positionierung, die auch bei kleinen Bildschirmen lesbar bleiben und zuverlässig begrenzt werden soll.',
  categories: ['yoga', 'stressbewaeltigung', 'beweglichkeit'],
  is_verified: false,
  rating: null,
  productCount: 1,
  hasVideoCoaching: true,
  hasSubscription: false,
  hasGroupClasses: false,
  coachingPrice: { price_cents: 6900, duration_minutes: 60 },
}
const ProductCard = loadUiComponent(
  'src/components/ui/ProductCard.tsx',
  mocks
).ProductCard
const CoachCard = loadUiComponent(
  'src/components/ui/CoachCard.tsx',
  mocks
).CoachCard
const { StatePanel } = loadUiComponent('src/components/ui/StatePanel.tsx')
const { ProductCardSkeleton, CoachCardSkeleton } = loadUiComponent(
  'src/components/ui/Skeleton.tsx'
)
const ErrorPage = loadUiComponent('src/components/RouteError.tsx').default
const css = readdirSync('.next/static/css')
  .filter((x) => x.endsWith('.css'))
  .map((x) => readFileSync(`.next/static/css/${x}`, 'utf8'))
  .join('\n')
createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:3012')
  if (url.pathname === '/style.css') {
    res.setHeader('Content-Type', 'text/css')
    res.end(css)
    return
  }
  let content
  if (url.pathname === '/error')
    content = h(ErrorPage, { error: new Error('synthetic'), reset() {} })
  else if (url.pathname === '/loading')
    content = h(
      'div',
      {
        className:
          'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6',
        role: 'status',
        'aria-label': 'Angebote werden geladen',
        'aria-busy': true,
      },
      h(ProductCardSkeleton),
      h(CoachCardSkeleton)
    )
  else if (url.pathname === '/empty')
    content = h(StatePanel, {
      title: 'Keine Produkte gefunden',
      description:
        'Versuche einen anderen Suchbegriff oder setze die Filter zurück.',
    })
  else
    content = h(
      'div',
      {
        className:
          'grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
      },
      h(ProductCard, { product }),
      h(ProductCard, {
        product: { ...product, id: 'free', price: 0, type: 'course' },
      }),
      h(CoachCard, { coach }),
      h(CoachCard, {
        coach: {
          ...coach,
          id: 'no-service',
          coachingPrice: null,
          hasVideoCoaching: false,
        },
      })
    )
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(
    '<!doctype html>' +
      renderToStaticMarkup(
        h(
          'html',
          { lang: 'de' },
          h(
            'head',
            null,
            h('meta', {
              name: 'viewport',
              content: 'width=device-width,initial-scale=1',
            }),
            h('link', { rel: 'stylesheet', href: '/style.css' })
          ),
          h(
            'body',
            null,
            h(
              'main',
              { className: 'ardore-container py-8' },
              h(
                'p',
                { className: 'mb-6 text-sm text-muted' },
                'Isolierte UI-Prüfung · synthetische Inhalte · keine Produktionsänderungen'
              ),
              content
            )
          )
        )
      )
  )
}).listen(3012, '127.0.0.1', () =>
  console.log('Read-only marketplace fixtures: http://127.0.0.1:3012')
)
