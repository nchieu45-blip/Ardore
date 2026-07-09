import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id, is_verified')
    .eq('user_id', user.id)
    .single()
  if (!creator) return NextResponse.json({ error: 'Not a creator' }, { status: 403 })
  if (creator.is_verified) return NextResponse.json({ error: 'Already verified' }, { status: 400 })

  // Check no pending request exists
  const { data: existing } = await supabase
    .from('verification_requests')
    .select('id, status')
    .eq('creator_id', creator.id)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) return NextResponse.json({ error: 'Pending request already exists' }, { status: 400 })

  const formData = await req.formData()
  const file = formData.get('document')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  // Server-side MIME validation
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Invalid file type. Allowed: PDF, JPG, PNG, WEBP' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large. Max 10 MB.' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin'
  const storagePath = `${creator.id}/${Date.now()}_cert.${ext}`

  const service = await createServiceClient()

  const arrayBuffer = await file.arrayBuffer()
  const { error: uploadErr } = await service.storage
    .from('verification-docs')
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      upsert: false,
    })
  if (uploadErr) {
    return NextResponse.json({ error: 'Upload failed: ' + uploadErr.message }, { status: 500 })
  }

  const { error: insertErr } = await service
    .from('verification_requests')
    .insert({
      creator_id:        creator.id,
      document_path:     storagePath,
      original_filename: file.name,
      status:            'pending',
    })

  if (insertErr) {
    // Clean up the uploaded file on DB failure
    await service.storage.from('verification-docs').remove([storagePath])
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
