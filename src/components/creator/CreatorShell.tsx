'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard,
  Package,
  CreditCard,
  Video,
  Users,
  Calendar,
  MessageCircle,
  Percent,
  TrendingUp,
  User,
  Settings,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
}

const PRIMARY_ITEMS: NavItem[] = [
  { label: 'Übersicht',      href: '/creator',                        icon: LayoutDashboard },
  { label: 'Produkte',       href: '/creator/products',               icon: Package },
  { label: 'Abos',           href: '/creator/settings/tiers',         icon: CreditCard },
  { label: '1:1 Coaching',   href: '/creator/settings/videocoaching', icon: Video },
  { label: 'Gruppen-Kurse',  href: '/creator/settings/video-classes', icon: Users },
  { label: 'Buchungen',      href: '/creator/sessions',               icon: Calendar },
  { label: 'Nachrichten',    href: '/creator/chat',                   icon: MessageCircle },
  { label: 'Rabatte',        href: '/creator/settings/discounts',     icon: Percent },
]

const SECONDARY_ITEMS: NavItem[] = [
  { label: 'Einnahmen',      href: '/creator/earnings',               icon: TrendingUp },
  { label: 'Profil',         href: '/creator/settings/profile',       icon: User },
  { label: 'Einstellungen',  href: '/creator/settings',               icon: Settings },
]

// The sidebar sub-pages that have their own items — used so /creator/settings
// only highlights "Einstellungen" for pages NOT covered by a primary/secondary item.
const SETTINGS_SUBPATHS_WITH_OWN_ITEM = [
  '/creator/settings/tiers',
  '/creator/settings/videocoaching',
  '/creator/settings/video-classes',
  '/creator/settings/discounts',
  '/creator/settings/profile',
]

function isActive(href: string, pathname: string): boolean {
  if (href === '/creator') return pathname === '/creator'
  if (href === '/creator/settings') {
    if (!pathname.startsWith('/creator/settings')) return false
    return !SETTINGS_SUBPATHS_WITH_OWN_ITEM.some(p => pathname.startsWith(p))
  }
  return pathname === href || pathname.startsWith(href + '/')
}

function getCurrentLabel(pathname: string): string {
  const all = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS]
  return all.find(item => isActive(item.href, pathname))?.label ?? 'Creator'
}

// ─── Sidebar navigation content ──────────────────────────────────────────────

function SidebarNav({
  pathname,
  creatorSlug,
  onNavigate,
}: {
  pathname: string
  creatorSlug: string | null
  onNavigate?: () => void
}) {
  function NavLink({ item }: { item: NavItem }) {
    const active = isActive(item.href, pathname)
    const isProfileItem = item.href === '/creator/settings/profile'

    return (
      <div className="flex items-center gap-1">
        <Link
          href={item.href}
          onClick={onNavigate}
          className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
            active
              ? 'bg-green-50 text-green-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <item.icon
            className={`h-4 w-4 flex-shrink-0 ${active ? 'text-green-600' : 'text-gray-400'}`}
          />
          {item.label}
        </Link>
        {isProfileItem && creatorSlug && (
          <a
            href={`/creators/${creatorSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg text-gray-300 hover:text-green-600 hover:bg-gray-50 transition-colors flex-shrink-0"
            title="Profil ansehen"
            aria-label="Profil öffentlich ansehen"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full py-4">
      <nav className="flex-1 px-3 space-y-0.5">
        {PRIMARY_ITEMS.map(item => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>
      <div className="px-3 pt-3 mt-3 border-t border-gray-100 space-y-0.5">
        {SECONDARY_ITEMS.map(item => (
          <NavLink key={item.href} item={item} />
        ))}
      </div>
    </div>
  )
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function CreatorShell({
  children,
  creatorSlug,
}: {
  children: React.ReactNode
  creatorSlug: string | null
}) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const pathname = usePathname()
  const currentLabel = getCurrentLabel(pathname)

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">

      {/* ── Desktop sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-gray-100 bg-white sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto flex-shrink-0">
        <SidebarNav
          pathname={pathname}
          creatorSlug={creatorSlug}
        />
      </aside>

      {/* ── Mobile drawer overlay ───────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" aria-modal="true" role="dialog">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="absolute left-0 top-0 h-full w-64 bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
              <span className="font-semibold text-gray-900 text-sm">Coach-Bereich</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                aria-label="Menü schließen"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarNav
                pathname={pathname}
                creatorSlug={creatorSlug}
                onNavigate={() => setMobileOpen(false)}
              />
            </div>
          </aside>
        </div>
      )}

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Mobile sub-header */}
        <div className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-gray-100 bg-white sticky top-16 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Navigation öffnen"
          >
            <Menu className="h-5 w-5 text-gray-600" />
          </button>
          <span className="text-sm font-medium text-gray-900">{currentLabel}</span>
        </div>

        {children}
      </div>
    </div>
  )
}
