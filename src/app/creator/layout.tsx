import { createClient } from '@/lib/supabase/server'
import CreatorShell from '@/components/creator/CreatorShell'

export default async function CreatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let creatorSlug: string | null = null
  if (user) {
    const { data } = await supabase
      .from('creator_profiles')
      .select('slug')
      .eq('user_id', user.id)
      .maybeSingle()
    creatorSlug = data?.slug ?? null
  }

  // No creator profile yet (onboarding flow) → render without sidebar
  if (!creatorSlug) {
    return <>{children}</>
  }

  return (
    <CreatorShell creatorSlug={creatorSlug}>
      {children}
    </CreatorShell>
  )
}
