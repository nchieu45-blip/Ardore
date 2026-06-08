import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const { bookingId, rating, content } = await req.json()

  if (!bookingId || typeof rating !== 'number' || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'Ungültige Daten' }, { status: 400 })
  }

  const { data: booking } = await supabase
    .from('bookings')
    .select('buyer_id, creator_id, creator_profiles!inner(user_id, display_name)')
    .eq('id', bookingId)
    .single()

  if (!booking || booking.buyer_id !== user.id) {
    return NextResponse.json({ error: 'Buchung nicht gefunden' }, { status: 404 })
  }

  // RLS enforces that the session must have ended before allowing insert
  const { error } = await supabase
    .from('session_reviews')
    .upsert(
      {
        booking_id: bookingId,
        buyer_id: user.id,
        creator_id: booking.creator_id,
        rating,
        content: (content as string | undefined)?.trim() || null,
      },
      { onConflict: 'booking_id,buyer_id' },
    )

  if (error) {
    console.error('[session-reviews POST]', error)
    return NextResponse.json({ error: 'Fehler beim Speichern' }, { status: 500 })
  }

  ;(async () => {
    try {
      const cp = Array.isArray(booking.creator_profiles)
        ? booking.creator_profiles[0]
        : booking.creator_profiles
      if (cp?.user_id) {
        await createNotification({
          userId: cp.user_id,
          type: 'new_review',
          title: 'Neue Session-Bewertung',
          message: `Deine Session wurde mit ${rating} Stern${rating !== 1 ? 'en' : ''} bewertet.`,
          link: `/creator`,
        })
      }
    } catch {}
  })()

  return NextResponse.json({ ok: true })
}
