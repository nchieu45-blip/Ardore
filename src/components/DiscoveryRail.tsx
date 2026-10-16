'use client'

import { Children, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { ButtonLink, IconButton } from '@/components/ui/Button'

interface DiscoveryRailProps {
  id: string
  title: string
  description: string
  href: string
  linkLabel: string
  children: ReactNode
  empty?: ReactNode
}

export default function DiscoveryRail({ id, title, description, href, linkLabel, children, empty }: DiscoveryRailProps) {
  const track = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ previous: false, next: false })
  const itemCount = Children.count(children)
  const updateEdges = useCallback(() => {
    const el = track.current
    if (!el) return
    const previous = el.scrollLeft > 2
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    // Store only boundary changes, never continuously changing scroll positions.
    setEdges(old => old.previous === previous && old.next === next ? old : { previous, next })
  }, [])

  useEffect(() => {
    const el = track.current
    if (!el) return
    updateEdges()
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [itemCount, updateEdges])

  function advance(direction: -1 | 1, pointer = false) {
    const el = track.current
    const first = el?.firstElementChild
    if (!el || !first) return
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0
    const itemWidth = first.getBoundingClientRect().width + gap
    const pageSize = Math.max(1, Math.floor(el.clientWidth / itemWidth)) * itemWidth
    const smooth = pointer && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * pageSize, behavior: smooth ? 'smooth' : 'auto' })
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      advance(event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      track.current?.scrollTo({ left: event.key === 'Home' ? 0 : track.current.scrollWidth, behavior: 'auto' })
    }
  }

  return (
    <section className="discovery-rail" aria-labelledby={`${id}-title`}>
      <div className="discovery-rail-header">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="section-title">{title}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">{description}</p>
        </div>
        <div className="discovery-rail-actions">
          <ButtonLink href={href} variant="tertiary" className="px-0 sm:px-3">
            {linkLabel}<ArrowRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          {itemCount > 0 && (
            <div className="flex gap-2">
              <IconButton label={`${title}: Nach links blättern`} variant="secondary" aria-disabled={!edges.previous} aria-controls={`${id}-items`} onClick={event => { if (edges.previous) advance(-1, event.detail > 0) }}>
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </IconButton>
              <IconButton label={`${title}: Nach rechts blättern`} variant="secondary" aria-disabled={!edges.next} aria-controls={`${id}-items`} onClick={event => { if (edges.next) advance(1, event.detail > 0) }}>
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
      {itemCount > 0 ? (
        <>
          <p id={`${id}-hint`} className="sr-only">Seitlich wischen oder die Pfeiltasten nutzen. Mit Pos1 und Ende zum Anfang oder Ende springen.</p>
          <ul ref={track} id={`${id}-items`} role="list" tabIndex={0} aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`} className="discovery-rail-track" onScroll={updateEdges} onKeyDown={onKeyDown}>
            {Children.map(children, child => <li className="discovery-rail-item">{child}</li>)}
          </ul>
        </>
      ) : empty}
    </section>
  )
}
