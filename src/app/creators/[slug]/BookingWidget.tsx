'use client'

import { useState, useEffect, useCallback } from 'react'
import { Video, Calendar, Clock, ChevronLeft, ChevronRight, CheckCircle2, Loader2, Tag, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn, formatCurrency } from '@/lib/utils'

interface SubscriberSessions {
  subscriptionId: string
  remaining: number
  total: number
  period: 'week' | 'month'
  sessionDurationMinutes: number | null
}

interface Props {
  creatorId: string
  offer: {
    price_cents: number
    duration_minutes: number
    description: string | null
  }
  currentUserEmail?: string | null
  currentUserName?: string | null
  subscriberSessions?: SubscriberSessions | null
}

type Step = 'date' | 'time' | 'form' | 'success'

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
const DAY_SHORT   = ['So','Mo','Di','Mi','Do','Fr','Sa']

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function buildCalendarDays(year: number, month: number) {
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return { firstDay, daysInMonth }
}

export default function BookingWidget({ creatorId, offer, currentUserEmail, currentUserName, subscriberSessions }: Props) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [calYear,  setCalYear]  = useState(today.getFullYear())
  const [calMonth, setCalMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState<Date | null>(null)
  const [slots,    setSlots]    = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [chosenSlot,   setChosenSlot]   = useState<string | null>(null)
  const [step,    setStep]    = useState<Step>('date')
  const [name,    setName]    = useState(currentUserName ?? '')
  const [email,   setEmail]   = useState(currentUserEmail ?? '')
  const [notes,   setNotes]   = useState('')
  const [booking, setBooking] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(null)

  // Discount state (only for paid sessions)
  const [showCodeInput,  setShowCodeInput]  = useState(false)
  const [discountCode,   setDiscountCode]   = useState('')
  const [discount,       setDiscount]       = useState<{ id: string; code: string | null; type: 'percent' | 'fixed'; value: number; savingsCents: number } | null>(null)
  const [discountError,  setDiscountError]  = useState('')
  const [discountLoading,setDiscountLoading]= useState(false)

  // Days with at least one available slot in the current month view
  const [availableDays, setAvailableDays] = useState<Set<number>>(new Set())
  const [daysLoading,   setDaysLoading]   = useState(false)

  const fetchAvailableDays = useCallback(async (year: number, month: number) => {
    setDaysLoading(true)
    try {
      const res  = await fetch(`/api/coaching/available-days?creatorId=${creatorId}&year=${year}&month=${month}`)
      const json = await res.json() as { days: number[] }
      setAvailableDays(new Set(json.days ?? []))
    } catch {
      setAvailableDays(new Set())
    } finally {
      setDaysLoading(false)
    }
  }, [creatorId])

  useEffect(() => {
    fetchAvailableDays(calYear, calMonth) // eslint-disable-line react-hooks/set-state-in-effect
  }, [calYear, calMonth, fetchAvailableDays])

  async function fetchSlots(date: Date) {
    setSlotsLoading(true)
    setSlots([])
    try {
      const res  = await fetch(`/api/coaching/slots?creatorId=${creatorId}&date=${formatDate(date)}`)
      const json = await res.json() as { slots: string[] }
      setSlots(json.slots ?? [])
    } catch {
      setSlots([])
    } finally {
      setSlotsLoading(false)
    }
  }

  function selectDate(date: Date) {
    setSelected(date)
    setChosenSlot(null)
    setStep('time')
    fetchSlots(date)
  }

  function prevMonth() {
    if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) }
    else setCalMonth(m => m + 1)
  }

  const useSubscription   = !!subscriberSessions && subscriberSessions.remaining > 0
  const price             = (offer.price_cents / 100).toFixed(2).replace('.', ',')
  const displayDuration   = useSubscription && subscriberSessions!.sessionDurationMinutes !== null
    ? subscriberSessions!.sessionDurationMinutes
    : offer.duration_minutes

  async function validateDiscountCode() {
    const trimmed = discountCode.trim().toUpperCase()
    if (!trimmed) return
    setDiscountLoading(true)
    setDiscountError('')
    try {
      const res = await fetch(
        `/api/discounts/validate?creatorId=${creatorId}&type=sessions&code=${encodeURIComponent(trimmed)}&amount=${offer.price_cents}`
      )
      const d = await res.json() as {
        valid: boolean
        discount?: { id: string; code: string | null; type: 'percent' | 'fixed'; value: number }
        savingsCents?: number
        error?: string
      }
      if (d.valid && d.discount) {
        setDiscount({ ...d.discount, savingsCents: d.savingsCents ?? 0 })
      } else {
        setDiscountError(d.error ?? 'Ungültiger Code')
        setDiscount(null)
      }
    } catch {
      setDiscountError('Netzwerkfehler beim Prüfen')
    } finally {
      setDiscountLoading(false)
    }
  }

  const finalPriceCents = discount ? Math.max(0, offer.price_cents - discount.savingsCents) : offer.price_cents

  async function book() {
    if (!selected || !chosenSlot || !name.trim() || !email.trim()) return
    setBooking(true)
    try {
      const res  = await fetch('/api/coaching/book', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          date:           formatDate(selected),
          time:           chosenSlot,
          name:           name.trim(),
          email:          email.trim(),
          notes:          notes.trim() || null,
          subscriptionId: useSubscription ? subscriberSessions!.subscriptionId : undefined,
          discountId:     !useSubscription && discount ? discount.id : undefined,
        }),
      })
      if (res.status === 401) { window.location.assign('/login?redirect=' + encodeURIComponent(window.location.pathname)); return }
      const json = await res.json() as { bookingId?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Buchungsfehler')
      setBookingId(json.bookingId ?? null)
      setStep('success')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Buchungsfehler')
    } finally {
      setBooking(false)
    }
  }

  const { firstDay, daysInMonth } = buildCalendarDays(calYear, calMonth)
  const canPrevMonth = calYear > today.getFullYear() || calMonth > today.getMonth()

  // Max date is enforced server-side; we just need to keep today as minimum
  function isDayPast(day: number) {
    const d = new Date(calYear, calMonth, day)
    d.setHours(0, 0, 0, 0)
    return d < today
  }

  return (
    <div className="rounded-2xl border-2 border-green-200 bg-white overflow-hidden shadow-sm" data-booking-widget>
      {/* Header */}
      <div className="bg-gradient-to-br from-green-600 to-emerald-600 px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Video className="h-4.5 w-4.5 text-white" />
          <h3 className="font-bold text-white">1:1 Videocoaching</h3>
        </div>
        <div className="flex items-center gap-3 text-green-100 text-sm flex-wrap">
          {useSubscription ? (
            <span className="font-semibold text-white text-base">
              Kostenlos
              <span className="ml-1.5 text-xs font-normal text-green-100/70">
                ({subscriberSessions!.remaining} von {subscriberSessions!.total} Session{subscriberSessions!.total !== 1 ? 's' : ''}{' '}
                {subscriberSessions!.period === 'week' ? 'diese Woche' : 'diesen Monat'} verbleibend)
              </span>
            </span>
          ) : discount ? (
            <span className="font-semibold text-white text-lg">
              <span className="line-through opacity-60 mr-1.5 text-base">{price} €</span>
              {formatCurrency(finalPriceCents / 100)}
            </span>
          ) : (
            <span className="font-semibold text-white text-lg">{price} €</span>
          )}
          <span>·</span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {displayDuration} Min
          </span>
        </div>
        {offer.description && (
          <p className="text-green-100/80 text-xs mt-2 leading-relaxed">{offer.description}</p>
        )}
      </div>

      <div className="p-5">
        {step === 'success' ? (
          <div className="text-center py-4">
            <div className="h-14 w-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <p className="font-bold text-gray-900 mb-1">Buchung bestätigt!</p>
            <p className="text-sm text-gray-500 mb-1">
              Du erhältst eine Bestätigung an <strong>{email}</strong>.
            </p>
            <p className="text-sm text-gray-500">
              Der Videoraum-Link wird kurz vor der Session per E-Mail zugesendet.
            </p>
            {bookingId && (
              <a
                href={`/session/${bookingId}`}
                className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-green-600 hover:text-green-700"
              >
                <Video className="h-4 w-4" />
                Session-Seite öffnen
              </a>
            )}
          </div>
        ) : step === 'date' || step === 'time' ? (
          <>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-3">
                {step === 'time' ? (
                  <button
                    onClick={() => { setStep('date'); setSelected(null); setSlots([]) }}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Datum ändern
                  </button>
                ) : (
                  <span className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-green-600" />
                    Datum wählen
                  </span>
                )}
                {step === 'date' && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={prevMonth}
                      disabled={!canPrevMonth}
                      className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-500" />
                    </button>
                    <span className="text-sm font-medium text-gray-700 min-w-28 text-center">
                      {MONTH_NAMES[calMonth]} {calYear}
                    </span>
                    <button
                      onClick={nextMonth}
                      className="p-1 rounded hover:bg-gray-100 transition-colors"
                    >
                      <ChevronRight className="h-4 w-4 text-gray-500" />
                    </button>
                  </div>
                )}
              </div>

              {step === 'date' ? (
                <>
                  <div className="grid grid-cols-7 mb-1">
                    {DAY_SHORT.map(d => (
                      <div key={d} className="text-center text-[10px] font-medium text-gray-400 py-1">{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                      const past       = isDayPast(day)
                      const hasSlots   = !past && availableDays.has(day)
                      const noSlots    = !past && !daysLoading && !availableDays.has(day)
                      const d          = new Date(calYear, calMonth, day)
                      const isSelected = selected && formatDate(d) === formatDate(selected)
                      const disabled   = past || (!daysLoading && noSlots)

                      return (
                        <button
                          key={day}
                          disabled={disabled}
                          onClick={() => !disabled && selectDate(d)}
                          className={cn(
                            'aspect-square flex flex-col items-center justify-center text-sm rounded-lg transition-all font-medium relative',
                            past          ? 'text-gray-200 cursor-not-allowed' :
                            isSelected    ? 'bg-green-600 text-white' :
                            hasSlots      ? 'text-gray-800 hover:bg-green-50 hover:text-green-700' :
                            daysLoading   ? 'text-gray-300' :
                            'text-gray-200 cursor-not-allowed'
                          )}
                        >
                          {day}
                          {hasSlots && !isSelected && (
                            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-500" />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {daysLoading && (
                    <div className="flex items-center justify-center gap-1.5 mt-2 text-xs text-gray-400">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Verfügbarkeit wird geladen…
                    </div>
                  )}
                </>
              ) : (
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-green-600" />
                    {selected?.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
                  </p>
                  {slotsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 text-green-600 animate-spin" />
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="text-center py-6">
                      <p className="text-sm text-gray-500 mb-2">Keine freien Termine an diesem Tag.</p>
                      <button
                        onClick={() => { setStep('date'); setSelected(null) }}
                        className="text-sm text-green-600 hover:text-green-700 font-medium"
                      >
                        Anderen Tag wählen
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {slots.map(slot => (
                        <button
                          key={slot}
                          onClick={() => { setChosenSlot(slot); setStep('form') }}
                          className={cn(
                            'py-2.5 rounded-xl text-sm font-medium border transition-all',
                            chosenSlot === slot
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-green-400 hover:text-green-700'
                          )}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-1.5 text-sm text-gray-500 mb-1">
              <button
                onClick={() => setStep('time')}
                className="flex items-center gap-1 hover:text-gray-700 transition-colors"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Zurück
              </button>
              <span>·</span>
              <span className="font-medium text-gray-700">
                {selected?.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} um {chosenSlot} Uhr
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Dein Name" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail *</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="deine@email.de" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nachricht / Ziele (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Was möchtest du in der Session erreichen?"
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 transition-colors hover:border-gray-400 resize-none"
              />
            </div>

            {/* Discount code — only for paid sessions */}
            {!useSubscription && (
              <div className="space-y-1.5">
                {discount ? (
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-green-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Code <strong>{discount.code}</strong> – {formatCurrency(discount.savingsCents / 100)} Rabatt</span>
                    </div>
                    <button
                      onClick={() => { setDiscount(null); setDiscountCode(''); setShowCodeInput(false) }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      Entfernen
                    </button>
                  </div>
                ) : showCodeInput ? (
                  <div className="space-y-1.5">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Tag className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                        <input
                          value={discountCode}
                          onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountError('') }}
                          onKeyDown={e => e.key === 'Enter' && validateDiscountCode()}
                          placeholder="Gutscheincode"
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400 font-mono tracking-wider"
                        />
                      </div>
                      <button
                        onClick={validateDiscountCode}
                        disabled={!discountCode.trim() || discountLoading}
                        className="px-3 py-2 rounded-xl bg-gray-900 text-white text-xs font-medium hover:bg-gray-800 disabled:opacity-40 transition-colors flex items-center gap-1"
                      >
                        {discountLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Anwenden'}
                      </button>
                    </div>
                    {discountError && (
                      <div className="flex items-center gap-1.5 text-xs text-red-600">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {discountError}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCodeInput(true)}
                    className="w-full text-center text-xs text-gray-400 hover:text-green-600 transition-colors"
                  >
                    Gutscheincode vorhanden?
                  </button>
                )}
              </div>
            )}

            <Button
              onClick={book}
              disabled={booking || !name.trim() || !email.trim()}
              className="w-full gap-2"
            >
              {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
              {booking ? 'Wird gebucht…' : `Session ${useSubscription ? 'kostenlos buchen' : `für ${formatCurrency(finalPriceCents / 100)} buchen`}`}
            </Button>

            <p className="text-[11px] text-gray-400 text-center">
              Du erhältst sofort eine Bestätigungs-E-Mail.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
