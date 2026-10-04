import { hasValidCoachingPayment } from '@/lib/coaching-payment'

// Links are navigated to, never fetched by the Ardore server.
export function normalizeMeetingUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim()
  if (input.length > 2048 || /[\s\u0000-\u001f\u007f\\]/.test(input)) return null
  try {
    const url = new URL(input)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null
    const host = url.hostname
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i.test(host)) return null
    if (/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host)) return null
    const result = url.href
    return result.length <= 2048 ? result : null
  } catch { return null }
}

export function canAccessSessionMeeting(booking: {
  status: string; payment_status: string; stripe_livemode: boolean | null
  scheduled_at: string; duration_minutes: number
}, now: number): boolean {
  const end = new Date(booking.scheduled_at).getTime() + booking.duration_minutes * 60_000
  return booking.status === 'confirmed' && hasValidCoachingPayment(booking)
    && Number.isFinite(end) && end > now
}
