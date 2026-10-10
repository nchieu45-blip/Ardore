'use client'

import { ButtonLink } from '@/components/ui/Button'
import { Video } from 'lucide-react'

export default function ScrollToBookingLink() {
  return (
    <ButtonLink
      href="#booking"
      variant="secondary"
      size="sm"
      className="w-full gap-1.5"
      onClick={event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const widget = document.querySelector<HTMLElement>('[data-booking-widget]')
        if (!widget) return
        event.preventDefault()
        const instant = event.detail === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches
        widget.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', block: 'start' })
      }}
    >
      <Video className="h-3.5 w-3.5" aria-hidden="true" />
      Session buchen
    </ButtonLink>
  )
}
