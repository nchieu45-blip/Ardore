import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const Testimonials = loadUiComponent('src/components/HomeTestimonials.tsx').default
const { homeTestimonials } = loadUiComponent('src/app/home-testimonials.ts')

test('public testimonials render nothing until approved quotes are available', () => {
  assert.equal(renderToStaticMarkup(React.createElement(Testimonials, { entries: [] })), '')
  for (const entry of homeTestimonials) {
    assert.ok(entry.quote.trim())
    assert.ok(entry.attribution.trim())
  }
})

test('testimonial navigation is only present for multiple entries', () => {
  const first = { quote: 'Testinhalt A', attribution: 'Testkennung A' }
  const second = { quote: 'Testinhalt B', attribution: 'Testkennung B' }
  const render = entries => renderToStaticMarkup(React.createElement(Testimonials, { entries }))
  const single = render([first])
  assert.match(single, /<blockquote[^>]*>„Testinhalt A“<\/blockquote>/)
  assert.doesNotMatch(single, /Vorherige Stimme|Nächste Stimme/)
  const multiple = render([first, second])
  assert.match(multiple, /aria-label="Vorherige Stimme"/)
  assert.match(multiple, /aria-label="Nächste Stimme"/)
  assert.match(multiple, /aria-live="polite"/)
  assert.doesNotMatch(multiple, /Testinhalt B/)
})
