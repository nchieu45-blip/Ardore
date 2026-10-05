import { cn } from '@/lib/utils'
import type { HTMLAttributes, ReactNode } from 'react'

export function PageContainer({ workspace, className, ...props }: HTMLAttributes<HTMLDivElement> & { workspace?: boolean }) {
  return <div className={cn(workspace ? 'ardore-workspace' : 'ardore-container', className)} {...props} />
}
export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return <header className={cn('mb-8 flex flex-wrap items-start justify-between gap-4', className)}>
    <div className="min-w-0"><h1 className="section-title text-foreground">{title}</h1>{description && <p className="mt-2 text-sm text-muted">{description}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
}
export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
    <div><h2 className="section-title text-foreground">{title}</h2>{description && <p className="mt-2 text-sm text-muted">{description}</p>}</div>{action}
  </header>
}
