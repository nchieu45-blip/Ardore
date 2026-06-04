import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ChevronLeft, Video } from 'lucide-react'
import type { Metadata } from 'next'
import VideoCoachingForm from './VideoCoachingForm'

export const metadata: Metadata = { title: 'Videocoaching-Einstellungen' }

export default async function VideoCoachingSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: creator } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('user_id', user.id)
    .single()
  if (!creator) redirect('/creator/onboarding')

  const [offerRes, slotsRes] = await Promise.all([
    supabase
      .from('coaching_offers')
      .select('is_enabled, price_cents, duration_minutes, description')
      .eq('creator_id', creator.id)
      .single(),
    supabase
      .from('availability_slots')
      .select('day_of_week, start_time, end_time')
      .eq('creator_id', creator.id)
      .order('day_of_week')
      .order('start_time'),
  ])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/creator/settings"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-6"
      >
        <ChevronLeft className="h-4 w-4" />
        Einstellungen
      </Link>

      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
          <Video className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Videocoaching</h1>
          <p className="text-sm text-gray-500">1:1 Sessions direkt über dein Profil</p>
        </div>
      </div>

      <VideoCoachingForm
        initialOffer={offerRes.data ?? null}
        initialSlots={(slotsRes.data ?? []) as { day_of_week: number; start_time: string; end_time: string }[]}
      />
    </div>
  )
}
