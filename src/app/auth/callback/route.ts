import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  // Log everything we can see so we can diagnose failures
  const cookieNames = request.cookies.getAll().map(c => c.name)
  const hasCodeVerifierCookie = cookieNames.some(n => n.includes('code-verifier'))

  console.log('[auth/callback] request received', {
    hasCode: !!code,
    codeLength: code?.length ?? 0,
    next,
    origin,
    allCookieNames: cookieNames,
    hasCodeVerifierCookie,
  })

  if (!code) {
    console.error('[auth/callback] no ?code= param in URL — full URL:', request.nextUrl.toString())
    const url = new URL('/forgot-password', origin)
    url.searchParams.set('error', 'link_invalid')
    return NextResponse.redirect(url)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] exchangeCodeForSession failed', {
      message: error.message,
      status: (error as { status?: number }).status,
      name: error.name,
      hasCodeVerifierCookie,
    })
    const url = new URL('/forgot-password', origin)
    url.searchParams.set('error', 'link_invalid')
    return NextResponse.redirect(url)
  }

  console.log('[auth/callback] exchange succeeded — redirecting to', next)
  return NextResponse.redirect(new URL(next, origin))
}
