'use client'

import Link from 'next/link'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type ButtonHTMLAttributes, type ComponentProps, forwardRef } from 'react'
import { buttonStyles, type ButtonVariant, type ButtonSize } from './button-styles'
export { buttonStyles } from './button-styles'

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
