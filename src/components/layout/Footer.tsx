import Link from 'next/link'
import { Flame } from 'lucide-react'
import { CookieSettingsButton } from '@/components/CookieSettingsButton'

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8">
          <div className="sm:col-span-2">
            <Link href="/" className="flex items-center gap-2 text-white font-bold text-xl mb-3">
              <div className="h-7 w-7 rounded-lg bg-green-600 flex items-center justify-center">
                <Flame className="h-4 w-4 text-white" />
              </div>
              Ardore
            </Link>
            <p className="text-sm leading-relaxed max-w-sm">
              Die Plattform für Fitness-, Ernährungs- und Gesundheitscoaches in Deutschland.
              Teile dein Wissen und baue deine Community auf.
            </p>
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm mb-4">Entdecken</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/marketplace" className="hover:text-white transition-colors">Marketplace</Link></li>
              <li><Link href="/coaches" className="hover:text-white transition-colors">Coaches entdecken</Link></li>
              <li><Link href="/landing" className="hover:text-white transition-colors">Für Coaches</Link></li>
              <li><Link href="/register" className="hover:text-white transition-colors">Registrieren</Link></li>
              <li><Link href="/hilfe" className="hover:text-white transition-colors">Hilfe & FAQ</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-white font-semibold text-sm mb-4">Rechtliches</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/datenschutz" className="hover:text-white transition-colors">Datenschutz</Link></li>
              <li><Link href="/agb" className="hover:text-white transition-colors">AGB</Link></li>
              <li><Link href="/impressum" className="hover:text-white transition-colors">Impressum</Link></li>
              <li><CookieSettingsButton /></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <span>© {new Date().getFullYear()} Ardore. Alle Rechte vorbehalten.</span>
          <span className="text-gray-600">Made with ♥ for Fitness-Community in Deutschland</span>
        </div>
      </div>
    </footer>
  )
}
