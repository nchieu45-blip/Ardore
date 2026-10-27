import { NextResponse } from 'next/server'

export function isAccountDeletionPath(pathname: string): boolean {
  try {
    return decodeURIComponent(pathname).replace(/\/+$/, '').toLowerCase() === '/api/account/delete'
  } catch {
    return false
  }
}

export function accountDeletionHoldResponse() {
  return NextResponse.json({
    code: 'ACCOUNT_DELETION_PAUSED',
    error: 'Die Kontolöschung ist vorübergehend pausiert. Bitte kontaktiere den Ardore-Support.',
  }, {
    status: 503,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Ardore-Account-Deletion': 'paused-v1',
    },
  })
}
