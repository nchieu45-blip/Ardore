'use client'

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
  ExternalLink,
} from 'lucide-react'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  showPublicLink?: true
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
  { label: 'Profil',         href: '/creator/settings/profile',       icon: User, showPublicLink: true },
  { label: 'Einstellungen',  href: '/creator/settings',               icon: Settings },
]

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

function SidebarNav({
  pathname,
  creatorSlug,
}: {
  pathname: string
  creatorSlug: string | null
}) {
  function NavRow({ item }: { item: NavItem }) {
    const active = isActive(item.href, pathname)
    return (
      <div className="flex items-center gap-1">
        <Link
          href={item.href}
          className={`flex-1 flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
            active
              ? 'bg-green-50 text-green-700'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          <item.icon className={`h-4 w-4 flex-shrink-0 ${active ? 'text-green-600' : 'text-gray-400'}`} />
          {item.label}
        </Link>
        {item.showPublicLink && creatorSlug && (
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
        {PRIMARY_ITEMS.map(item => <NavRow key={item.href} item={item} />)}
      </nav>
      <div className="px-3 pt-3 mt-3 border-t border-gray-100 space-y-0.5">
        {SECONDARY_ITEMS.map(item => <NavRow key={item.href} item={item} />)}
      </div>
    </div>
  )
}

export default function CreatorShell({
  children,
  creatorSlug,
}: {
  children: React.ReactNode
  creatorSlug: string | null
}) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      {/* Desktop sidebar — hidden on mobile; Navbar hamburger handles mobile nav */}
      <aside className="hidden md:flex flex-col w-56 border-r border-gray-100 bg-white sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto flex-shrink-0">
        <SidebarNav pathname={pathname} creatorSlug={creatorSlug} />
      </aside>

      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
