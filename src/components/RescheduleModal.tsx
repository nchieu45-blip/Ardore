'use client'

import { useState, useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface Props {
  bookingId: string
  creatorId: string
  coachName: string
  onClose: () => void
  onSuccess: () => void
}

const MONTH_LABELS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function toYMD(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function RescheduleModal({ bookingId, creatorId, onClose, onSuccess }: Props) {
  const today = new Date()
  const [year,      setYear]      = useState(today.getFullYear())
  const [month,     setMonth]     = useState(today.getMonth())
  const [availDays, setAvailDays] = useState<string[]>([])
  const [daysLoading, setDaysLoading] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [slots,       setSlots]       = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setDaysLoading(true)
    setAvailDays([])
    setSelectedDate(null)
    setSlots([])
    setSelectedSlot(null)
    fetch(`/api/coaching/available-days?creatorId=${creatorId}&year=${year}&month=${month + 1}`)
      .then(r => r.json())
      .then((d: { days?: string[] }) => setAvailDays(d.days ?? []))
      .catch(() => {})
      .finally(() => setDaysLoading(false))
  }, [creatorId, year, month])

  useEffect(() => {
    if (!selectedDate) { setSlots([]); return }
    setSlotsLoading(true)
    setSlots([])
    setSelectedSlot(null)
    fetch(`/api/coaching/slots?creatorId=${creatorId}&date=${selectedDate}`)
      .then(r => r.json())
      .then((d: { slots?: string[] }) => setSlots(d.slots ?? []))
      .catch(() => {})
      .finally(() => setSlotsLoading(false))
  }, [creatorId, selectedDate])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleSubmit() {
    if (!selectedDate || !selectedSlot) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/coaching/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, newDate: selectedDate, newTime: selectedSlot }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Fehler beim Verschieben'); return }
      onSuccess()
    } finally {
      setSubmitting(false)
    }
  }

  // Build calendar grid (Monday-first)
  const firstDay  = new Date(year, month, 1)
  const lastDay   = new Date(year, month + 1, 0)
  // Offset: Mon=0 … Sun=6
  const startOffset = (firstDay.getDay() + 6) % 7
  const cells: (number | null)[] = [
    ...Array<null>(startOffset).fill(null),
    ...Array.from({ length: lastDay.getDate() }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const isPrevDisabled = year === today.getFullYear() && month === today.getMonth()

  function prevMonth() {
    if (isPrevDisabled) return
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Session verschieben</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Calendar */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <button onClick={prevMonth} disabled={isPrevDisabled} className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                <ChevronLeft className="h-4 w-4 text-gray-600" />
              </button>
              <span className="text-sm font-semibold text-gray-900">
                {MONTH_LABELS[month]} {year}
              </span>
              <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <ChevronRight className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {DAY_LABELS.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
              ))}
            </div>

            {daysLoading ? (
              <div className="h-32 flex items-center justify-center">
                <Loader2 className="h-5 w-5 text-green-600 animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-0.5">
                {cells.map((day, idx) => {
                  if (!day) return <div key={idx} />
                  const dateStr  = toYMD(new Date(year, month, day))
                  const isPast   = new Date(year, month, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
                  const hasSlots = availDays.includes(dateStr)
                  const isSel    = dateStr === selectedDate
                  return (
                    <button
                      key={idx}
                      disabled={isPast || !hasSlots}
                      onClick={() => setSelectedDate(dateStr)}
                      className={[
                        'relative aspect-square flex flex-col items-center justify-center rounded-xl text-sm font-medium transition-all',
                        isSel
                          ? 'bg-green-600 text-white shadow-sm'
                          : hasSlots && !isPast
                            ? 'hover:bg-green-50 text-gray-900 cursor-pointer'
                            : 'text-gray-300 cursor-not-allowed',
                      ].join(' ')}
                    >
                      {day}
                      {hasSlots && !isPast && !isSel && (
                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-green-500" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Slot picker */}
          {selectedDate && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Uhrzeit wählen</p>
              {slotsLoading ? (
                <div className="h-16 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 text-green-600 animate-spin" />
                </div>
              ) : slots.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">Keine freien Slots an diesem Tag.</p>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {slots.map(s => (
                    <button
                      key={s}
                      onClick={() => setSelectedSlot(s)}
                      className={[
                        'py-2 rounded-xl text-sm font-medium border transition-all',
                        selectedSlot === s
                          ? 'bg-green-600 text-white border-green-600 shadow-sm'
                          : 'border-gray-200 text-gray-700 hover:border-green-400 hover:bg-green-50',
                      ].join(' ')}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-2.5">{error}</p>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!selectedDate || !selectedSlot || submitting}
            className="w-full"
          >
            {submitting ? 'Wird verschoben…' : 'Neuen Termin bestätigen'}
          </Button>
        </div>
      </div>
    </div>
  )
}
