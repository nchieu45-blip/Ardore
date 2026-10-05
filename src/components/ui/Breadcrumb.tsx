import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  label: string
  href?: string
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-2 text-sm text-muted mb-6" aria-label="Brotkrumennavigation">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight className="h-4 w-4 flex-shrink-0" aria-hidden="true" />}
          {item.href ? (
            <Link href={item.href} className="hover:text-gray-600 transition-colors">
              {item.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-foreground font-medium break-words">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
