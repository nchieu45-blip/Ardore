import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { appOrigin } from '@/lib/app-url'
import {
  cancelSubscription, inspectSubscriptionCancellation, SubscriptionCancellationError,
  type CancellableSubscription,
} from '@/lib/subscription-cancellation'

const headers = { 'Cache-Control': 'private, no-store' }
type Context = { params: Promise<{ id: string }> }

async function handle(context: Context, cancel: boolean) {
  try {
    const client = await createClient()
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401, headers })
    const { id } = await context.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Ungültige Abo-ID' }, { status: 400, headers })
    }
    // Read through the user's RLS client with explicit ownership before any
    // privileged lookup or provider request. Never accept actor/provider IDs.
    const { data: subscription, error } = await client.from('subscriptions')
      .select('id,buyer_id,creator_id,tier_id,status,current_period_end,stripe_subscription_id,stripe_livemode,tier:subscription_tiers(creator_id)')
      .eq('id', id).eq('buyer_id', user.id).maybeSingle()
    if (error) throw new SubscriptionCancellationError(503, 'Das Abo konnte momentan nicht geprüft werden.')
    if (!subscription || subscription.id !== id || subscription.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Abo nicht gefunden' }, { status: 404, headers })
    }
    let livemode: boolean | null = null
    let provider: Stripe | null = null
    // App-only free subscriptions must also work without a Stripe credential.
    if (!(subscription.stripe_livemode === null && subscription.stripe_subscription_id.startsWith('free_'))) {
      try {
        const { configuredStripeLivemode } = await import('@/lib/stripe/connect-readiness')
        livemode = configuredStripeLivemode()
        provider = (await import('@/lib/stripe/server')).stripe
      } catch {
        throw new SubscriptionCancellationError(503, 'Der Kündigungsstatus ist momentan nicht verfügbar.')
      }
    }
    const result = await (cancel ? cancelSubscription : inspectSubscriptionCancellation)({
      service: await createServiceClient(), provider,
      subscription: subscription as CancellableSubscription, livemode,
    })
    return NextResponse.json(result, { headers })
  } catch (error) {
    if (error instanceof SubscriptionCancellationError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers })
    }
    // Do not expose provider errors, customer metadata or credentials.
    return NextResponse.json({ error: 'Der Abo-Status konnte nicht bestätigt werden. Bitte prüfe ihn erneut.' }, { status: 503, headers })
  }
}

export async function GET(_request: NextRequest, context: Context) {
  return handle(context, false)
}

export async function POST(request: NextRequest, context: Context) {
  // JSON plus an exact trusted Origin prevents cookie-authenticated cross-site
  // forms from scheduling a cancellation. appOrigin supports Hostinger's proxy.
  const origin = request.headers.get('origin')
  if (!origin || ![new URL(request.url).origin, appOrigin()].includes(origin)
    || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers })
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 415, headers })
  }
  // The endpoint intentionally accepts no browser-controlled mutation fields.
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
      return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400, headers })
    }
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400, headers })
  }
  return handle(context, true)
}
