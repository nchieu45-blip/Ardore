'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Menu, X, Flame } from 'lucide-react'
import type { Profile } from '@/types'

interface NavbarProps {
  user?: Profile | null
}

export function Navbar({ user }: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const dashboardPath = user?.role === 'creator' ? '/creator' : '/buyer'

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-green-600">
            <Flame className="h-6 w-6" />
            <span>Ardore</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            <Link href="/creators" className="text-sm text-gray-600 hover:text-green-600 transition-colors">
              Coaches entdecken
            </Link>
            {user ? (
              <>
                <Link href={dashboardPath} className="text-sm text-gray-600 hover:text-green-600 transition-colors">
                  Dashboard
                </Link>
                <div className="relative">
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="flex items-center gap-2 focus:outline-none"
                  >
                    <Avatar src={user.avatar_url} name={user.full_name ?? user.email} size="sm" />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                      <div className="px-4 py-2 border-b border-gray-100">
                        <p className="text-sm font-medium text-gray-900 truncate">{user.full_name}</p>
                        <p className="text-xs text-gray-500 truncate">{user.email}</p>
                      </div>
                      <Link
                        href={dashboardPath}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        onClick={() => setDropdownOpen(false)}
                      >
                        Dashboard
                      </Link>
                      {user.role === 'creator' && (
                        <Link
                          href="/creator/settings"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                          onClick={() => setDropdownOpen(false)}
                        >
                          Einstellungen
                        </Link>
                      )}
                      <button
                        onClick={handleSignOut}
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        Abmelden
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link href="/login">
                  <Button variant="ghost" size="sm">Anmelden</Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Registrieren</Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <div className="px-4 py-3 space-y-2">
            <Link
              href="/creators"
              className="block py-2 text-sm text-gray-600 hover:text-green-600"
              onClick={() => setMenuOpen(false)}
            >
              Coaches entdecken
            </Link>
            {user ? (
              <>
                <Link
                  href={dashboardPath}
                  className="block py-2 text-sm text-gray-600 hover:text-green-600"
                  onClick={() => setMenuOpen(false)}
                >
                  Dashboard
                </Link>
                <button
                  onClick={handleSignOut}
                  className="w-full text-left py-2 text-sm text-red-600"
                >
                  Abmelden
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="block py-2 text-sm text-gray-600" onClick={() => setMenuOpen(false)}>
                  Anmelden
                </Link>
                <Link href="/register" className="block py-2 text-sm text-green-600 font-medium" onClick={() => setMenuOpen(false)}>
                  Registrieren
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
