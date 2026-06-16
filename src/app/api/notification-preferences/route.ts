import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ALLOWED_KEYS = [
  'email_new_booking',
  'email_session_reminder',
  'email_new_message',
  'email_new_video_class_booking',
  'inapp_new_booking',
  'inapp_session_reminder',
  'inapp_new_message',
  'inapp_new_video_class_booking',
] as const

const DEFAULT_PREFS = Object.fromEntries(ALLOWED_KEYS.map(k => [k, true])) as Record<typeof ALLOWED_KEYS[number], boolean>

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('notification_preferences')
    .select(ALLOWED_KEYS.join(', '))
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ prefs: data ?? DEFAULT_PREFS })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as Record<string, unknown>
  const patch: Record<string, boolean> = {}
  for (const key of ALLOWED_KEYS) {
    if (typeof body[key] === 'boolean') patch[key] = body[key] as boolean
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
