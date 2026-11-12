import { timingSafeEqual } from 'node:crypto'

export const runtime = 'nodejs'

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  // Use the same operations-only credential as the email diagnostic.
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  const authorization = request.headers.get('authorization')
  if (!secret || !authorization) return reply({ error: 'Unauthorized' }, 401)

  const expected = Buffer.from(`Bearer ${secret}`)
  const supplied = Buffer.from(authorization)
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return reply({ error: 'Unauthorized' }, 401)
  }

  try {
    const { stripe } = await import('@/lib/stripe/server')
    const account = await stripe.accounts.retrieveCurrent({}, { timeout: 5000, maxNetworkRetries: 0 })
    const requestId = account.lastResponse?.requestId
    if (!requestId || !/^req_[a-zA-Z0-9]+$/.test(requestId)) {
      return reply({ error: 'Stripe request ID unavailable' }, 502)
    }
    return reply({ requestId })
  } catch {
    return reply({ error: 'Stripe account check failed' }, 502)
  }
}
