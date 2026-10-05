'use client'

import { cn } from '@/lib/utils'
import { forwardRef, useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react'

type FieldProps = { label?: string; error?: string; hint?: string; success?: string }

function FieldFeedback({ id, error, hint, success }: Omit<FieldProps, 'label'> & { id: string }) {
  const message = error || success || hint
  if (!message) return null
  return <p id={id} role={error ? 'alert' : success ? 'status' : undefined}
    className={cn('text-xs', error ? 'text-[var(--danger)]' : success ? 'text-[var(--success)]' : 'text-muted')}>{message}</p>
}
function descriptionIds(external: string | undefined, feedback: string, hasFeedback: boolean) {
  return [external, hasFeedback && feedback].filter(Boolean).join(' ') || undefined
}
const labelClass = 'text-sm font-medium text-foreground'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(
  ({ className, label, error, hint, success, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId(), inputId = id ?? generatedId, feedbackId = `${inputId}-feedback`
    return <div className="flex min-w-0 flex-col gap-2">
      {label && <label htmlFor={inputId} className={labelClass}>{label}</label>}
      <input ref={ref} id={inputId} className={cn('field-control', success && 'border-green-600', className)} {...props}
        aria-invalid={error ? true : invalid} aria-describedby={descriptionIds(describedBy, feedbackId, !!(error || hint || success))} />
      <FieldFeedback id={feedbackId} error={error} hint={hint} success={success} />
    </div>
  }
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps>(
  ({ className, label, error, hint, success, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId(), inputId = id ?? generatedId, feedbackId = `${inputId}-feedback`
    return <div className="flex min-w-0 flex-col gap-2">
      {label && <label htmlFor={inputId} className={labelClass}>{label}</label>}
      <textarea ref={ref} id={inputId} className={cn('field-control min-h-28 resize-y', success && 'border-green-600', className)} {...props}
        aria-invalid={error ? true : invalid} aria-describedby={descriptionIds(describedBy, feedbackId, !!(error || hint || success))} />
      <FieldFeedback id={feedbackId} error={error} hint={hint} success={success} />
    </div>
  }
)
Textarea.displayName = 'Textarea'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & FieldProps & { options: { value: string; label: string }[] }>(
  ({ className, label, error, hint, success, options, id, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }, ref) => {
    const generatedId = useId(), inputId = id ?? generatedId, feedbackId = `${inputId}-feedback`
    return <div className="flex min-w-0 flex-col gap-2">
      {label && <label htmlFor={inputId} className={labelClass}>{label}</label>}
      <select ref={ref} id={inputId} className={cn('field-control', success && 'border-green-600', className)} {...props}
        aria-invalid={error ? true : invalid} aria-describedby={descriptionIds(describedBy, feedbackId, !!(error || hint || success))}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <FieldFeedback id={feedbackId} error={error} hint={hint} success={success} />
    </div>
  }
)
Select.displayName = 'Select'

function Choice({ label, error, hint, success, id, className, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & FieldProps & { type: 'checkbox' | 'radio' }) {
  const generatedId = useId(), inputId = id ?? generatedId, feedbackId = `${inputId}-feedback`
  return <div className="min-w-0">
    <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-foreground">
      <input id={inputId} className={cn('h-5 w-5 shrink-0 accent-brand disabled:cursor-not-allowed', className)} {...props}
        aria-invalid={error ? true : invalid} aria-describedby={descriptionIds(describedBy, feedbackId, !!(error || hint || success))} />
      {label && <span>{label}</span>}
    </label>
    <FieldFeedback id={feedbackId} error={error} hint={hint} success={success} />
  </div>
}
export function Checkbox(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps) { return <Choice {...props} type="checkbox" /> }
export function Radio(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps) { return <Choice {...props} type="radio" /> }
