'use client'

import { cn } from '@/lib/utils'
import { forwardRef, useId, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const feedbackId = `${inputId}-feedback`

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500',
            'hover:border-gray-400',
            'disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed',
            error && 'border-red-500 focus:ring-red-500 focus:border-red-500',
            className
          )}
          {...props}
          aria-invalid={error ? true : invalid}
          aria-describedby={[describedBy, (error || hint) && feedbackId].filter(Boolean).join(' ') || undefined}
        />
        {error && <p id={feedbackId} className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p id={feedbackId} className="text-xs text-gray-500">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, hint, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const feedbackId = `${inputId}-feedback`

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400',
            'transition-colors duration-150',
            'focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500',
            'hover:border-gray-400',
            'disabled:opacity-50 disabled:bg-gray-50 disabled:cursor-not-allowed resize-y min-h-[100px]',
            error && 'border-red-500 focus:ring-red-500',
            className
          )}
          {...props}
          aria-invalid={error ? true : invalid}
          aria-describedby={[describedBy, (error || hint) && feedbackId].filter(Boolean).join(' ') || undefined}
        />
        {error && <p id={feedbackId} className="text-xs text-red-600">{error}</p>}
        {hint && !error && <p id={feedbackId} className="text-xs text-gray-500">{hint}</p>}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, options, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const feedbackId = `${inputId}-feedback`

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={inputId}
          className={cn(
            'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white',
            'focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500',
            error && 'border-red-500',
            className
          )}
          {...props}
          aria-invalid={error ? true : invalid}
          aria-describedby={[describedBy, error && feedbackId].filter(Boolean).join(' ') || undefined}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {error && <p id={feedbackId} className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
