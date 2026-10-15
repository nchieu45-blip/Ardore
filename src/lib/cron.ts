import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  const supplied = request.headers.get('authorization')
  if (!secret?.trim() || !supplied) return false
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(supplied)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function cronJson(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
