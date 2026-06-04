import Link from 'next/link'
import { Flame, Home, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BackButton } from '@/components/ui/BackButton'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-128px)] px-4 text-center">
      {/* Logo mark */}
      <div className="h-16 w-16 rounded-2xl bg-green-600 flex items-center justify-center shadow-lg mb-8">
        <Flame className="h-8 w-8 text-white" />
      </div>

      <p className="text-sm font-semibold text-green-600 tracking-widest uppercase mb-3">404</p>
      <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">Seite nicht gefunden</h1>
      <p className="text-gray-500 max-w-sm mb-10">
        Diese Seite existiert nicht oder wurde verschoben. Vielleicht findest du hier, was du suchst.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link href="/">
          <Button className="gap-2 min-w-40">
            <Home className="h-4 w-4" />
            Zur Startseite
          </Button>
        </Link>
        <Link href="/marketplace">
          <Button variant="outline" className="gap-2 min-w-40">
            <Search className="h-4 w-4" />
            Marketplace
          </Button>
        </Link>
      </div>

      <BackButton />
    </div>
  )
}
