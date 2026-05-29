'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export const CATEGORY_OPTIONS = [
  { value: 'fitness',          label: 'Fitness' },
  { value: 'ernaehrung',       label: 'Ernährung' },
  { value: 'mental',           label: 'Mental Health' },
  { value: 'abnehmen',         label: 'Abnehmen' },
  { value: 'schlaf',           label: 'Schlaf' },
  { value: 'yoga',             label: 'Yoga' },
  { value: 'pilates',          label: 'Pilates' },
  { value: 'laufen',           label: 'Laufen' },
  { value: 'krafttraining',    label: 'Krafttraining' },
  { value: 'muskelaufbau',     label: 'Muskelaufbau' },
  { value: 'meditation',       label: 'Meditation' },
  { value: 'stressmanagement', label: 'Stressmanagement' },
  { value: 'rueckenschmerzen', label: 'Rückenschmerzen' },
  { value: 'schwangerschaft',  label: 'Schwangerschaft & Postnatal' },
  { value: 'mobility',         label: 'Mobility & Dehnen' },
]

interface CategoryPickerProps {
  selected: string[]
  onChange: (categories: string[]) => void
  error?: string
  label?: string
}

export function CategoryPicker({ selected, onChange, error, label = 'Kategorien' }: CategoryPickerProps) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value]
    )
  }

  return (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-2">{label}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {CATEGORY_OPTIONS.map(cat => {
          const active = selected.includes(cat.value)
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => toggle(cat.value)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-sm font-medium text-left transition-all duration-150',
                active
                  ? 'border-green-600 bg-green-50 text-green-800'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50',
              )}
            >
              {active && <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />}
              <span className="leading-tight">{cat.label}</span>
            </button>
          )
        })}
      </div>
      {error
        ? <p className="text-xs text-red-600 mt-1.5">{error}</p>
        : <p className="text-xs text-gray-400 mt-1.5">Wähle eine oder mehrere Kategorien</p>
      }
    </div>
  )
}
