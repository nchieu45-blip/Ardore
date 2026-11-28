'use client'

import { useEffect, useRef, type ReactNode } from 'react'

export default function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      element.getBoundingClientRect().top < window.innerHeight) return

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      element.dataset.revealVisible = ''
      observer.disconnect()
    }, { threshold: 0.12 })

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <div ref={ref} className={`reveal-on-scroll ${className}`}>{children}</div>
}
