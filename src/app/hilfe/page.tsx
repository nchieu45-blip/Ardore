import type { Metadata } from 'next'
import FaqContent from './FaqContent'

export const metadata: Metadata = {
  title: 'Hilfe & FAQ',
  description: 'Antworten auf häufige Fragen zu Ardore – für Kunden, Coaches und Kontosicherheit.',
}

export default function HilfePage() {
  return <FaqContent />
}
