import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { requestId } = await params
  const service = await createServiceClient()

  const { data: vreq } = await service
    .from('verification_requests')
    .select('id, creator_id, status')
    .eq('id', requestId)
    .single()
  if (!vreq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (vreq.status !== 'pending') return NextResponse.json({ error: 'Request is not pending' }, { status: 400 })

  const now = new Date()
  const deleteAfter = new Date(now.getTime() + 90 * 24 * 60 * 60_000)

  const { error: reqErr } = await service
    .from('verification_requests')
    .update({
      status:       'approved',
      reviewed_at:  now.toISOString(),
      delete_after: deleteAfter.toISOString(),
    })
    .eq('id', requestId)
  if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 })

  const { error: profileErr } = await service
    .from('creator_profiles')
    .update({ is_verified: true, verified_at: now.toISOString() })
    .eq('id', vreq.creator_id)
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
