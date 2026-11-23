import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { loadUiComponent } from './fixtures/load-ui-component.mjs'

const Testimonials = loadUiComponent('src/components/HomeTestimonials.tsx').default
const { homeTestimonials } = loadUiComponent('src/app/home-testimonials.ts')
const Faq = loadUiComponent('src/components/HomeFaq.tsx').default
const ProductDemo = loadUiComponent('src/components/ArdoreProductVideo.tsx').default

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

test('six native FAQ disclosures and their JSON-LD stay in sync in both launch modes', () => {
  for (const launchPaused of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(Faq, { launchPaused }))
    const script = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)
    assert.ok(script)
    const markup = html.replace(script[0], '')
    const questions = [...markup.matchAll(/<summary[^>]*><span>([^<]*)<\/span>/g)].map(match => match[1])
    const schema = JSON.parse(script[1])
    assert.equal(schema['@type'], 'FAQPage')
    assert.equal(questions.length, 6)
    assert.equal((markup.match(/<details name="ardore-home-faq"/g) ?? []).length, 6)
    assert.deepEqual(schema.mainEntity.map(question => question.name), questions)
    for (const question of schema.mainEntity) {
      assert.equal(question['@type'], 'Question')
      assert.equal(question.acceptedAnswer['@type'], 'Answer')
      assert.ok(markup.includes(question.acceptedAnswer.text))
    }
    assert.equal(markup.includes('Zahlungen über Ardore sind vorübergehend pausiert.'), launchPaused)
  }
})

test('the product demo shows a poster and accessible play action before loading any media', () => {
  const html = renderToStaticMarkup(React.createElement(ProductDemo))
  assert.match(html, /So einfach geht’s/)
  assert.match(html, /<img[^>]*src="\/media\/ardore-brand-motion-concept-poster\.webp"/)
  assert.match(html, /<form[^>]*action="\/media\/ardore-brand-motion-concept\.mp4"/)
  assert.match(html, /<button[^>]*aria-label="Produktdemo abspielen"/)
  assert.doesNotMatch(html, /<(?:video|source|track)\b/)
  assert.match(html, /<\/form><\/div><figcaption[^>]*>Fiktive Beispieldaten\. Ohne Ton\.<\/figcaption>/)
  assert.match(html, /Video nachlesen/)
})
