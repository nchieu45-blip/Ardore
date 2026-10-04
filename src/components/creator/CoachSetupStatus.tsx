'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { missingCoachRequirements, type CoachSetupProfile } from '@/lib/coach-publication'

export function CoachSetupStatus({ profile }: { profile: CoachSetupProfile }) {
  const pathname = usePathname()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (pathname === '/creator/onboarding') return null
  const missing = missingCoachRequirements(profile)
  async function publish() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/creator/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 5, publish: true }) })
      const result = await response.json()
      if (!response.ok) throw new Error([result.error, ...(result.missing ?? [])].join(' · '))
      router.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Veröffentlichung fehlgeschlagen.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Profilstatus" className="border-b border-gray-100 bg-white px-4 py-4">
    <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <p className="font-semibold text-sm text-gray-900">{profile.is_published ? 'Profil veröffentlicht' : 'Entwurf · Noch nicht öffentlich'}</p>
        {!profile.is_published && <>
          <p className="text-sm text-gray-600 mt-1">Einrichtung: {Math.min(profile.onboarding_step - 1, 4)} von 4 Schritten abgeschlossen. Bilder, Abos und Produkte sind optional.</p>
          {missing.length > 0 && <p className="text-sm text-gray-500 mt-1">Noch offen: {missing.join(', ')}</p>}
        </>}
        {error && <p role="alert" className="text-red-700 text-sm mt-2">{error}</p>}
      </div>
      {!profile.is_published && (profile.onboarding_step < 5
        ? <Link className="shrink-0" href="/creator/onboarding"><Button className="w-full sm:w-auto">Einrichtung fortsetzen</Button></Link>
        : missing.length > 0
        ? <Link href="/creator/settings/profile" className="text-green-700 underline text-sm">Profil vervollständigen</Link>
        : <Button className="w-full sm:w-auto shrink-0" loading={busy} onClick={publish}>Profil veröffentlichen</Button>)}
    </div>
  </section>
}
