import { createHash, timingSafeEqual } from 'node:crypto'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { appOrigin } from '@/lib/app-url'

export async function proxy(request: NextRequest) {
  // Config-level redirects in Next.js discard the configured response headers.
  if (request.headers.get('host')?.split(':')[0].toLowerCase() === 'ardore-health.com') {
    const canonical = new URL('https://www.ardore-health.com')
    canonical.pathname = request.nextUrl.pathname
    canonical.search = request.nextUrl.search
    return NextResponse.redirect(canonical, 308)
  }

  // Only the isolated local backend with a sandbox key can accept test bookings.
  const isolated = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    && /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY ?? '')
  const path = request.nextUrl.pathname
  if (!isolated && path !== '/api/webhooks/stripe' && !path.startsWith('/api/cron/')) {
    const headers = { 'Cache-Control': 'private, no-store' }
    if (path.startsWith('/api/') || path === '/register' || !['GET', 'HEAD'].includes(request.method)) {
      return new NextResponse('Der öffentliche Betrieb pausiert.', { status: 503, headers })
    }
    const expected = Buffer.from('4b969562339956930f86ecd9d30a0f0ea9df343e5af7957e4613a49108696e9e', 'hex')
    const actual = createHash('sha256').update(request.headers.get('authorization') ?? '').digest()
    if (!timingSafeEqual(expected, actual)) {
      return new NextResponse('Privater Zugang', {
        status: 401, headers: { ...headers, 'WWW-Authenticate': 'Basic realm="Ardore"' },
      })
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
