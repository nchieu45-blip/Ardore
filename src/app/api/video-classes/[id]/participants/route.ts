import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: classId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: vc } = await supabase
    .from('video_classes')
    .select('max_participants')
    .eq('id', classId)
    .maybeSingle()

  if (!vc) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 })

  const [countRes, userRes] = await Promise.all([
    supabase
      .from('video_class_bookings')
      .select('*', { count: 'exact', head: true })
      .eq('video_class_id', classId)
      .eq('status', 'confirmed'),
    user
      ? supabase
          .from('video_class_bookings')
          .select('id')
          .eq('video_class_id', classId)
          .eq('user_id', user.id)
          .eq('status', 'confirmed')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const count = countRes.count ?? 0
  const maxParticipants = vc.max_participants

  return NextResponse.json({
    count,
    max_participants: maxParticipants,
    is_full: maxParticipants !== null && count >= maxParticipants,
    user_is_registered: !!userRes.data,
  })
}
