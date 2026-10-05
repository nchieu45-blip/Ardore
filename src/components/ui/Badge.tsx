import { cn } from '@/lib/utils'
import type { HTMLAttributes, ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline'
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  icon?: ReactNode
}
export function Badge({ children, variant = 'default', icon, className, ...props }: BadgeProps) {
  const variants = {
    default: 'border-border bg-surface-muted text-muted',
    success: 'border-green-200 bg-brand-soft text-[var(--success)]',
    warning: 'border-amber-200 bg-[var(--warning-soft)] text-[var(--warning)]',
    danger: 'border-red-200 bg-[var(--danger-soft)] text-[var(--danger)]',
    info: 'border-blue-200 bg-[var(--info-soft)] text-[var(--info)]',
    outline: 'border-border bg-transparent text-muted',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium leading-4', variants[variant], className)} {...props}>
    {icon && <span className="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4" aria-hidden="true">{icon}</span>}{children}
  </span>
}
