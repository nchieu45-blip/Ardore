import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Landing page after email verification — redirects by role
export default async function VerifySuccessPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const role = user.user_metadata?.role as string | undefined

  if (role === 'creator') {
    redirect('/creator/onboarding')
  }

  redirect('/buyer/onboarding')
}
