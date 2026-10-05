import { AlertCircle, Inbox, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function StatePanel({ kind = 'empty', title, description, action, className }: {
  kind?: 'empty' | 'error' | 'loading'; title: string; description?: string; action?: ReactNode; className?: string
}) {
  const Icon = kind === 'error' ? AlertCircle : kind === 'loading' ? LoaderCircle : Inbox
  return <section role={kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined}
    aria-busy={kind === 'loading' || undefined} className={cn('surface-card p-6 text-center sm:p-8', className)}>
    <Icon className={cn('mx-auto mb-4 h-8 w-8', kind === 'error' ? 'text-[var(--danger)]' : 'text-muted', kind === 'loading' && 'animate-spin')} aria-hidden="true" />
    <h2 className="card-title text-foreground">{title}</h2>
    {description && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{description}</p>}
    {action && <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
  </section>
}
