// Read-only local visual fixtures. No login, database, payment, email or video provider calls.
// Run after npm run build: node scripts/preview-group-bookings.mjs
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
import { groupUiHarness, available } from './fixtures/group-booking-ui.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const port = 3014
const h = React.createElement
const navigation = { useRouter: () => ({ refresh() {} }), redirect() { throw new Error('Unexpected fixture redirect') } }
const id = '12345678-1234-4234-8234-123456789012'
const base = { id: 'fixture-reservation', video_class_id: id, occurrence_start: '2026-11-01T12:00:00Z', duration_minutes: 60, class_title: 'Gemeinsam beweglich: Yoga für deinen Alltag', creator_slug: 'fixture-coach', price_cents: 1200, status: 'confirmed', booking_id: 'fixture-booking', refund_status: 'not_requested', amount_refunded_cents: 0, stripe_livemode: true }
async function content(path) {
  if (path === '/book') {
    const ready = groupUiHarness('booking', [available()])
    await ready.effects()
    const missing = groupUiHarness('booking', [available({ videoReady: false })])
    await missing.effects()
    return h('main', { className: 'mx-auto max-w-3xl px-4 py-8' },
      h('h1', { className: 'section-title' }, 'Gruppenkurs buchen'),
      h('p', { className: 'mt-2 text-sm text-muted' }, 'Synthetische Kursdaten · Preis und Plätze beziehen sich auf den ausgewählten Termin.'),
      h('div', { className: 'mt-6 grid gap-5 sm:grid-cols-2' }, ...[
        ['Yoga am Sonntag', ready], ['Video noch nicht verbunden', missing],
      ].map(([title, fixture]) => h('article', { key: title, className: 'rounded-xl border border-border bg-white p-5' }, h('h2', { className: 'mb-4 text-lg font-semibold' }, title), fixture.render()))))
  }
  if (path === '/video') {
    return h('main', { className: 'mx-auto max-w-3xl space-y-5 px-4 py-8' }, h('h1', { className: 'section-title' }, 'Deine Session'),
      groupUiHarness('video').render(),
      groupUiHarness('video', [], { scheduledAt: '2026-11-08T12:00:00Z' }).render(),
      groupUiHarness('video', [], { configurationReady: false }).render())
  }
  if (path !== '/buyer') return null
  const rows = [base, { ...base, id: 'fixture-pending', booking_id: null, status: 'processing', class_title: 'Entspannt in den Abend', occurrence_start: '2026-11-08T17:00:00Z' }, { ...base, id: 'fixture-refund', status: 'refund_pending', refund_status: 'pending', class_title: 'Beweglichkeit gemeinsam trainieren', occurrence_start: '2026-11-15T12:00:00Z' }]
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) }, from(table) {
    const q = { select: () => q, eq: () => q, is: () => q, order: async () => ({ data: table === 'group_booking_status' ? rows : [], error: null }) }; return q
  } }
  const Page = loadUiComponent('src/app/buyer/video-classes/page.tsx', { '@/lib/supabase/server': { createClient: async () => client }, 'next/navigation': navigation }).default
  return Page({ searchParams: Promise.resolve({ checkout: 'success' }) })
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
    res.setHeader('Cache-Control', 'no-store')
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end('Nur lesende lokale Vorschau.'); return }
    if (url.pathname === '/style.css') {
      res.setHeader('Content-Type', 'text/css; charset=utf-8')
      res.end(readdirSync(resolve(root, '.next/static/css')).filter(name => name.endsWith('.css')).map(name => readFileSync(resolve(root, '.next/static/css', name), 'utf8')).join('\n')); return
    }
    const font = url.pathname.match(/^\/(?:_next\/static\/)?media\/([a-zA-Z0-9._-]+\.woff2)$/)
    if (font) { res.setHeader('Content-Type', 'font/woff2'); res.end(readFileSync(resolve(root, '.next/static/media', font[1]))); return }
    const page = await content(url.pathname === '/' ? '/book' : url.pathname)
    if (!page) { res.writeHead(404); res.end('Lokale Vorschau: /book, /buyer, /video'); return }
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html>' + renderToStaticMarkup(h('html', { lang: 'de', style: { '--font-geist-sans': 'Geist, sans-serif' } },
      h('head', null, h('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }), h('title', null, 'Lokale Prüfung: Gruppenbuchung und Video'), h('link', { rel: 'stylesheet', href: '/style.css' })),
      h('body', null, h('aside', { className: 'border-b border-border bg-brand-soft px-4 py-3 text-sm text-brand-dark' }, h('p', { className: 'font-semibold' }, 'Lokale UI-Prüfung · synthetische Daten'), h('p', null, 'Statische Vorschau ohne Anmeldung, Zahlung oder Videoverbindung. Interaktionen werden separat mit lokalen Fixtures geprüft.'), h('nav', { className: 'mt-2 flex flex-wrap gap-4' }, ...[['/book','Termin auswählen'],['/buyer','Meine Gruppenbuchungen'],['/video','Videozugang']].map(([href, label]) => h('a', { key: href, href, className: 'inline-flex min-h-11 items-center font-medium underline underline-offset-4' }, label)))), page))))
  } catch (error) { res.writeHead(503); res.end(`Lokale Vorschau nicht verfügbar: ${error.message}`) }
}).listen(port, '127.0.0.1', () => console.log(`Read-only group UI: http://127.0.0.1:${port}/book`))
