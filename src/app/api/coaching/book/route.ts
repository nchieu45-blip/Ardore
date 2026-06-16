import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { creatorId, date, time, name, email, notes, subscriptionId, discountId } = body

  if (!creatorId || !date || !time || !name || !email) {
    return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Validate subscription-based booking: verify allowance
  let isSubscriptionSession = false
  let resolvedSubscriptionId: string | null = null
  let tierDurationMinutes: number | null = null

  if (subscriptionId && user) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, buyer_id, status, subscription_tiers(included_video_sessions, video_session_period, included_session_duration_minutes)')
      .eq('id', subscriptionId)
      .single()

    if (sub && sub.buyer_id === user.id && sub.status === 'active') {
      const tier = Array.isArray(sub.subscription_tiers) ? sub.subscription_tiers[0] : sub.subscription_tiers
      const total: number  = (tier as { included_video_sessions: number } | null)?.included_video_sessions ?? 0
      const period: string = (tier as { video_session_period: string | null } | null)?.video_session_period ?? 'month'

      if (total > 0) {
        const now = new Date()
        let periodStart: Date
        if (period === 'week') {
          const daysToMon = (now.getDay() + 6) % 7
          periodStart = new Date(now)
          periodStart.setDate(now.getDate() - daysToMon)
          periodStart.setHours(0, 0, 0, 0)
        } else {
          periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
        }
        const { count } = await supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('subscription_id', subscriptionId)
          .neq('status', 'cancelled')
          .gte('created_at', periodStart.toISOString())
        const used = count ?? 0
        if (used < total) {
          isSubscriptionSession = true
          resolvedSubscriptionId = subscriptionId
          tierDurationMinutes = (tier as { included_session_duration_minutes: number | null } | null)?.included_session_duration_minutes ?? null
        }
      }
    }
  }

  const { data: offer } = await supabase
    .from('coaching_offers')
    .select('is_enabled, price_cents, duration_minutes')
    .eq('creator_id', creatorId)
    .single()

  if (!offer?.is_enabled) {
    return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })
  }

  // Subscription sessions use the tier's configured duration when set; paid sessions always use the offer duration
  const effectiveDuration = isSubscriptionSession && tierDurationMinutes !== null
    ? tierDurationMinutes
    : offer.duration_minutes

  // Validate discount for paid sessions
  // TODO: When payment is added for sessions, apply the discount via Stripe Coupon instead of reducing price_cents directly
  let discountedPriceCents = offer.price_cents
  let discountRowId: string | null = null

  if (!isSubscriptionSession && discountId) {
    const { data: disc } = await supabase
      .from('discounts')
      .select('id, type, value, active, starts_at, ends_at, max_redemptions, redemption_count, applies_to')
      .eq('id', discountId)
      .single()

    const now = new Date()
    const valid = disc &&
      disc.active &&
      (disc.applies_to === 'all' || disc.applies_to === 'sessions') &&
      (!disc.starts_at || new Date(disc.starts_at) <= now) &&
      (!disc.ends_at   || new Date(disc.ends_at)   >= now) &&
      (disc.max_redemptions === null || disc.redemption_count < disc.max_redemptions)

    if (valid) {
      discountRowId = disc.id
      const savings = disc.type === 'percent'
        ? Math.round(offer.price_cents * disc.value / 100)
        : Math.min(disc.value, offer.price_cents)
      discountedPriceCents = Math.max(0, offer.price_cents - savings)
    }
  }

  const scheduledAt = new Date(`${date}T${time}:00`)
  if (isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: 'Ungültiges Datum oder Uhrzeit' }, { status: 400 })
  }

  // Create Daily.co room
  let dailyRoomName: string | null = null
  let dailyRoomUrl:  string | null = null

  if (process.env.DAILY_API_KEY) {
    try {
      // Room expires 30 min after session ends
      const roomExp = Math.floor(scheduledAt.getTime() / 1000) + (effectiveDuration + 30) * 60
      const res = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          privacy: 'private',
          properties: {
            exp: roomExp,
            max_participants: 2,
            enable_chat: true,
            enable_screenshare: false,
          },
        }),
      })
      if (res.ok) {
        const room = await res.json() as { name: string; url: string }
        dailyRoomName = room.name
        dailyRoomUrl  = room.url
      }
    } catch {
      // Room creation failure is non-fatal; admin can fix manually
    }
  }

  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      creator_id:       creatorId,
      buyer_id:         user?.id ?? null,
      scheduled_at:     scheduledAt.toISOString(),
      duration_minutes: effectiveDuration,
      status:                  'confirmed',
      daily_room_name:         dailyRoomName,
      daily_room_url:          dailyRoomUrl,
      buyer_email:             email,
      buyer_name:              name,
      notes:                   notes?.trim() || null,
      subscription_id:         resolvedSubscriptionId,
      is_subscription_session: isSubscriptionSession,
      price_cents:             isSubscriptionSession ? 0 : discountedPriceCents,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Increment redemption count (best-effort)
  if (discountRowId) {
    const { data: latest } = await supabase
      .from('discounts')
      .select('redemption_count')
      .eq('id', discountRowId)
      .single()
    if (latest) {
      await supabase
        .from('discounts')
        .update({ redemption_count: latest.redemption_count + 1 })
        .eq('id', discountRowId)
        .eq('redemption_count', latest.redemption_count)
    }
  }

  // Send confirmation emails (best-effort)
  try {
    const { data: creator } = await supabase
      .from('creator_profiles')
      .select('display_name, user_id')
      .eq('id', creatorId)
      .single()

    if (creator) {
      const { data: creatorUser } = await supabase.auth.admin.getUserById(creator.user_id)
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://ardore.health').replace(/\/$/, '')
      const sessionUrl = `${appUrl}/session/${booking.id}`

      const { sendBookingConfirmation } = await import('@/lib/email/send')
      const scheduledDate = scheduledAt.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      const scheduledTime = scheduledAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })

      // In-app notifications (fire-and-forget)
      createNotification({
        userId: creator.user_id,
        type: 'new_booking',
        title: 'Neue Session gebucht',
        message: `${name} hat eine ${effectiveDuration}-Min.-Session am ${scheduledDate} um ${scheduledTime} Uhr gebucht.`,
        link: '/creator/sessions',
      }).catch(() => {})
      if (user?.id) {
        createNotification({
          userId: user.id,
          type: 'booking_confirmed',
          title: 'Session bestätigt',
          message: `Deine Session mit ${creator.display_name} am ${scheduledDate} um ${scheduledTime} Uhr ist bestätigt.`,
          link: `/session/${booking.id}`,
        }).catch(() => {})
      }

      await Promise.allSettled([
        sendBookingConfirmation(email, {
          recipientName: name,
          coachName: creator.display_name,
          scheduledDate,
          scheduledTime,
          durationMinutes: effectiveDuration,
          sessionUrl,
          role: 'buyer',
        }),
        creatorUser?.user?.email
          ? sendBookingConfirmation(creatorUser.user.email, {
              recipientName: creator.display_name,
              coachName: name,
              scheduledDate,
              scheduledTime,
              durationMinutes: effectiveDuration,
              sessionUrl,
              role: 'creator',
            })
          : Promise.resolve(),
      ])
    }
  } catch {
    // Email errors never fail the booking
  }

  return NextResponse.json({ bookingId: booking.id })
}
