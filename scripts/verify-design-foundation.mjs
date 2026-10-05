import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'
const render = element => renderToStaticMarkup(element)
const forms = loadUiComponent('src/components/ui/Input.tsx')
const buttons = loadUiComponent('src/components/ui/Button.tsx')
const media = loadUiComponent('src/components/ui/Media.tsx')
const badges = loadUiComponent('src/components/ui/StatusBadge.tsx')

test('generated and explicit field IDs link labels and feedback; external descriptions survive', () => {
  const html = render(React.createElement('form', null,
    React.createElement(forms.Input, { label: 'Name', error: 'Bitte Name eingeben', required: true, 'aria-describedby': 'explanation' }),
    React.createElement(forms.Input, { label: 'E-Mail', hint: 'Nur für dieses Konto', id: 'email' }),
    React.createElement(forms.Textarea, { label: 'Nachricht', error: 'Zu lang', required: true }),
    React.createElement(forms.Select, { label: 'Format', hint: 'Wähle ein Format', options: [{ value: 'pdf', label: 'PDF' }] }),
    React.createElement(forms.Checkbox, { label: 'Zustimmen', hint: 'Optional' }),
    React.createElement(forms.Radio, { label: 'Online', name: 'format', value: 'online' }),
  ))
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  for (const [, id] of html.matchAll(/\bfor="([^"]+)"/g)) assert.ok(ids.includes(id), `Label points to existing control ${id}`)
  for (const [, references] of html.matchAll(/aria-describedby="([^"]+)"/g)) for (const id of references.split(' ')) assert.ok(id === 'explanation' || ids.includes(id))
  assert.equal((html.match(/aria-invalid="true"/g) || []).length, 2)
  assert.equal((html.match(/role="alert"/g) || []).length, 2)
  assert.ok(html.includes('required=""'))
})
test('loading blocks duplicate button activation and announces busy; links are single semantic controls', () => {
  const html = render(React.createElement(buttons.Button, { loading: true, type: 'submit' }, 'Speichern'))
  assert.ok(html.includes('disabled=""')); assert.ok(html.includes('aria-busy="true"')); assert.ok(html.includes('Speichern'))
  const link = render(React.createElement(buttons.ButtonLink, { href: '/register' }, 'Registrieren'))
  assert.ok(link.startsWith('<a ')); assert.ok(!link.includes('<button'))
  const icon = render(React.createElement(buttons.IconButton, { label: 'Menü öffnen' }, ''))
  assert.ok(icon.includes('aria-label="Menü öffnen"')); assert.ok(icon.includes('type="button"'))
})
test('media reserves product/portrait geometry without fabricated images', () => {
  const product = render(React.createElement(media.ProductThumbnail, { src: null, alt: 'Trainingsplan' }))
  assert.ok(product.includes('aspect-video')); assert.ok(!product.includes('<img'))
  const portrait = render(React.createElement(media.CoachPortrait, { src: null, alt: 'Coach' }))
  assert.ok(portrait.includes('aspect-[4/5]')); assert.ok(!portrait.includes('<img'))
  const actual = render(React.createElement(media.ProductThumbnail, { src: '/actual.jpg', alt: 'Trainingsplan' }))
  assert.ok(actual.includes('alt="Trainingsplan"')); assert.ok(actual.includes('sizes='))
})
test('statuses retain explicit trusted-model text and unknown states never claim confirmation', () => {
  for (const [status, label] of [['confirmed', 'Bestätigt'], ['pending_payment', 'Zahlung ausstehend'], ['payment_failed', 'Zahlung fehlgeschlagen'], ['refunded', 'Erstattet'], ['unknown', 'Status wird geprüft']]) {
    assert.ok(render(React.createElement(badges.BookingStatusBadge, { status })).includes(label))
  }
  assert.ok(render(React.createElement(badges.PublishBadge, { published: false })).includes('Entwurf'))
})
test('foundation action/body/status colors meet WCAG AA text contrast on their actual surfaces', () => {
  const css = readFileSync('src/app/design-foundation.css', 'utf8')
  const color = name => { const value = css.match(new RegExp(`--${name}: (#[a-f0-9]{6});`)); assert.ok(value, name); return value[1] }
  function luminance(hex) { const c = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722 }
  function contrast(a, b) { const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05) }
  for (const [text, background] of [['foreground','background'], ['color-gray-400','background'], ['text-secondary','background'], ['primary','surface'], ['danger','danger-soft'], ['warning','warning-soft'], ['info','info-soft'], ['success','secondary']]) assert.ok(contrast(color(text),color(background)) >= 4.5, `${text}/${background}`)
  assert.ok(contrast(color('border-control'),color('surface')) >= 3)
})
test('public discovery read failures throw to the retry UI instead of showing empty inventory', async () => {
  const query = { select(){return this}, eq(){return this}, order(){return this}, limit(){return this}, then(resolve){resolve({data:null,error:{message:'private provider detail'}})} }
  const mocks = {
    '@/lib/supabase/server': { createClient: async () => ({ from: () => query }) },
    '@/app/MarketplaceClient': { __esModule: true, default: () => null },
    './MarketplacePageClient': { __esModule: true, default: () => null },
    './CoachesPageClient': { __esModule: true, default: () => null },
  }
  for (const path of ['src/app/page.tsx', 'src/app/marketplace/page.tsx', 'src/app/coaches/page.tsx']) {
    await assert.rejects(loadUiComponent(path,mocks).default(), error => /konnten nicht geladen werden/.test(error.message) && !error.message.includes('private'))
  }
})

test('existing inverse hero button overrides remain legible after consolidation', () => {
  const style=buttons.buttonStyles({className:'bg-white text-green-800 hover:bg-green-50'})
  assert.ok(style.includes('bg-white'));assert.ok(style.includes('text-green-800'))
  assert.ok(!style.split(' ').includes('bg-brand'));assert.ok(!style.split(' ').includes('text-white'))
  const outline=buttons.buttonStyles({variant:'outline',className:'border-white/30 text-white bg-transparent hover:bg-white/10'})
  assert.ok(outline.includes('bg-transparent'));assert.ok(!outline.split(' ').includes('bg-surface'))
})
