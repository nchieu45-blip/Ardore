'use client'

import { ArrowLeft } from 'lucide-react'

export function BackButton({ label = 'Zurück zur vorherigen Seite' }: { label?: string }) {
  return (
    <button
      onClick={() => history.back()}
      className="mt-8 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 transition-colors"
    >
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  )
}
