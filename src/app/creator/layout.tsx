import { createClient } from '@/lib/supabase/server'
import { CoachSetupStatus } from '@/components/creator/CoachSetupStatus'
import CreatorShell from '@/components/creator/CreatorShell'

export default async function CreatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let creator: import('@/lib/coach-publication').CoachSetupProfile | null = null
  if (user) {
    const { data } = await supabase
      .from('creator_profiles')
      .select('id,slug,display_name,bio,category,categories,avatar_url,banner_url,is_published,onboarding_step')
      .eq('user_id', user.id)
      .maybeSingle()
    creator = data
  }

  // No creator profile yet (onboarding flow) → render without sidebar
  if (!creator) {
    return <>{children}</>
  }

  return (
    <CreatorShell creatorSlug={creator.is_published ? creator.slug : null}>
      <CoachSetupStatus profile={creator} />
      {children}
    </CreatorShell>
  )
}
