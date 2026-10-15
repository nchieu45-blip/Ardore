import { createServiceClient } from '@/lib/supabase/server'
import { isCronAuthorized, cronJson } from '@/lib/cron'

// Existing retention policy unchanged: approved delete_after / rejected after 30 days.
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) return cronJson({ error: 'Unauthorized' }, 401)
  let deleted = 0
  let failed = 0
  try {
    const service = await createServiceClient()
    const now = new Date()
    for (const status of ['approved', 'rejected']) {
      // Keyset pagination: removing document_path changes the candidate set.
      let after: string | null = null
      for (;;) {
        let query = service.from('verification_requests').select('id,document_path')
          .eq('status', status).not('document_path', 'is', null).order('id').limit(100)
        query = status === 'approved'
          ? query.lte('delete_after', now.toISOString())
          : query.lte('reviewed_at', new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString())
        if (after) query = query.gt('id', after)
        const { data, error } = await query
        if (error || !data) throw new Error('cleanup_read_failed')
        for (const row of data as { id: string; document_path: string }[]) {
          try {
            const removed = await service.storage.from('verification-docs').remove([row.document_path])
            if (removed.error) throw new Error('cleanup_storage_failed')
            const updated = await service.from('verification_requests').update({ document_path: null })
              .eq('id', row.id).eq('status', status).eq('document_path', row.document_path).select('id')
            if (updated.error || updated.data?.length !== 1) throw new Error('cleanup_update_failed')
            deleted++
          } catch { failed++ }
        }
        if (data.length < 100) break
        after = data[data.length - 1].id
      }
    }
    return cronJson({ deleted, failed }, failed > 0 ? 503 : 200)
  } catch {
    return cronJson({ error: 'Verification cleanup could not be completed', deleted, failed: failed + 1 }, 503)
  }
}
