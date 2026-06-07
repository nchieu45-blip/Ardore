export const CONSENT_KEY = 'ardore_cookie_consent'
export const REOPEN_EVENT = 'ardore:cookies:reopen'
export const UPDATE_EVENT = 'ardore:consent:update'

export interface CookieConsent {
  necessary: true
  statistics: boolean
  marketing: boolean
  savedAt: number
}

export function readConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CONSENT_KEY)
    return raw ? (JSON.parse(raw) as CookieConsent) : null
  } catch {
    return null
  }
}

export function saveConsent(statistics: boolean, marketing: boolean): CookieConsent {
  const consent: CookieConsent = {
    necessary: true,
    statistics,
    marketing,
    savedAt: Date.now(),
  }
  localStorage.setItem(CONSENT_KEY, JSON.stringify(consent))
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: consent }))
  return consent
}
