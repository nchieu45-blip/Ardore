import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isValidCoachingDuration, validateCoachingSlot } from '@/lib/coaching-booking'
import { provisionConfirmedCoachingBooking } from '@/lib/coaching-confirmation'
import { calculateArdorePlatformFee } from '@/lib/stripe/platformFee'
import { stripe } from '@/lib/stripe/server'

// Stripe requires expires_at to be at least 30 minutes in the future. The
// extra minute avoids clock/network skew while keeping the hold short.
const RESERVATION_MINUTES = 31

function appUrl() {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ardore-health.com'
  return `${raw.startsWith('http') ? raw : `https://${raw}`}`.replace(/\/$/, '')
}

export async function POST(req: NextRequest) {
  const { creatorId, date, time, name, email, notes, subscriptionId, discountId } = await req.json()
  if (!creatorId || !date || !time || !name || !email) return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })
  if (email.trim().toLowerCase() !== user.email.toLowerCase()) {
    return NextResponse.json({ error: 'Die E-Mail-Adresse stimmt nicht mit deinem Konto überein.' }, { status: 400 })
  }

  let isSubscriptionSession = false
  let resolvedSubscriptionId: string | null = null
  let tierDurationMinutes: number | null = null
  if (subscriptionId) {
    const { data: sub } = await supabase.from('subscriptions')
      .select('id, buyer_id, creator_id, status, subscription_tiers(included_video_sessions, video_session_period, included_session_duration_minutes)')
      .eq('id', subscriptionId).single()
    if (sub && sub.buyer_id === user.id && sub.creator_id === creatorId && sub.status === 'active') {
      const tier = Array.isArray(sub.subscription_tiers) ? sub.subscription_tiers[0] : sub.subscription_tiers
      const total = (tier as { included_video_sessions: number } | null)?.included_video_sessions ?? 0
      const period = (tier as { video_session_period: string | null } | null)?.video_session_period ?? 'month'
      const now = new Date()
      const periodStart = period === 'week'
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
        : new Date(now.getFullYear(), now.getMonth(), 1)
      periodStart.setHours(0, 0, 0, 0)
      const { count } = await supabase.from('bookings').select('*', { count: 'exact', head: true })
        .eq('subscription_id', subscriptionId).in('status', ['confirmed', 'completed']).gte('created_at', periodStart.toISOString())
      if (total > 0 && (count ?? 0) < total) {
        isSubscriptionSession = true
        resolvedSubscriptionId = subscriptionId
        tierDurationMinutes = (tier as { included_session_duration_minutes: number | null } | null)?.included_session_duration_minutes ?? null
      }
    }
  }

  const { data: offer } = await supabase.from('coaching_offers')
    .select('is_enabled, price_cents, duration_minutes').eq('creator_id', creatorId).single()
  if (!offer?.is_enabled) return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })
  const effectiveDuration = isSubscriptionSession && tierDurationMinutes !== null ? tierDurationMinutes : offer.duration_minutes
  if (!isValidCoachingDuration(effectiveDuration)) return NextResponse.json({ error: 'Ungültige Sitzungsdauer' }, { status: 400 })

  let discountedPriceCents = offer.price_cents
  let discountRowId: string | null = null
  if (!isSubscriptionSession && discountId) {
    const { data: disc } = await supabase.from('discounts')
      .select('id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to')
      .eq('id', discountId).single()
    const now = new Date()
    const valid = disc && disc.active && (disc.applies_to === 'all' || disc.applies_to === 'sessions')
      && (!disc.starts_at || new Date(disc.starts_at) <= now) && (!disc.ends_at || new Date(disc.ends_at) >= now)
      && (disc.max_redemptions === null || disc.redemption_count < disc.max_redemptions)
    if (valid) {
      discountRowId = disc.id
      const savings = disc.type === 'percent' ? Math.round(offer.price_cents * disc.value / 100) : Math.min(disc.value, offer.price_cents)
      discountedPriceCents = Math.max(0, offer.price_cents - savings)
    }
  }
  if (!isSubscriptionSession && discountedPriceCents > 0 && discountedPriceCents < 50) {
    return NextResponse.json({ error: 'Der Buchungsbetrag liegt unter dem Stripe-Mindestbetrag.' }, { status: 400 })
  }

  const slotValidation = await validateCoachingSlot({ creatorId, date, time, durationMinutes: effectiveDuration })
  if (!slotValidation.ok) return NextResponse.json({ error: slotValidation.error }, { status: slotValidation.status })

  const service = await createServiceClient()
  const requiresPayment = !isSubscriptionSession && discountedPriceCents > 0
  const stripeLivemode = requiresPayment
    ? process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_') === true
    : null
  let paymentCreator: {
    display_name: string
    stripe_account_id: string | null
    stripe_account_active: boolean | null
  } | null = null

  if (requiresPayment) {
    const { data: creator, error: creatorError } = await service.from('creator_profiles')
      .select('display_name, stripe_account_id, stripe_account_active')
      .eq('id', creatorId)
      .single()
    if (creatorError || !creator) {
      return NextResponse.json({ error: 'Coach nicht gefunden.' }, { status: 404 })
    }

    paymentCreator = creator

    // Live customer funds must always use a fully enabled Connect account.
    // Test-mode lifecycle checks stay on the platform test balance and cannot
    // accidentally route funds to a live connected account stored here.
    if (stripeLivemode && (!creator.stripe_account_id || !creator.stripe_account_active)) {
      return NextResponse.json({ error: 'Dieser Coach kann derzeit keine Zahlungen empfangen.' }, { status: 409 })
    }
  }

  const reservationExpiresAt = requiresPayment ? new Date(Date.now() + RESERVATION_MINUTES * 60_000) : null
  const { data: booking, error } = await service.from('bookings').insert({
    creator_id: creatorId, buyer_id: user.id, scheduled_at: slotValidation.scheduledAt,
    duration_minutes: effectiveDuration, status: requiresPayment ? 'pending_payment' : 'confirmed',
    payment_status: requiresPayment ? 'pending' : 'not_required', buyer_email: user.email,
    buyer_name: name.trim(), notes: notes?.trim() || null, subscription_id: resolvedSubscriptionId,
    is_subscription_session: isSubscriptionSession, price_cents: isSubscriptionSession ? 0 : discountedPriceCents,
    buffer_minutes: slotValidation.bufferMinutes, reservation_expires_at: reservationExpiresAt?.toISOString() ?? null,
    discount_id: discountRowId,
    stripe_livemode: stripeLivemode,
  }).select('id').single()
  if (error?.code === '23P01') return NextResponse.json({ error: 'Dieser Zeitslot wurde gerade vergeben.' }, { status: 409 })
  if (error || !booking) return NextResponse.json({ error: 'Buchung konnte nicht erstellt werden.' }, { status: 500 })

  if (!requiresPayment) {
    await provisionConfirmedCoachingBooking(booking.id)
    return NextResponse.json({ bookingId: booking.id })
  }

  try {
    if (!paymentCreator) throw new Error('Coach not found')
    const metadata = { checkout_type: 'coaching_session', booking_id: booking.id, buyer_id: user.id, creator_id: creatorId, scheduled_at: slotValidation.scheduledAt }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment', customer_email: user.email,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: discountedPriceCents,
        product_data: { name: `1:1 Coaching mit ${paymentCreator.display_name}`, metadata: { booking_id: booking.id } } } }],
      metadata,
      payment_intent_data: { metadata,
        ...(stripeLivemode && paymentCreator.stripe_account_id && paymentCreator.stripe_account_active
          ? { application_fee_amount: calculateArdorePlatformFee(discountedPriceCents), transfer_data: { destination: paymentCreator.stripe_account_id } } : {}) },
      expires_at: Math.floor(reservationExpiresAt!.getTime() / 1000),
      success_url: `${appUrl()}/buyer/sessions?checkout=success&booking=${booking.id}`,
      cancel_url: `${appUrl()}/buyer/sessions?checkout=cancelled&booking=${booking.id}`,
    })
    const { error: updateError } = await service.from('bookings').update({ stripe_checkout_session_id: session.id })
      .eq('id', booking.id).eq('status', 'pending_payment')
    if (updateError) throw updateError
    return NextResponse.json({ bookingId: booking.id, checkoutUrl: session.url })
  } catch (checkoutError) {
    await service.from('bookings').update({ status: 'payment_failed', payment_status: 'failed', payment_updated_at: new Date().toISOString() })
      .eq('id', booking.id).eq('status', 'pending_payment')
    console.error('[coaching-checkout] creation failed', checkoutError)
    return NextResponse.json({ error: 'Die Zahlung konnte nicht gestartet werden.' }, { status: 500 })
  }
}
