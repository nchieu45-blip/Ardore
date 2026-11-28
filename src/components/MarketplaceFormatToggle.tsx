'use client'

import { useId } from 'react'
import { FORMAT_OPTIONS, type MarketplaceFormat } from '@/lib/marketplaceFilters'

export default function MarketplaceFormatToggle({ value, onChange }: {
  value: MarketplaceFormat
  onChange: (format: MarketplaceFormat) => void
}) {
  const name = useId()

  return (
    <fieldset className="marketplace-format">
      <legend className="sr-only">Coaching-Format</legend>
      <div className="marketplace-format-options">
        {FORMAT_OPTIONS.map(({ key, label }) => (
          <label key={key}>
            <input className="sr-only" type="radio" name={name} value={key}
              checked={value === key} onChange={() => onChange(key)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
