'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Video, Plus, Trash2, Clock, Euro, ToggleLeft, ToggleRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const DAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DURATIONS = [30, 45, 60, 90]

interface Slot {
  day_of_week: number
  start_time: string
  end_time: string
}

interface Props {
  initialOffer: {
    is_enabled: boolean
    price_cents: number
    duration_minutes: number
    description: string | null
  } | null
  initialSlots: Slot[]
}

export default function VideoCoachingForm({ initialOffer, initialSlots }: Props) {
  const [enabled,       setEnabled]       = useState(initialOffer?.is_enabled ?? false)
  const [priceCents,    setPriceCents]     = useState(String(Math.round((initialOffer?.price_cents ?? 8000) / 100)))
  const [duration,      setDuration]       = useState(initialOffer?.duration_minutes ?? 60)
  const [description,   setDescription]   = useState(initialOffer?.description ?? '')
  const [slots,         setSlots]          = useState<Slot[]>(initialSlots)
  const [saving,        setSaving]         = useState(false)

  function addSlot() {
    setSlots(prev => [...prev, { day_of_week: 1, start_time: '09:00', end_time: '17:00' }])
  }

  function removeSlot(i: number) {
    setSlots(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateSlot(i: number, key: keyof Slot, value: string | number) {
    setSlots(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: value } : s))
  }

  async function save() {
    setSaving(true)
    try {
      const priceNum = parseFloat(priceCents.replace(',', '.'))
      if (isNaN(priceNum) || priceNum < 0) {
        toast.error('Ungültiger Preis')
        return
      }

      const [offerRes, availRes] = await Promise.all([
        fetch('/api/coaching/offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled: enabled,
            price_cents: Math.round(priceNum * 100),
            duration_minutes: duration,
            description: description.trim() || null,
          }),
        }),
        fetch('/api/coaching/availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slots }),
        }),
      ])

      if (!offerRes.ok || !availRes.ok) {
        const err = await offerRes.json().catch(() => ({}))
        throw new Error(err.error ?? 'Fehler beim Speichern')
      }

      toast.success('Videocoaching-Einstellungen gespeichert')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Enable/disable toggle */}
      <div className="flex items-start justify-between gap-4 p-5 rounded-2xl border border-gray-100 bg-white">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Video className="h-5 w-5 text-green-600" />
            <h2 className="font-semibold text-gray-900">1:1 Videocoaching anbieten</h2>
          </div>
          <p className="text-sm text-gray-500">Kunden können direkt auf deinem Profil eine Session buchen.</p>
        </div>
        <button
          onClick={() => setEnabled(v => !v)}
          className="flex-shrink-0 transition-colors"
          aria-label={enabled ? 'Deaktivieren' : 'Aktivieren'}
        >
          {enabled
            ? <ToggleRight className="h-9 w-9 text-green-600" />
            : <ToggleLeft  className="h-9 w-9 text-gray-300" />
          }
        </button>
      </div>

      {/* Offer settings */}
      <div className={cn('space-y-6 transition-opacity duration-200', !enabled && 'opacity-40 pointer-events-none')}>
        <div className="grid sm:grid-cols-2 gap-5">
          {/* Price */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Preis pro Session
            </label>
            <div className="relative">
              <Euro className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <Input
                value={priceCents}
                onChange={e => setPriceCents(e.target.value)}
                placeholder="80"
                className="pl-9"
              />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Sitzungsdauer
            </label>
            <div className="flex gap-2">
              {DURATIONS.map(d => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={cn(
                    'flex-1 py-2 rounded-xl text-sm font-medium border transition-all',
                    duration === d
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  )}
                >
                  {d}m
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Beschreibung (optional)
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Was erwartet die Kunden in der Session? Worauf spezialisierst du dich?"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 transition-colors hover:border-gray-400 resize-none"
          />
        </div>

        {/* Availability slots */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-medium text-gray-900 text-sm flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-gray-500" />
                Verfügbarkeit (wöchentlich wiederkehrend)
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Zeitfenster, in denen Kunden buchen können.</p>
            </div>
            <Button variant="outline" size="sm" onClick={addSlot} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Slot hinzufügen
            </Button>
          </div>

          {slots.length === 0 ? (
            <div className="text-center py-8 rounded-2xl border-2 border-dashed border-gray-200">
              <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">Noch keine Zeitfenster. Klick auf „Slot hinzufügen".</p>
            </div>
          ) : (
            <div className="space-y-3">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 bg-gray-50/50">
                  <select
                    value={slot.day_of_week}
                    onChange={e => updateSlot(i, 'day_of_week', Number(e.target.value))}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  >
                    {DAY_LABELS.map((label, idx) => (
                      <option key={idx} value={idx}>{label}</option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={slot.start_time}
                    onChange={e => updateSlot(i, 'start_time', e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    value={slot.end_time}
                    onChange={e => updateSlot(i, 'end_time', e.target.value)}
                    className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                  <button
                    onClick={() => removeSlot(i)}
                    className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                    aria-label="Entfernen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={saving} className="min-w-32">
          {saving ? 'Speichere…' : 'Speichern'}
        </Button>
      </div>
    </div>
  )
}
