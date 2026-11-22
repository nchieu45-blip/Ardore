import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-url'
import { isLaunchPaused } from '@/lib/launch-pause'

export async function proxy(request: NextRequest) {
  // Config-level redirects in Next.js discard the configured response headers.
  if (request.headers.get('host')?.split(':')[0].toLowerCase() === 'ardore-health.com') {
    const canonical = new URL('https://www.ardore-health.com')
    canonical.pathname = request.nextUrl.pathname
    canonical.search = request.nextUrl.search
    return NextResponse.redirect(canonical, 308)
  }

  const path = request.nextUrl.pathname
  if (isLaunchPaused() && path !== '/api/webhooks/stripe' && !path.startsWith('/api/cron/')) {
    if (path === '/register' && ['GET', 'HEAD'].includes(request.method)) {
      return NextResponse.redirect(new URL('/#start-pausiert', appOrigin()), {
        status: 307,
        headers: { 'Cache-Control': 'private, no-store' },
      })
    }
    const headers = { 'Cache-Control': 'private, no-store' }
    if (path.startsWith('/api/') || !['GET', 'HEAD'].includes(request.method)) {
      return new NextResponse('Der öffentliche Betrieb pausiert.', { status: 503, headers })
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (err) {
    console.log('[proxy] getUser error (corrupted session?):', err)
    // user stays null → protected routes redirect to /login below
  }

  const { pathname } = request.nextUrl

  const protectedPaths = ['/creator', '/buyer', '/chat']
  const isProtected = protectedPaths.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )

  if (isProtected && !user) {
    const url = new URL('/login', appOrigin())
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // Note: no isConfirmed check here — getUser() only returns a user if their
  // JWT is valid, which already proves the session is legitimate. Adding an
  // email_confirmed_at check on top causes false-positive redirects for
  // auto-confirmed users where Supabase omits that field in the API response.

  const authPaths = ['/login', '/register']
  if (authPaths.includes(pathname) && user) {
    return NextResponse.redirect(new URL('/', appOrigin()))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    { source: '/:path*', has: [{ type: 'host', value: 'ardore-health\\.com' }] },
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
