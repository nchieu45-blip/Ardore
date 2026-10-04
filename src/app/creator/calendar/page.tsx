import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import CoachCalendar from './CoachCalendar'
export const metadata: Metadata = { title: 'Coach-Kalender', robots: { index: false, follow: false } }
export default async function CalendarPage() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/login?redirect=%2Fcreator%2Fcalendar')
  const { data: coach, error } = await client.from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
  if (error) return <p role="alert" className="p-6">Dein Kalender konnte nicht geladen werden. Bitte lade die Seite erneut.</p>
  if (!coach) redirect('/creator/onboarding')
  return <CoachCalendar />
}
