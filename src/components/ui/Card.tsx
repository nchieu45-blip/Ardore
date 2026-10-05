import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean
  variant?: 'default' | 'panel' | 'elevated'
}
export function Card({ className, children, hover, variant = 'default', ...props }: CardProps) {
  const surfaces = { default: 'surface-card', panel: 'surface-panel', elevated: 'surface-elevated' }
  return <div className={cn(surfaces[variant], hover && 'interactive-card', className)} {...props}>{children}</div>
}
export function CardHeader({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('border-b border-border p-4 sm:p-6', className)}>{children}</div>
}
export function CardContent({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 sm:p-6', className)}>{children}</div>
}
export function CardFooter({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-b-2xl border-t border-border bg-surface-muted px-4 py-4 sm:px-6', className)}>{children}</div>
}
