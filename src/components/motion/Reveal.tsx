'use client'

import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
  stagger?: boolean
}

export default function Reveal({ children, className = '', stagger = false }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('vis')
          observer.unobserve(el)
        }
      },
      { threshold: 0.18 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cls = ['reveal', stagger ? 'stagger' : '', className].filter(Boolean).join(' ')

  return (
    <div ref={ref} className={cls}>
      {children}
    </div>
  )
}
