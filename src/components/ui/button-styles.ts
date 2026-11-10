import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'tertiary' | 'danger' | 'destructive' | 'soft'
export type ButtonSize = 'sm' | 'md' | 'lg'

// Shared by server-rendered links and interactive client buttons.
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
