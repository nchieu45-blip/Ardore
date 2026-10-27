import { accountDeletionHoldResponse } from '@/lib/account-deletion-hold'

// Reopening requires a separately reviewed release, never an environment flag.
export function POST() {
  return accountDeletionHoldResponse()
}
