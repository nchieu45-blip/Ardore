import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { EmailDeliveryError, FROM, sendEmail } from '@/lib/email'
import { appOrigin } from '@/lib/app-url'
import { VIDEO_CALLS_ENABLED } from '@/lib/features'

export const runtime = 'nodejs'

// Operations-only endpoint: reuse the existing server credential, never browser credentials.
// No customer data is read or written and the recipient cannot be overridden.
function authorized(request: Request) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supplied = request.headers.get('authorization')
  if (!secret || !supplied) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(supplied)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  if (!authorized(request)) return reply({ error: 'Unauthorized' }, 401)
  return reply({
    resendKeyPresent: Boolean(process.env.RESEND_API_KEY), from: FROM,
    stripeTestMode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') === true,
    stripePublishableTestMode: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_') === true,
    appUrlIsCanonical: appOrigin() === 'https://www.ardore-health.com',
    dailyEnabled: VIDEO_CALLS_ENABLED,
  })
}

export async function POST(request: Request) {
  if (!authorized(request)) return reply({ error: 'Unauthorized' }, 401)
  const resendKeyPresent = Boolean(process.env.RESEND_API_KEY)
  try {
    const data = await sendEmail({
      from: FROM,
      to: 'delivered@resend.dev',
      subject: 'Ardore production application email test',
      text: 'A diagnostic email sent by the Ardore production application. No customer, payment, or booking is involved.',
    }, {
      // Repeated requests on the same UTC day do not send duplicate test emails.
      idempotencyKey: `ardore-production-email-test-${new Date().toISOString().slice(0, 10)}`,
    })
    console.info(JSON.stringify({ timestamp: new Date().toISOString(), level: 'INFO', message: 'Production email test accepted', emailId: data.id }))
    return reply({ accepted: true, emailId: data.id, resendKeyPresent })
  } catch (error) {
    return reply({
      accepted: false,
      resendKeyPresent,
      error: error instanceof EmailDeliveryError ? error.code : 'email_transport_error',
      providerStatus: error instanceof EmailDeliveryError ? error.statusCode : null,
    }, 502)
  }
}
