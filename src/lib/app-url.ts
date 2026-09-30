const PRODUCTION_ORIGIN = 'https://www.ardore-health.com'

// Reverse proxies may expose an internal request origin (e.g. 0.0.0.0:3000).
export function appOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (!configured) return PRODUCTION_ORIGIN
  try {
    const url = new URL(configured)
    if (url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:')) return url.origin
  } catch { /* Fall back to the known public origin. */ }
  return PRODUCTION_ORIGIN
}

export function safeAuthDestination(next: string | null) {
  const origin = appOrigin()
  const fallback = new URL('/reset-password', origin)
  if (!next?.startsWith('/') || next.startsWith('//') || /[\\\u0000-\u001f]/.test(next)) return fallback
  const destination = new URL(next, origin)
  return destination.origin === origin ? destination : fallback
}
