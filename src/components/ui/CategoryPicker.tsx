'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ALL_CATEGORIES } from '@/lib/categories'
import { LANGUAGE_OPTIONS, MAX_COACH_LANGUAGES } from '@/lib/languages'

export const CATEGORY_OPTIONS = ALL_CATEGORIES.map(c => ({ value: c.key, label: c.label }))

export const SERVICE_OPTIONS = [
  { value: '1to1_coaching',   label: '1:1 Coaching' },
  { value: 'video_kurs',      label: 'Video Kurs' },
  { value: 'online_kurs',     label: 'Online Kurs' },
  { value: 'ernaehrungsplan', label: 'Ernährungsplan' },
  { value: 'trainingsplan',   label: 'Trainingsplan' },
  { value: 'gruppencoaching', label: 'Gruppencoaching' },
  { value: 'live_sessions',   label: 'Live Sessions' },
  { value: 'pdf_guide',       label: 'PDF Guide' },
]

interface ChipPickerProps {
  selected: string[]
  onChange: (values: string[]) => void
  error?: string
  label?: string
}

function ChipPicker({
  options,
  selected,
  onChange,
  error,
  label,
  hint,
  max,
}: ChipPickerProps & { options: { value: string; label: string }[]; hint: string; max?: number }) {
  function toggle(value: string) {
    const active = selected.includes(value)
    if (!active && max && selected.length >= max) return
    onChange(active ? selected.filter(v => v !== value) : [...selected, value])
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {options.map(opt => {
          const active = selected.includes(opt.value)
          const capped = !active && !!max && selected.length >= max
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              disabled={capped}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium text-left transition-all duration-150',
                active
                  ? 'border-green-600 bg-green-50 text-green-800'
                  : capped
                    ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
              )}
            >
              {active && <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />}
              <span className="leading-tight">{opt.label}</span>
            </button>
          )
        })}
      </div>
      {error
        ? <p className="text-xs text-red-600 mt-1.5">{error}</p>
        : <p className="text-xs text-gray-400 mt-1.5">{hint}</p>
      }
    </div>
  )
}

export function CategoryPicker({ selected, onChange, error, label = 'Kategorien' }: ChipPickerProps) {
  return (
    <ChipPicker
      options={CATEGORY_OPTIONS}
      selected={selected}
      onChange={onChange}
      error={error}
      label={label}
      hint="Wähle eine oder mehrere Kategorien"
    />
  )
}

export function ServicePicker({ selected, onChange, error, label = 'Dienstleistungen' }: ChipPickerProps) {
  return (
    <ChipPicker
      options={SERVICE_OPTIONS}
      selected={selected}
      onChange={onChange}
      error={error}
      label={label}
      hint="Wähle alle Dienstleistungen, die du anbietest"
    />
  )
}

export function LanguagePicker({ selected, onChange, error, label = 'Sprachen' }: ChipPickerProps) {
  return (
    <ChipPicker
      options={LANGUAGE_OPTIONS.map(l => ({ value: l.code, label: l.label }))}
      selected={selected}
      onChange={onChange}
      error={error}
      label={label}
      hint="Wähle die Sprachen, in denen du coachst."
      max={MAX_COACH_LANGUAGES}
    />
  )
}
