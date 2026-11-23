import { createHash, timingSafeEqual } from 'node:crypto'

// A verifier for the random, reminder-only credential held in Supabase Vault.
const verifier = Buffer.from('68c4f222d384973901853e2eed9ffd0dddd00893b11b12e0b850fae6f72aff53', 'hex')

export function isReminderSchedulerAuthorized(request: Request): boolean {
  const authorization = request.headers.get('authorization')
  if (!authorization) return false
  return timingSafeEqual(verifier, createHash('sha256').update(authorization).digest())
}
