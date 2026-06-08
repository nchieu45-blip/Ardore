'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function BuyerError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Buyer route error:', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Etwas ist schiefgelaufen</h2>
      <p className="text-sm text-gray-500 mb-6">Bitte versuche es erneut oder geh zurück zur Startseite.</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors"
        >
          Erneut versuchen
        </button>
        <Link href="/" className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
          Startseite
        </Link>
      </div>
    </div>
  )
}
