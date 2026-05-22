import Link from 'next/link'
import { Button } from '@/components/ui/Button'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-128px)] px-4 text-center">
      <h1 className="text-8xl font-bold text-green-200 mb-4">404</h1>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Seite nicht gefunden</h2>
      <p className="text-gray-500 mb-8">Diese Seite existiert nicht oder wurde verschoben.</p>
      <Link href="/">
        <Button>Zurück zur Startseite</Button>
      </Link>
    </div>
  )
}
