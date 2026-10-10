import Link from 'next/link'
import { Flame } from 'lucide-react'
import { CookieSettingsButton } from '@/components/CookieSettingsButton'

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300 mt-auto">
      <div className="ardore-container py-10 sm:py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-8 lg:gap-x-12">
          <div className="col-span-2">
            <Link href="/" className="min-h-11 flex items-center gap-2 text-white font-bold text-xl mb-3 w-fit">
              <div className="h-7 w-7 rounded-lg bg-green-600 flex items-center justify-center">
                <Flame className="h-4 w-4 text-white" />
              </div>
              Ardore
            </Link>
            <p className="text-sm leading-relaxed max-w-sm">
              Der Marktplatz für Health-Coaching in Deutschland — entdecke Coaches für Fitness, Ernährung und Wohlbefinden oder verkaufe dein eigenes Coaching.
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-semibold text-sm mb-2">Entdecken</h3>
            <ul className="text-sm">
              <li><Link href="/marketplace" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Marktplatz</Link></li>
              <li><Link href="/coaches" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Coaches entdecken</Link></li>
              <li><Link href="/landing" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Für Coaches</Link></li>
              <li><Link href="/register" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Registrieren</Link></li>
              <li><Link href="/hilfe" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Hilfe & FAQ</Link></li>
            </ul>
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-semibold text-sm mb-2">Rechtliches</h3>
            <ul className="text-sm">
              <li><Link href="/datenschutz" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Datenschutz</Link></li>
              <li><Link href="/agb" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">AGB</Link></li>
              <li><Link href="/impressum" className="min-h-11 flex items-center py-2 hover:text-white transition-colors">Impressum</Link></li>
              <li className="[&_button]:min-h-11 [&_button]:max-w-full [&_button]:py-2 [&_button]:text-left [&_button]:break-words"><CookieSettingsButton /></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 sm:mt-10 pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs leading-relaxed">
          <span>© {new Date().getFullYear()} Ardore. Alle Rechte vorbehalten.</span>
          <span className="text-gray-300">Made with ♥ in Deutschland</span>
        </div>
      </div>
    </footer>
  )
}
