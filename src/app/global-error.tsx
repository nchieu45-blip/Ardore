'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Root layout error:', error)
  }, [error])

  return (
    <html lang="de">
      <body className="flex flex-col items-center justify-center min-h-screen px-4 text-center font-sans">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Etwas ist schiefgelaufen</h2>
        <p className="text-sm text-gray-500 mb-6">Bitte versuche es erneut oder lade die Seite neu.</p>
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-xl hover:bg-green-700 transition-colors"
          >
            Erneut versuchen
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
            Startseite
          </a>
        </div>
      </body>
    </html>
  )
}
