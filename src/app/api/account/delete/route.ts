import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import { AccountDeletionError, deleteAccountSafely } from '@/lib/account-deletion'

const headers = { 'Cache-Control': 'private, no-store' }

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || ![new URL(request.url).origin, appOrigin()].includes(origin)
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers })
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 415, headers })
  }
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || !('confirmation' in body) || body.confirmation !== 'LÖSCHEN') {
      return NextResponse.json({ error: 'Bitte bestätige die Kontolöschung mit LÖSCHEN.' }, { status: 400, headers })
    }
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400, headers })
  }

  try {
    const client = await createClient()
    const { data: { user }, error } = await client.auth.getUser()
    if (error || !user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers })
    await deleteAccountSafely({
      service: await createServiceClient({ accountDeletionProtocol: 'v2' }), userId: user.id,
      // Accounts without paid subscriptions do not need Stripe configuration.
      async getProvider() {
        const { configuredStripeLivemode } = await import('@/lib/stripe/connect-readiness')
        return { provider: (await import('@/lib/stripe/server')).stripe, livemode: configuredStripeLivemode() }
      },
    })
    return NextResponse.json({ ok: true }, { headers })
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers })
    }
    // Never log raw provider/Auth errors, credentials or personal data.
    return NextResponse.json({ error: 'Die Kontolöschung konnte nicht bestätigt werden. Bitte melde dich erneut an und prüfe den Status oder kontaktiere den Ardore-Support.' }, { status: 503, headers })
  }
}
