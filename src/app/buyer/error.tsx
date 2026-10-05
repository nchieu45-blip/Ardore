'use client'

import { useEffect } from 'react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { StatePanel } from '@/components/ui/StatePanel'

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

  return <div className="ardore-workspace py-16">
    <StatePanel kind="error" title="Etwas ist schiefgelaufen" description="Bitte versuche es erneut oder geh zurück zur Startseite."
      action={<><Button onClick={reset}>Erneut versuchen</Button><ButtonLink href="/" variant="outline">Startseite</ButtonLink></>} />
  </div>
}
