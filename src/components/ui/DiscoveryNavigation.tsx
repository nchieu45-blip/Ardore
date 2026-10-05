import Link from 'next/link'
import { UsersRound, ShoppingBag } from 'lucide-react'
import { cn } from '@/lib/utils'

// Existing routes remain canonical. Carry only shared filters into the other intention.
export function discoveryHref(
  route: '/coaches' | '/marketplace',
  search = '',
  category = 'all'
) {
  const params = new URLSearchParams()
  if (search.trim()) params.set('q', search.trim().replace(/\s+/g, ' '))
  if (category !== 'all') params.set('category', category)
  return `${route}${params.size ? `?${params}` : ''}`
}
export function DiscoveryNavigation({
  active,
  search = '',
  category = 'all',
}: {
  active: 'coaches' | 'products'
  search?: string
  category?: string
}) {
  return (
    <nav
      aria-label="Marktplatz-Bereiche"
      className="inline-flex max-w-full gap-1 rounded-xl border border-border bg-surface-muted p-1"
    >
      {[
        {
          key: 'coaches',
          route: '/coaches',
          label: 'Coaches',
          Icon: UsersRound,
        },
        {
          key: 'products',
          route: '/marketplace',
          label: 'Produkte',
          Icon: ShoppingBag,
        },
      ].map(({ key, route, label, Icon }) => (
        <Link
          key={key}
          href={discoveryHref(
            route as '/coaches' | '/marketplace',
            search,
            category
          )}
          aria-current={active === key ? 'page' : undefined}
          className={cn(
            'button-base px-4 text-sm',
            active === key
              ? 'bg-surface text-brand shadow-sm'
              : 'text-muted hover:text-foreground'
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  )
}
