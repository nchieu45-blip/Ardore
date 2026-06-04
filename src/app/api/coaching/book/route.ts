import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { creatorId, date, time, name, email, notes } = body

  if (!creatorId || !date || !time || !name || !email) {
    return NextResponse.json({ error: 'Fehlende Pflichtfelder' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: offer } = await supabase
    .from('coaching_offers')
    .select('is_enabled, price_cents, duration_minutes')
    .eq('creator_id', creatorId)
    .single()

  if (!offer?.is_enabled) {
    return NextResponse.json({ error: 'Videocoaching nicht verfügbar' }, { status: 400 })
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
      const roomExp = Math.floor(scheduledAt.getTime() / 1000) + (offer.duration_minutes + 30) * 60
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
      duration_minutes: offer.duration_minutes,
      price_cents:      offer.price_cents,
      status:           'confirmed',
      daily_room_name:  dailyRoomName,
      daily_room_url:   dailyRoomUrl,
      buyer_email:      email,
      buyer_name:       name,
      notes:            notes?.trim() || null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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

      await Promise.allSettled([
        sendBookingConfirmation(email, {
          recipientName: name,
          coachName: creator.display_name,
          scheduledDate,
          scheduledTime,
          durationMinutes: offer.duration_minutes,
          sessionUrl,
          role: 'buyer',
        }),
        creatorUser?.user?.email
          ? sendBookingConfirmation(creatorUser.user.email, {
              recipientName: creator.display_name,
              coachName: name,
              scheduledDate,
              scheduledTime,
              durationMinutes: offer.duration_minutes,
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
