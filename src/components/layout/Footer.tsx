import Link from 'next/link'
import { Flame } from 'lucide-react'

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="md:col-span-2">
            <Link href="/" className="flex items-center gap-2 text-white font-bold text-xl mb-3">
              <Flame className="h-6 w-6 text-green-500" />
              Ardore
            </Link>
            <p className="text-sm leading-relaxed">
              Die Plattform für Fitness-, Ernährungs- und Gesundheitscoaches in Deutschland.
              Teile dein Wissen und baue deine Community auf.
            </p>
          </div>
          <div>
            <h3 className="text-white font-medium mb-3">Plattform</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/creators" className="hover:text-white transition-colors">Coaches entdecken</Link></li>
              <li><Link href="/register?role=creator" className="hover:text-white transition-colors">Creator werden</Link></li>
              <li><Link href="/register" className="hover:text-white transition-colors">Registrieren</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-medium mb-3">Rechtliches</h3>
            <ul className="space-y-2 text-sm">
              <li><Link href="/datenschutz" className="hover:text-white transition-colors">Datenschutz</Link></li>
              <li><Link href="/agb" className="hover:text-white transition-colors">AGB</Link></li>
              <li><Link href="/impressum" className="hover:text-white transition-colors">Impressum</Link></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-sm text-center">
          © {new Date().getFullYear()} Ardore. Alle Rechte vorbehalten.
        </div>
      </div>
    </footer>
  )
}
