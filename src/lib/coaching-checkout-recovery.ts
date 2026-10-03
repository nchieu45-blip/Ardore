import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { stripe } from '@/lib/stripe/server'

/** Discover a lost Checkout response without creating another payable session. */
export async function recoverCreatingCoachingCheckout({
  service, attemptId, bookingId, provider = stripe,
}: { service: SupabaseClient; attemptId: string; bookingId?: string; provider?: Stripe }) {
  const { data: attempt, error } = await service.from('coaching_payment_attempts').select('*').eq('id', attemptId).single()
  if (error || !attempt || (bookingId && attempt.booking_id !== bookingId)) throw new Error('Recovery attempt not found')
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true
  if (attempt.stripe_livemode !== mode) throw new Error('Recovery payment mode mismatch')
  if (attempt.stripe_checkout_session_id) return { sessionId: attempt.stripe_checkout_session_id as string, unresolved: false, noSessionProven: false as const }
  if (attempt.provider_state !== 'creating') return { sessionId: null, unresolved: true, noSessionProven: false as const }
  const matches: Stripe.Checkout.Session[] = []
  let examined = 0
  let truncated = false
  const createdAt = new Date(attempt.created_at).getTime()
  if (!Number.isFinite(createdAt)) throw new Error('Recovery attempt timestamp missing')
  for await (const session of provider.checkout.sessions.list({ limit: 100, created: { gte: Math.floor(createdAt / 1000) - 60 } })) {
    examined++
    const metadata = session.metadata ?? {}
    if (metadata.payment_attempt_id === attempt.id && metadata.booking_id === attempt.booking_id) {
      if (session.mode !== 'payment' || session.livemode !== mode || session.currency !== 'eur'
        || session.amount_total !== attempt.price_cents || metadata.buyer_id !== attempt.buyer_id
        || metadata.creator_id !== attempt.creator_id || metadata.checkout_type !== 'coaching_session') {
        throw new Error('Recovery checkout ownership mismatch')
      }
      matches.push(session)
    }
    if (examined >= 1000) { truncated = true; break }
  }
  if (matches.length !== 1 || truncated) return { sessionId: null, unresolved: true, noSessionProven: false as const }
  const session = matches[0]
  const { data, error: registrationError } = await service.rpc('register_coaching_checkout', {
    p_attempt_id: attempt.id, p_session_id: session.id, p_session_url: session.url,
  })
  if (registrationError || !data?.registered || data?.error) throw new Error('Recovery checkout could not be registered')
  return { sessionId: session.id, unresolved: false, noSessionProven: false as const }
}
