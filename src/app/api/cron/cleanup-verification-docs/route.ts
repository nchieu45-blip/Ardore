import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Runs daily. Deletes verification documents per GDPR data minimization:
// - Approved requests: 90 days after approval (delete_after has passed)
// - Rejected requests: 30 days after rejection
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = await createServiceClient()
  const now = new Date().toISOString()
  let deleted = 0

  // ── Approved docs past their delete_after date ─────────────────────────
  const { data: approved } = await service
    .from('verification_requests')
    .select('id, document_path')
    .eq('status', 'approved')
    .not('document_path', 'is', null)
    .lte('delete_after', now)

  for (const row of (approved ?? []) as { id: string; document_path: string }[]) {
    const { error: delErr } = await service.storage
      .from('verification-docs')
      .remove([row.document_path])
    if (!delErr) {
      await service
        .from('verification_requests')
        .update({ document_path: null })
        .eq('id', row.id)
      deleted++
    }
  }

  // ── Rejected docs older than 30 days ──────────────────────────────────
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()
  const { data: rejected } = await service
    .from('verification_requests')
    .select('id, document_path')
    .eq('status', 'rejected')
    .not('document_path', 'is', null)
    .lte('reviewed_at', cutoff30)

  for (const row of (rejected ?? []) as { id: string; document_path: string }[]) {
    const { error: delErr } = await service.storage
      .from('verification-docs')
      .remove([row.document_path])
    if (!delErr) {
      await service
        .from('verification_requests')
        .update({ document_path: null })
        .eq('id', row.id)
      deleted++
    }
  }

  return NextResponse.json({ deleted })
}
