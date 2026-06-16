'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import { Plus, Trash2, Eye, EyeOff, Pencil, Video, Calendar, RefreshCw, Users, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { VideoClass } from '@/types'

const WEEKDAY_LABELS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const DURATION_OPTIONS = [30, 45, 60, 90]

function formatSchedule(vc: VideoClass): string {
  if (vc.schedule_type === 'once' && vc.starts_at) {
    const d = new Date(vc.starts_at)
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr'
  }
  if (vc.schedule_type === 'recurring' && vc.recurring_weekday !== null) {
    return `Jeden ${WEEKDAY_LABELS[vc.recurring_weekday]}, ${vc.recurring_time ?? ''} Uhr`
  }
  return '–'
}

interface FormState {
  title: string
  description: string
  scheduleType: 'once' | 'recurring'
  startsAt: string
  recurringWeekday: string
  recurringTime: string
  durationMinutes: number
  unlimited: boolean
  maxParticipantsStr: string
  priceEuros: string
  includedInSubscription: boolean
}

const INITIAL_FORM: FormState = {
  title: '', description: '',
  scheduleType: 'recurring',
  startsAt: '', recurringWeekday: '1', recurringTime: '18:00',
  durationMinutes: 60,
  unlimited: false, maxParticipantsStr: '20',
  priceEuros: '0',
  includedInSubscription: false,
}

function classToForm(vc: VideoClass): FormState {
  const startsAtLocal = vc.starts_at
    ? new Date(vc.starts_at).toISOString().slice(0, 16)
    : ''
  return {
    title:                  vc.title,
    description:            vc.description ?? '',
    scheduleType:           vc.schedule_type,
    startsAt:               startsAtLocal,
    recurringWeekday:       String(vc.recurring_weekday ?? 1),
    recurringTime:          vc.recurring_time ?? '18:00',
    durationMinutes:        vc.duration_minutes,
    unlimited:              vc.max_participants === null,
    maxParticipantsStr:     vc.max_participants !== null ? String(vc.max_participants) : '20',
    priceEuros:             (vc.price_cents / 100).toFixed(2),
    includedInSubscription: vc.included_in_subscription,
  }
}

export default function VideoClassesPage() {
  const [classes,           setClasses]           = useState<VideoClass[]>([])
  const [participantCounts, setParticipantCounts] = useState<Record<string, number>>({})
  const [loading,           setLoading]           = useState(true)
  const [showForm,          setShowForm]          = useState(false)
  const [editingId,         setEditingId]         = useState<string | null>(null)
  const [saving,            setSaving]            = useState(false)
  const [formError,         setFormError]         = useState('')
  const [form,              setForm]              = useState<FormState>(INITIAL_FORM)

  useEffect(() => {
    fetch('/api/video-classes')
      .then(r => r.json())
      .then(d => {
        setClasses(d.classes ?? [])
        setParticipantCounts(d.participantCounts ?? {})
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openCreate() {
    setForm(INITIAL_FORM)
    setEditingId(null)
    setFormError('')
    setShowForm(true)
  }

  function openEdit(vc: VideoClass) {
    setForm(classToForm(vc))
    setEditingId(vc.id)
    setFormError('')
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function resetForm() {
    setShowForm(false)
    setEditingId(null)
    setFormError('')
    setForm(INITIAL_FORM)
  }

  async function handleSave() {
    setFormError('')
    if (!form.title.trim()) { setFormError('Bitte einen Titel eingeben'); return }
    if (form.scheduleType === 'once' && !form.startsAt) { setFormError('Bitte Datum und Uhrzeit angeben'); return }
    if (form.scheduleType === 'recurring' && !form.recurringTime) { setFormError('Bitte eine Uhrzeit angeben'); return }
    if (!form.unlimited && (!form.maxParticipantsStr || parseInt(form.maxParticipantsStr, 10) < 1)) {
      setFormError('Bitte eine gültige Teilnehmerzahl eingeben'); return
    }

    const priceVal = parseFloat(form.priceEuros.replace(',', '.'))
    if (isNaN(priceVal) || priceVal < 0) { setFormError('Bitte einen gültigen Preis eingeben'); return }

    const body = {
      title:                    form.title.trim(),
      description:              form.description.trim() || null,
      schedule_type:            form.scheduleType,
      starts_at:                form.scheduleType === 'once' ? new Date(form.startsAt).toISOString() : null,
      recurring_weekday:        form.scheduleType === 'recurring' ? parseInt(form.recurringWeekday, 10) : null,
      recurring_time:           form.scheduleType === 'recurring' ? form.recurringTime : null,
      duration_minutes:         form.durationMinutes,
      max_participants:         form.unlimited ? null : parseInt(form.maxParticipantsStr, 10),
      price_cents:              Math.round(priceVal * 100),
      included_in_subscription: form.includedInSubscription,
    }

    setSaving(true)
    try {
      const url    = editingId ? `/api/video-classes/${editingId}` : '/api/video-classes'
      const method = editingId ? 'PATCH' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data   = await res.json() as { videoClass?: VideoClass; error?: string }
      if (!res.ok) { setFormError(data.error ?? 'Fehler beim Speichern'); return }
      if (editingId) {
        setClasses(prev => prev.map(c => c.id === editingId ? data.videoClass! : c))
      } else {
        setClasses(prev => [data.videoClass!, ...prev])
      }
      resetForm()
    } catch {
      setFormError('Netzwerkfehler')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(vc: VideoClass) {
    const res  = await fetch(`/api/video-classes/${vc.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ active: !vc.active }),
    })
    const data = await res.json() as { videoClass?: VideoClass }
    if (data.videoClass) setClasses(prev => prev.map(c => c.id === vc.id ? data.videoClass! : c))
  }

  async function handleDelete(id: string) {
    if (!confirm('Video-Kurs wirklich löschen?')) return
    await fetch(`/api/video-classes/${id}`, { method: 'DELETE' })
    setClasses(prev => prev.filter(c => c.id !== id))
    if (editingId === id) resetForm()
  }

  const inputCls  = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400'
  const selectCls = inputCls

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-8 text-gray-400">Lädt…</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Video Classes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gruppen-Videosessions für mehrere Teilnehmer gleichzeitig</p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Neuer Kurs
        </Button>
      </div>

      {/* Create / Edit form */}
      {showForm && (
        <Card className="mb-6 border-green-200">
          <CardHeader>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Video className="h-4 w-4 text-green-600" />
              {editingId ? 'Kurs bearbeiten' : 'Neuen Kurs erstellen'}
            </h2>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Title */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Titel *</label>
              <input
                value={form.title}
                onChange={e => setField('title', e.target.value)}
                placeholder="z. B. Montags-Yoga für Anfänger"
                className={inputCls}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung (optional)</label>
              <textarea
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                rows={3}
                placeholder="Was erwartet die Teilnehmer?"
                className={cn(inputCls, 'resize-none')}
              />
            </div>

            {/* Schedule type toggle */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Terminart</label>
              <div className="grid grid-cols-2 gap-2">
                {(['once', 'recurring'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setField('scheduleType', t)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all',
                      form.scheduleType === t
                        ? 'border-green-400 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    {t === 'once' ? <Calendar className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                    <div className="text-left">
                      <div>{t === 'once' ? 'Einmaliger Termin' : 'Wiederkehrend'}</div>
                      <div className="text-[10px] font-normal text-gray-400">
                        {t === 'once' ? 'Festes Datum & Uhrzeit' : 'Wöchentlich zur gleichen Zeit'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Conditional schedule inputs */}
            {form.scheduleType === 'once' ? (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Datum & Uhrzeit *</label>
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={e => setField('startsAt', e.target.value)}
                  className={inputCls}
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Wochentag</label>
                  <select
                    value={form.recurringWeekday}
                    onChange={e => setField('recurringWeekday', e.target.value)}
                    className={selectCls}
                  >
                    {WEEKDAY_LABELS.map((label, i) => (
                      <option key={i} value={String(i)}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Uhrzeit</label>
                  <input
                    type="time"
                    value={form.recurringTime}
                    onChange={e => setField('recurringTime', e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            )}

            {/* Duration */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Dauer</label>
              <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                {DURATION_OPTIONS.map(min => (
                  <button
                    key={min}
                    onClick={() => setField('durationMinutes', min)}
                    className={cn(
                      'flex-1 py-2 text-sm font-medium transition-all',
                      form.durationMinutes === min
                        ? 'bg-green-600 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    {min} Min
                  </button>
                ))}
              </div>
            </div>

            {/* Max participants */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Maximale Teilnehmer</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={form.unlimited}
                    onChange={e => setField('unlimited', e.target.checked)}
                    className="rounded border-gray-300 text-green-600 focus:ring-green-400"
                  />
                  Unbegrenzt
                </label>
                {!form.unlimited && (
                  <input
                    type="number"
                    min="1"
                    value={form.maxParticipantsStr}
                    onChange={e => setField('maxParticipantsStr', e.target.value)}
                    placeholder="z. B. 20"
                    className={cn(inputCls, 'w-40')}
                  />
                )}
              </div>
            </div>

            {/* Price */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Preis pro Ticket (€)</label>
              <div className="relative w-48">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.priceEuros}
                  onChange={e => setField('priceEuros', e.target.value)}
                  placeholder="0.00"
                  className={cn(inputCls, 'pr-8')}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">0 = kostenlos</p>
            </div>

            {/* Included in subscription */}
            <div>
              <label className="flex items-start gap-2.5 cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={form.includedInSubscription}
                  onChange={e => setField('includedInSubscription', e.target.checked)}
                  className="mt-0.5 rounded border-gray-300 text-green-600 focus:ring-green-400"
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Kostenlos für Abonnenten inklusive</p>
                  <p className="text-xs text-gray-400">Aktive Abo-Kunden nehmen gratis teil</p>
                </div>
              </label>
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{formError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={resetForm}>Abbrechen</Button>
              <Button className="flex-1" loading={saving} onClick={handleSave}>
                {editingId ? 'Speichern' : 'Erstellen'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {classes.length === 0 && !showForm && (
        <Card className="text-center py-16">
          <div className="h-14 w-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <Video className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-gray-500 mb-1 font-medium">Noch keine Video Classes</p>
          <p className="text-sm text-gray-400 mb-6">
            Erstelle wöchentliche oder einmalige Gruppen-Videosessions für mehrere Teilnehmer.
          </p>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Ersten Kurs erstellen
          </Button>
        </Card>
      )}

      {/* Class list */}
      {classes.length > 0 && (
        <div className="space-y-3">
          {classes.map(vc => (
            <Card key={vc.id} className={vc.active ? '' : 'opacity-60'}>
              <CardContent className="flex items-start gap-4 p-5">
                {/* Icon */}
                <div className="h-10 w-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Video className="h-5 w-5 text-blue-600" />
                </div>

                {/* Main info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900">{vc.title}</span>
                    <Badge variant={vc.active ? 'success' : 'default'}>
                      {vc.active ? 'Aktiv' : 'Inaktiv'}
                    </Badge>
                    {vc.price_cents === 0 ? (
                      <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">Kostenlos</span>
                    ) : (
                      <span className="text-xs font-bold text-gray-700 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">{formatCurrency(vc.price_cents / 100)}</span>
                    )}
                  </div>
                  {vc.description && (
                    <p className="text-sm text-gray-500 mb-1.5 line-clamp-1">{vc.description}</p>
                  )}
                  <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatSchedule(vc)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {vc.duration_minutes} Min
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {participantCounts[vc.id] ?? 0}
                      {vc.max_participants !== null ? ` / ${vc.max_participants} Teilnehmer` : ' Teilnehmer'}
                    </span>
                    {vc.included_in_subscription && (
                      <span className="text-violet-600 font-medium">· Inkl. für Abonnenten</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => openEdit(vc)}
                    title="Bearbeiten"
                    className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => toggleActive(vc)}
                    title={vc.active ? 'Deaktivieren' : 'Aktivieren'}
                    className={cn(
                      'p-2 rounded-lg transition-colors',
                      vc.active
                        ? 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'
                        : 'text-amber-500 hover:text-green-600 hover:bg-green-50'
                    )}
                  >
                    {vc.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => handleDelete(vc.id)}
                    title="Löschen"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
