import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/reset-password'

  const supabase = await createClient()

  // OTP / token-hash flow — no cookie required, works on any device/browser
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as 'recovery' | 'signup' | 'invite' | 'magiclink' | 'email_change' | 'email',
    })
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
    console.error('[auth/callback] verifyOtp failed:', error.message)
  }

  // PKCE fallback — only works when the requesting and clicking device match
  else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  const url = new URL('/forgot-password', origin)
  url.searchParams.set('error', 'link_invalid')
  return NextResponse.redirect(url)
}
