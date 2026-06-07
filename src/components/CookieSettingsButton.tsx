'use client'

import { REOPEN_EVENT } from '@/lib/cookie-consent'

export function CookieSettingsButton() {
  function open() {
    window.dispatchEvent(new Event(REOPEN_EVENT))
  }
  return (
    <button onClick={open} className="hover:text-white transition-colors">
      Cookie-Einstellungen
    </button>
  )
}
