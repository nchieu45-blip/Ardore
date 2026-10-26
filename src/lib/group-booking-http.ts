import { NextRequest, NextResponse } from 'next/server'
import { appOrigin } from '@/lib/app-url'
import type { GroupPaymentResult } from '@/lib/group-booking-payments'

export const GROUP_PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
export function groupResult(result: GroupPaymentResult) {
  const { httpStatus, ...body } = result
  return NextResponse.json(body, { status: httpStatus, headers: GROUP_PRIVATE_HEADERS })
}
export function groupRequestError(request: NextRequest) {
  const origin = request.headers.get('origin')
  if (!origin || ![new URL(request.url).origin, appOrigin()].includes(origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 403, headers: GROUP_PRIVATE_HEADERS })
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 415, headers: GROUP_PRIVATE_HEADERS })
  }
  return null
}
