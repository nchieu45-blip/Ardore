'use client'

import { useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'

export interface HomeTestimonial {
  quote: string
  attribution: string
}

export default function HomeTestimonials({ entries }: { entries: readonly HomeTestimonial[] }) {
  const [index, setIndex] = useState(0)
  if (entries.length === 0) return null

  const activeIndex = index % entries.length
  const { quote, attribution } = entries[activeIndex]

  function move(direction: -1 | 1) {
    setIndex(current => (current % entries.length + direction + entries.length) % entries.length)
  }

  return (
    <section aria-labelledby="home-testimonials-title" aria-roledescription="Karussell" className="home-dark-band bg-inverse">
      <div className="ardore-container home-band-space">
        <h2 id="home-testimonials-title" className="section-title">Stimmen zu Ardore</h2>
        <figure className="mt-6 max-w-3xl" aria-live="polite" aria-atomic="true">
          {entries.length > 1 && <span className="sr-only">Stimme {activeIndex + 1} von {entries.length}</span>}
          <blockquote className="text-xl leading-relaxed sm:text-2xl">„{quote}“</blockquote>
          <figcaption className="mt-3 text-sm text-muted-inverse">{attribution}</figcaption>
        </figure>
        {entries.length > 1 && (
          <div className="mt-6 flex items-center gap-3">
            <IconButton label="Vorherige Stimme" variant="outline" onClick={() => move(-1)}>
              <ArrowLeft className="size-4" aria-hidden="true" />
            </IconButton>
            <span className="text-sm tabular-nums text-muted-inverse" aria-hidden="true">{activeIndex + 1} / {entries.length}</span>
            <IconButton label="Nächste Stimme" variant="outline" onClick={() => move(1)}>
              <ArrowRight className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        )}
      </div>
    </section>
  )
}
