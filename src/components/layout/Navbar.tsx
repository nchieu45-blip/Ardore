'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Menu, X, Flame, ChevronDown, LayoutDashboard, Settings, LogOut, Video, Heart, ShoppingBag, Package } from 'lucide-react'
import NavbarNotificationBell from '@/components/NavbarNotificationBell'
import NavbarCartIcon from '@/components/NavbarCartIcon'
import type { Profile } from '@/types'

interface NavbarProps {
  user?: Profile | null
}

export function Navbar({ user }: NavbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  function navCls(href: string) {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
    return active
      ? 'px-3 py-2 text-sm rounded-lg font-medium bg-green-50 text-green-700 transition-all'
      : 'px-3 py-2 text-sm rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-all'
  }

  function mobileNavCls(href: string) {
    const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
    return active
      ? 'flex items-center px-3 py-2.5 text-sm font-medium rounded-xl bg-green-50 text-green-700 transition-colors'
      : 'flex items-center px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-xl transition-colors'
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const dashboardPath = user?.role === 'creator' ? '/creator' : '/buyer'

  return (
    <nav className="glass border-b border-gray-100/80 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-green-600 hover:opacity-80 transition-opacity">
            <div className="h-8 w-8 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
              <Flame className="h-4 w-4 text-white" />
            </div>
            <span className="tracking-tight">Ardore</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            <Link href="/" className={navCls('/')}>
              Startseite
            </Link>
            <Link href="/marketplace" className={navCls('/marketplace')}>
              Marketplace
            </Link>
            <Link href="/coaches" className={navCls('/coaches')}>
              Coaches
            </Link>
            {!user && (
              <Link href="/landing" className={navCls('/landing')}>
                Für Coaches
              </Link>
            )}
            <Link href="/hilfe" className={navCls('/hilfe')}>
              Hilfe
            </Link>

            {user ? (
              <>
                <Link href={dashboardPath} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-all">
                  Dashboard
                </Link>
                <NavbarCartIcon />
                <NavbarNotificationBell userId={user.id} />
                <div className="relative ml-1">
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                    className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-xl hover:bg-gray-50 transition-all focus:outline-none"
                  >
                    <Avatar src={user.avatar_url} name={user.full_name ?? user.email} size="sm" />
                    <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {dropdownOpen && (
                    <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-gray-100 py-1.5 z-50 animate-scale-in">
                      <div className="px-4 py-2.5 border-b border-gray-100 mb-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{user.full_name}</p>
                        <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      </div>
                      <Link href={dashboardPath} className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                        <LayoutDashboard className="h-4 w-4 text-gray-400" />
                        Dashboard
                      </Link>
                      <Link href="/buyer/favorites" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                        <Heart className="h-4 w-4 text-gray-400" />
                        Meine Favoriten
                      </Link>
                      {user.role === 'creator' && (
                        <>
                          <Link href="/creator/sessions" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                            <Video className="h-4 w-4 text-gray-400" />
                            Buchungen
                          </Link>
                          <Link href="/creator/settings" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                            <Settings className="h-4 w-4 text-gray-400" />
                            Einstellungen
                          </Link>
                        </>
                      )}
                      {user.role === 'buyer' && (
                        <>
                          <Link href="/buyer/sessions" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                            <Video className="h-4 w-4 text-gray-400" />
                            Meine Sessions
                          </Link>
                          <Link href="/buyer/settings" className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors" onClick={() => setDropdownOpen(false)}>
                            <Settings className="h-4 w-4 text-gray-400" />
                            Einstellungen
                          </Link>
                        </>
                      )}
                      <div className="border-t border-gray-100 mt-1 pt-1">
                        <button onClick={handleSignOut} className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
                          <LogOut className="h-4 w-4" />
                          Abmelden
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 ml-2">
                <NavbarCartIcon />
                <Link href="/login">
                  <Button variant="ghost" size="sm">Anmelden</Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Registrieren</Button>
                </Link>
              </div>
            )}
          </div>

          {/* Mobile: cart + bell + hamburger */}
          <div className="md:hidden flex items-center gap-1">
            <NavbarCartIcon />
            {user && <NavbarNotificationBell userId={user.id} />}
            <button className="p-2 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {menuOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white/95 backdrop-blur-sm">
          <div className="px-4 py-3 space-y-1">
            <Link href="/marketplace" className={mobileNavCls('/marketplace')} onClick={() => setMenuOpen(false)}>
              Marketplace
            </Link>
            <Link href="/coaches" className={mobileNavCls('/coaches')} onClick={() => setMenuOpen(false)}>
              Coaches
            </Link>

            {user ? (
              <>
                {user.role === 'buyer' && (
                  <>
                    <Link href="/buyer" className={mobileNavCls('/buyer')} onClick={() => setMenuOpen(false)}>
                      <LayoutDashboard className="h-4 w-4 mr-2" />
                      Übersicht
                    </Link>
                    <Link href="/buyer/library" className={mobileNavCls('/buyer/library')} onClick={() => setMenuOpen(false)}>
                      <ShoppingBag className="h-4 w-4 mr-2" />
                      Meine Käufe
                    </Link>
                    <Link href="/buyer/sessions" className={mobileNavCls('/buyer/sessions')} onClick={() => setMenuOpen(false)}>
                      <Video className="h-4 w-4 mr-2" />
                      Meine Buchungen
                    </Link>
                    <Link href="/buyer/favorites" className={mobileNavCls('/buyer/favorites')} onClick={() => setMenuOpen(false)}>
                      <Heart className="h-4 w-4 mr-2" />
                      Favoriten
                    </Link>
                    <Link href="/buyer/settings" className={mobileNavCls('/buyer/settings')} onClick={() => setMenuOpen(false)}>
                      <Settings className="h-4 w-4 mr-2" />
                      Einstellungen
                    </Link>
                  </>
                )}
                {user.role === 'creator' && (
                  <>
                    <Link href="/creator" className={mobileNavCls('/creator')} onClick={() => setMenuOpen(false)}>
                      <LayoutDashboard className="h-4 w-4 mr-2" />
                      Dashboard
                    </Link>
                    <Link href="/creator/products" className={mobileNavCls('/creator/products')} onClick={() => setMenuOpen(false)}>
                      <Package className="h-4 w-4 mr-2" />
                      Produkte
                    </Link>
                    <Link href="/creator/sessions" className={mobileNavCls('/creator/sessions')} onClick={() => setMenuOpen(false)}>
                      <Video className="h-4 w-4 mr-2" />
                      Buchungen
                    </Link>
                    <Link href="/buyer/favorites" className={mobileNavCls('/buyer/favorites')} onClick={() => setMenuOpen(false)}>
                      <Heart className="h-4 w-4 mr-2" />
                      Favoriten
                    </Link>
                    <Link href="/creator/settings" className={mobileNavCls('/creator/settings')} onClick={() => setMenuOpen(false)}>
                      <Settings className="h-4 w-4 mr-2" />
                      Einstellungen
                    </Link>
                  </>
                )}
                <div className="pt-1 border-t border-gray-100 mt-1">
                  <button onClick={handleSignOut} className="w-full flex items-center px-3 py-2.5 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors">
                    <LogOut className="h-4 w-4 mr-2" />
                    Abmelden
                  </button>
                </div>
              </>
            ) : (
              <>
                <Link href="/landing" className={mobileNavCls('/landing')} onClick={() => setMenuOpen(false)}>
                  Für Coaches
                </Link>
                <Link href="/hilfe" className={mobileNavCls('/hilfe')} onClick={() => setMenuOpen(false)}>
                  Hilfe
                </Link>
                <div className="flex gap-2 pt-1">
                  <Link href="/login" className="flex-1" onClick={() => setMenuOpen(false)}>
                    <Button variant="outline" className="w-full" size="sm">Anmelden</Button>
                  </Link>
                  <Link href="/register" className="flex-1" onClick={() => setMenuOpen(false)}>
                    <Button className="w-full" size="sm">Registrieren</Button>
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
