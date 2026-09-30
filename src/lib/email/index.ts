import { Resend, type CreateEmailOptions, type CreateEmailRequestOptions } from 'resend'

export const FROM = 'Ardore <noreply@ardore-health.com>'

let _resend: Resend | null = null

export function getResend(): Resend {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set')
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

export class EmailDeliveryError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number | null = null) {
    super(`Email delivery failed: ${code}`)
    this.name = 'EmailDeliveryError'
  }
}

// The SDK resolves with { error } on API rejection; awaiting send alone is not success.
export async function sendEmail(payload: CreateEmailOptions, options?: CreateEmailRequestOptions) {
  if (!process.env.RESEND_API_KEY) throw new EmailDeliveryError('missing_api_key')
  const { data, error } = await getResend().emails.send(payload, options)
  if (error || !data?.id) {
    const code = error?.name ?? 'missing_email_id'
    const statusCode = error?.statusCode ?? null
    // Do not log provider messages, credentials, recipients, or message contents.
    console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', message: 'Resend rejected email', code, statusCode }))
    throw new EmailDeliveryError(code, statusCode)
  }
  return data
}
