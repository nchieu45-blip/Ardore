'use client'

import Link from 'next/link'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, type ComponentProps, forwardRef } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'tertiary' | 'danger' | 'destructive' | 'soft'
type ButtonSize = 'sm' | 'md' | 'lg'

export function buttonStyles({ variant = 'primary', size = 'md', className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  const primary = 'bg-brand text-white hover:bg-brand-dark'
  const secondary = 'border-[color:var(--border-control)] bg-surface text-foreground hover:bg-surface-muted'
  const tertiary = 'text-muted hover:bg-surface-muted hover:text-foreground'
  const destructive = 'bg-[var(--danger)] text-white hover:bg-[#931d29]'
  const variants: Record<ButtonVariant, string> = {
    primary, secondary, outline: secondary, ghost: tertiary, tertiary,
    danger: destructive, destructive,
    soft: 'bg-brand-soft text-brand-dark hover:bg-green-200',
  }
  const sizes = { sm: 'px-3 text-sm', md: 'px-4 text-sm', lg: 'min-h-12 px-6 text-base' }
  return cn('button-base', variants[variant], sizes[size], className)
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, 'aria-busy': busy, ...props }, ref) => (
    <button ref={ref} className={buttonStyles({ variant, size, className })} {...props}
      disabled={disabled || loading} aria-busy={loading || busy || undefined}>
      {loading && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  )
)
Button.displayName = 'Button'

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonStyles({ variant, size, className })} {...props} />
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  ({ label, variant = 'ghost', className, type = 'button', ...props }, ref) => (
    <Button ref={ref} type={type} variant={variant} aria-label={label} className={cn('icon-button', className)} {...props} />
  )
)
IconButton.displayName = 'IconButton'
