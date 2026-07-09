import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ShieldCheck } from 'lucide-react'
import AdminVerificationList from './AdminVerificationList'

export const dynamic = 'force-dynamic'

export default async function AdminVerificationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) notFound()

  const service = await createServiceClient()

  type RawRow = {
    id: string
    original_filename: string
    created_at: string
    creator_profiles: { display_name: string; slug: string } | { display_name: string; slug: string }[] | null
  }

  const { data } = await service
    .from('verification_requests')
    .select('id, original_filename, created_at, creator_profiles(display_name, slug)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const rows = ((data ?? []) as RawRow[]).map(r => {
    const cp = Array.isArray(r.creator_profiles) ? r.creator_profiles[0] : r.creator_profiles
    return {
      id:                r.id,
      original_filename: r.original_filename,
      created_at:        r.created_at,
      creator: {
        display_name: cp?.display_name ?? '(Unbekannt)',
        slug:         cp?.slug ?? '',
      },
    }
  })

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-green-50 flex items-center justify-center">
          <ShieldCheck className="h-5 w-5 text-green-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Verifizierungsanträge</h1>
          <p className="text-sm text-gray-400">
            {rows.length} offen{rows.length !== 1 ? 'e Anträge' : 'r Antrag'}
          </p>
        </div>
      </div>

      <AdminVerificationList initial={rows} />
    </div>
  )
}
