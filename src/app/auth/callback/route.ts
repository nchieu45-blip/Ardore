import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { appOrigin, safeAuthDestination } from '@/lib/app-url'
import type { EmailOtpType } from '@supabase/supabase-js'

const emailTypes = new Set<EmailOtpType>(['recovery', 'signup', 'invite', 'magiclink', 'email_change', 'email'])

function redirect(destination: URL) {
  const response = NextResponse.redirect(destination)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const recovery = type === 'recovery' || (!type && next?.split('?')[0] === '/reset-password')
  const destination = safeAuthDestination(next, recovery ? '/reset-password' : '/verify-success')

  try {
    const supabase = await createClient()
    // Token-hash verification works across browsers without a PKCE cookie.
    if (tokenHash && type && emailTypes.has(type as EmailOtpType)) {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType })
      if (!error && data.session) return redirect(destination)
    } else if (!tokenHash && code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code)
      if (!error && data.session) return redirect(destination)
    }
  } catch {
    // Never log tokens, authorization codes or provider responses.
  }

  const url = new URL(recovery ? '/forgot-password' : '/verify-email', appOrigin())
  url.searchParams.set('error', 'link_invalid')
  return redirect(url)
}
