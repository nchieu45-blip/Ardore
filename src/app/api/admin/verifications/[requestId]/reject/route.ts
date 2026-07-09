import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  req: Request,
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
  const body = await req.json() as { reason?: string }
  const reason = (body.reason ?? '').trim()
  if (!reason) return NextResponse.json({ error: 'Rejection reason is required' }, { status: 400 })

  const service = await createServiceClient()

  const { data: vreq } = await service
    .from('verification_requests')
    .select('id, status')
    .eq('id', requestId)
    .single()
  if (!vreq) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (vreq.status !== 'pending') return NextResponse.json({ error: 'Request is not pending' }, { status: 400 })

  const { error } = await service
    .from('verification_requests')
    .update({
      status:           'rejected',
      rejection_reason: reason,
      reviewed_at:      new Date().toISOString(),
    })
    .eq('id', requestId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
