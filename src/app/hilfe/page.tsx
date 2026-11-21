import { publicPageMetadata } from '@/lib/public-page-metadata'
import FaqContent from './FaqContent'

export const metadata = publicPageMetadata(
  '/hilfe',
  'Hilfe & FAQ',
  'Antworten auf häufige Fragen zu Ardore – für Kunden, Coaches und Kontosicherheit.',
)

export default function HilfePage() {
  return <FaqContent />
}
