'use client'
import { Button, ButtonLink } from '@/components/ui/Button'
import { StatePanel } from '@/components/ui/StatePanel'

export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="ardore-container py-16">
    <StatePanel kind="error" title="Die Seite konnte nicht geladen werden"
      description="Die Daten sind momentan nicht erreichbar. Bitte versuche es erneut. Das bedeutet nicht, dass keine Angebote vorhanden sind."
      action={<><Button onClick={reset}>Erneut versuchen</Button><ButtonLink href="/" variant="outline">Zur Startseite</ButtonLink></>} />
  </div>
}
