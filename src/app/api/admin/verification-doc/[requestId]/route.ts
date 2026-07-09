import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
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
    .select('document_path')
    .eq('id', requestId)
    .single()
  if (!vreq?.document_path) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: signed, error } = await service.storage
    .from('verification-docs')
    .createSignedUrl(vreq.document_path, 60)

  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate signed URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
