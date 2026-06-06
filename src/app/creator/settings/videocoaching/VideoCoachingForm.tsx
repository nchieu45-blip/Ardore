'use client'

import { useState } from 'react'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Video, Plus, Trash2, Clock, Euro, ToggleLeft, ToggleRight,
  CalendarX, CalendarCheck, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABELS: Record<number, string> = {
  0: 'Sonntag', 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch',
  4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag',
}
const DURATIONS = [30, 45, 60, 90]
const BUFFERS   = [
  { value: 0,  label: 'Kein Puffer' },
  { value: 15, label: '15 Min' },
  { value: 30, label: '30 Min' },
]
const NOTICE_OPTIONS = [
  { value: 0,  label: 'Sofort buchbar' },
  { value: 1,  label: '1 Stunde vorher' },
  { value: 2,  label: '2 Stunden vorher' },
  { value: 4,  label: '4 Stunden vorher' },
  { value: 8,  label: '8 Stunden vorher' },
  { value: 12, label: '12 Stunden vorher' },
  { value: 24, label: '24 Stunden vorher' },
  { value: 48, label: '48 Stunden vorher' },
]
const HORIZON_OPTIONS = [
  { value: 14, label: '2 Wochen' },
  { value: 30, label: '1 Monat' },
  { value: 60, label: '2 Monate' },
  { value: 90, label: '3 Monate' },
]

interface InitialOffer {
  is_enabled:       boolean
  price_cents:      number
  duration_minutes: number
  description:      string | null
  buffer_minutes:   number
  min_notice_hours: number
  max_horizon_days: number
}

interface RecurringSlot {
  day_of_week: number
  start_time: string
  end_time: string
}

interface DateOverride {
  date:       string
  type:       'available' | 'unavailable'
  start_time: string | null
  end_time:   string | null
}

interface Props {
  initialOffer:         InitialOffer | null
  initialSlots:         RecurringSlot[]
  initialDateOverrides: DateOverride[]
}

type DayWindow = { start: string; end: string }
type WeeklyAvail = { [day: number]: DayWindow[] }

function initWeekly(slots: RecurringSlot[]): WeeklyAvail {
  const result: WeeklyAvail = {}
  for (const s of slots) {
    if (!result[s.day_of_week]) result[s.day_of_week] = []
    result[s.day_of_week].push({ start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) })
  }
  return result
}

function weeklyToSlots(weekly: WeeklyAvail): RecurringSlot[] {
  return Object.entries(weekly).flatMap(([day, windows]) =>
    windows.map(w => ({
      day_of_week: Number(day),
      start_time:  w.start,
      end_time:    w.end,
    }))
  )
}

export default function VideoCoachingForm({ initialOffer, initialSlots, initialDateOverrides }: Props) {
  const [enabled,       setEnabled]      = useState(initialOffer?.is_enabled ?? false)
  const [priceCents,    setPriceCents]   = useState(String(Math.round((initialOffer?.price_cents ?? 8000) / 100)))
  const [duration,      setDuration]     = useState(initialOffer?.duration_minutes ?? 60)
  const [description,   setDescription] = useState(initialOffer?.description ?? '')
  const [bufferMin,     setBufferMin]   = useState(initialOffer?.buffer_minutes ?? 0)
  const [noticeHrs,     setNoticeHrs]   = useState(initialOffer?.min_notice_hours ?? 24)
  const [horizonDays,   setHorizonDays] = useState(initialOffer?.max_horizon_days ?? 60)
  const [weekly,        setWeekly]      = useState<WeeklyAvail>(() => initWeekly(initialSlots))
  const [overrides,     setOverrides]   = useState<DateOverride[]>(initialDateOverrides)
  const [saving,        setSaving]      = useState(false)

  // New override form state
  const [newDate,      setNewDate]      = useState('')
  const [newType,      setNewType]      = useState<'unavailable' | 'available'>('unavailable')
  const [newAllDay,    setNewAllDay]    = useState(true)
  const [newStart,     setNewStart]     = useState('09:00')
  const [newEnd,       setNewEnd]       = useState('17:00')
  const [showAddOverride, setShowAddOverride] = useState(false)

  // ── Weekly availability helpers ──────────────────────────────────────────
  function isDayEnabled(day: number) {
    return (weekly[day]?.length ?? 0) > 0
  }

  function toggleDay(day: number) {
    setWeekly(prev => {
      const next = { ...prev }
      if (isDayEnabled(day)) {
        delete next[day]
      } else {
        next[day] = [{ start: '09:00', end: '17:00' }]
      }
      return next
    })
  }

  function addWindow(day: number) {
    setWeekly(prev => ({
      ...prev,
      [day]: [...(prev[day] ?? []), { start: '09:00', end: '17:00' }],
    }))
  }

  function removeWindow(day: number, idx: number) {
    setWeekly(prev => {
      const windows = (prev[day] ?? []).filter((_, i) => i !== idx)
      const next = { ...prev }
      if (windows.length === 0) delete next[day]
      else next[day] = windows
      return next
    })
  }

  function updateWindow(day: number, idx: number, key: 'start' | 'end', value: string) {
    setWeekly(prev => ({
      ...prev,
      [day]: (prev[day] ?? []).map((w, i) => i === idx ? { ...w, [key]: value } : w),
    }))
  }

  // ── Date override helpers ────────────────────────────────────────────────
  function addOverride() {
    if (!newDate) return
    const override: DateOverride = {
      date:       newDate,
      type:       newType,
      start_time: newAllDay ? null : newStart,
      end_time:   newAllDay ? null : newEnd,
    }
    setOverrides(prev => [...prev.filter(o => o.date !== newDate || o.type !== newType), override])
    setNewDate('')
    setShowAddOverride(false)
  }

  function removeOverride(idx: number) {
    setOverrides(prev => prev.filter((_, i) => i !== idx))
  }

  // ── Save ─────────────────────────────────────────────────────────────────
  async function save() {
    setSaving(true)
    try {
      const priceNum = parseFloat(priceCents.replace(',', '.'))
      if (isNaN(priceNum) || priceNum < 0) { toast.error('Ungültiger Preis'); return }

      const [offerRes, availRes] = await Promise.all([
        fetch('/api/coaching/offer', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            is_enabled:       enabled,
            price_cents:      Math.round(priceNum * 100),
            duration_minutes: duration,
            description:      description.trim() || null,
            buffer_minutes:   bufferMin,
            min_notice_hours: noticeHrs,
            max_horizon_days: horizonDays,
          }),
        }),
        fetch('/api/coaching/availability', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            slots:         weeklyToSlots(weekly),
            dateOverrides: overrides,
          }),
        }),
      ])

      if (!offerRes.ok || !availRes.ok) {
        const err = await offerRes.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Fehler beim Speichern')
      }
      toast.success('Videocoaching-Einstellungen gespeichert')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern')
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400 disabled:cursor-not-allowed'
  const selectClass = cn(inputClass, 'appearance-none pr-8')

  return (
    <div className="space-y-6">
      {/* ── Enable/disable ─────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 p-5 rounded-2xl border border-gray-100 bg-white shadow-sm">
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
            : <ToggleLeft  className="h-9 w-9 text-gray-300" />}
        </button>
      </div>

      <div className={cn('space-y-6 transition-opacity duration-200', !enabled && 'opacity-40 pointer-events-none')}>
        {/* ── Session settings ───────────────────────────── */}
        <div className="p-5 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-5">
          <h3 className="font-semibold text-gray-900 text-sm">Session-Details</h3>
          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Preis pro Session</label>
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
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Sitzungsdauer</label>
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Beschreibung (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Was erwartet die Kunden in der Session?"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 transition-colors hover:border-gray-400 resize-none"
            />
          </div>
        </div>

        {/* ── Booking rules ──────────────────────────────── */}
        <div className="p-5 rounded-2xl border border-gray-100 bg-white shadow-sm space-y-4">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-1.5">
            <Clock className="h-4 w-4 text-gray-500" />
            Buchungsregeln
          </h3>
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Puffer zwischen Sessions</label>
              <div className="relative">
                <select
                  value={bufferMin}
                  onChange={e => setBufferMin(Number(e.target.value))}
                  className={cn(selectClass, 'w-full')}
                >
                  {BUFFERS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Mindest-Vorlaufzeit</label>
              <div className="relative">
                <select
                  value={noticeHrs}
                  onChange={e => setNoticeHrs(Number(e.target.value))}
                  className={cn(selectClass, 'w-full')}
                >
                  {NOTICE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Buchbar bis zu</label>
              <div className="relative">
                <select
                  value={horizonDays}
                  onChange={e => setHorizonDays(Number(e.target.value))}
                  className={cn(selectClass, 'w-full')}
                >
                  {HORIZON_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Weekly availability ─────────────────────────── */}
        <div className="p-5 rounded-2xl border border-gray-100 bg-white shadow-sm">
          <h3 className="font-semibold text-gray-900 text-sm mb-1">Wöchentliche Verfügbarkeit</h3>
          <p className="text-xs text-gray-400 mb-4">Zeitfenster, in denen Kunden Termine buchen können (Berlin-Zeit).</p>

          <div className="space-y-2">
            {DAY_ORDER.map(day => {
              const enabled = isDayEnabled(day)
              const windows = weekly[day] ?? []
              return (
                <div key={day} className={cn(
                  'rounded-xl border transition-colors',
                  enabled ? 'border-green-200 bg-green-50/30' : 'border-gray-100 bg-gray-50/30'
                )}>
                  {/* Day header row */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => toggleDay(day)}
                      className={cn(
                        'w-10 h-5 rounded-full transition-colors relative flex-shrink-0',
                        enabled ? 'bg-green-500' : 'bg-gray-200'
                      )}
                      aria-label={`${DAY_LABELS[day]} ${enabled ? 'deaktivieren' : 'aktivieren'}`}
                    >
                      <span className={cn(
                        'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                        enabled ? 'translate-x-5' : 'translate-x-0.5'
                      )} />
                    </button>
                    <span className={cn(
                      'text-sm font-medium w-24',
                      enabled ? 'text-gray-900' : 'text-gray-400'
                    )}>
                      {DAY_LABELS[day]}
                    </span>
                    {!enabled && (
                      <span className="text-xs text-gray-400">Nicht verfügbar</span>
                    )}
                  </div>

                  {/* Time windows */}
                  {enabled && (
                    <div className="px-4 pb-3 space-y-2">
                      {windows.map((w, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={w.start}
                            onChange={e => updateWindow(day, idx, 'start', e.target.value)}
                            className={cn(inputClass, 'w-28')}
                          />
                          <span className="text-gray-400 text-sm">–</span>
                          <input
                            type="time"
                            value={w.end}
                            onChange={e => updateWindow(day, idx, 'end', e.target.value)}
                            className={cn(inputClass, 'w-28')}
                          />
                          <button
                            onClick={() => removeWindow(day, idx)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addWindow(day)}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium mt-1 transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Zeitfenster hinzufügen
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Date exceptions ────────────────────────────── */}
        <div className="p-5 rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-semibold text-gray-900 text-sm">Datum-Ausnahmen</h3>
            <button
              onClick={() => setShowAddOverride(v => !v)}
              className="flex items-center gap-1 text-xs text-green-600 hover:text-green-700 font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Ausnahme hinzufügen
            </button>
          </div>
          <p className="text-xs text-gray-400 mb-4">Einzelne Tage sperren oder extra Verfügbarkeit hinzufügen.</p>

          {showAddOverride && (
            <div className="mb-4 p-4 rounded-xl border border-dashed border-green-300 bg-green-50/30 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
                  <input
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                    className={cn(inputClass, 'w-full')}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Art</label>
                  <div className="relative">
                    <select
                      value={newType}
                      onChange={e => setNewType(e.target.value as 'unavailable' | 'available')}
                      className={cn(selectClass, 'w-full')}
                    >
                      <option value="unavailable">Gesperrt</option>
                      <option value="available">Extra verfügbar</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                  </div>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={newAllDay}
                  onChange={e => setNewAllDay(e.target.checked)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-400"
                />
                Ganztägig
              </label>
              {!newAllDay && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={newStart}
                    onChange={e => setNewStart(e.target.value)}
                    className={cn(inputClass, 'w-28')}
                  />
                  <span className="text-gray-400 text-sm">–</span>
                  <input
                    type="time"
                    value={newEnd}
                    onChange={e => setNewEnd(e.target.value)}
                    className={cn(inputClass, 'w-28')}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAddOverride(false)} className="flex-1">
                  Abbrechen
                </Button>
                <Button size="sm" onClick={addOverride} disabled={!newDate} className="flex-1">
                  Hinzufügen
                </Button>
              </div>
            </div>
          )}

          {overrides.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Keine Ausnahmen eingetragen.</p>
          ) : (
            <div className="space-y-2">
              {overrides
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((ov, idx) => (
                  <div key={idx} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-gray-100 bg-gray-50/50">
                    {ov.type === 'unavailable'
                      ? <CalendarX  className="h-4 w-4 text-red-400 flex-shrink-0" />
                      : <CalendarCheck className="h-4 w-4 text-green-500 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-gray-800">
                        {new Date(ov.date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                      </span>
                      <span className={cn(
                        'ml-2 text-xs font-medium px-1.5 py-0.5 rounded',
                        ov.type === 'unavailable' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'
                      )}>
                        {ov.type === 'unavailable' ? 'Gesperrt' : 'Extra verfügbar'}
                      </span>
                      {ov.start_time && (
                        <span className="ml-2 text-xs text-gray-500">
                          {ov.start_time.slice(0, 5)}–{ov.end_time?.slice(0, 5)}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeOverride(idx)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={save} disabled={saving} className="min-w-32">
          {saving ? 'Speichere…' : 'Speichern'}
        </Button>
      </div>
    </div>
  )
}
