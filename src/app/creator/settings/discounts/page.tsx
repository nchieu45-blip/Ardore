'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import {
  Plus, Trash2, Eye, EyeOff, Tag, RefreshCw, Percent, Euro,
  Gift, Zap, ShoppingBag, Sparkles, Video,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Discount {
  id: string
  code: string | null
  type: 'percent' | 'fixed'
  value: number
  applies_to: 'all' | 'products' | 'subscriptions' | 'sessions'
  starts_at: string | null
  ends_at: string | null
  active: boolean
  max_redemptions: number | null
  redemption_count: number
  created_at: string
}

const APPLIES_LABELS: Record<string, string> = {
  all:           'Alles',
  products:      'Nur Produkte',
  subscriptions: 'Nur Abonnements',
  sessions:      'Nur 1:1 Sessions',
}
const APPLIES_ICONS: Record<string, React.ReactNode> = {
  all:           <Zap         className="h-3 w-3" />,
  products:      <ShoppingBag className="h-3 w-3" />,
  subscriptions: <Sparkles    className="h-3 w-3" />,
  sessions:      <Video       className="h-3 w-3" />,
}

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

function discountStatus(d: Discount): 'active' | 'inactive' | 'expired' | 'scheduled' | 'exhausted' {
  if (!d.active) return 'inactive'
  const now = new Date()
  if (d.starts_at && new Date(d.starts_at) > now) return 'scheduled'
  if (d.ends_at   && new Date(d.ends_at)   < now) return 'expired'
  if (d.max_redemptions !== null && d.redemption_count >= d.max_redemptions) return 'exhausted'
  return 'active'
}

const STATUS_CONFIG = {
  active:    { label: 'Aktiv',       variant: 'success'  as const },
  inactive:  { label: 'Inaktiv',     variant: 'default'  as const },
  expired:   { label: 'Abgelaufen',  variant: 'warning'  as const },
  scheduled: { label: 'Geplant',     variant: 'default'  as const },
  exhausted: { label: 'Aufgebraucht',variant: 'warning'  as const },
}

interface FormState {
  mode: 'code' | 'auto'
  code: string
  type: 'percent' | 'fixed'
  valueStr: string
  applies_to: string
  starts_at: string
  ends_at: string
  maxRedemptionsStr: string
}

const INITIAL_FORM: FormState = {
  mode: 'code', code: '', type: 'percent', valueStr: '',
  applies_to: 'all', starts_at: '', ends_at: '', maxRedemptionsStr: '',
}

export default function DiscountsPage() {
  const [discounts,   setDiscounts]   = useState<Discount[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showForm,    setShowForm]    = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [formError,   setFormError]   = useState('')
  const [form,        setForm]        = useState<FormState>(INITIAL_FORM)

  useEffect(() => {
    fetch('/api/discounts')
      .then(r => r.json())
      .then(d => setDiscounts(d.discounts ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function resetForm() {
    setForm(INITIAL_FORM)
    setFormError('')
    setShowForm(false)
  }

  async function handleCreate() {
    setFormError('')
    const valueNum = parseFloat(form.valueStr.replace(',', '.'))
    if (isNaN(valueNum) || valueNum <= 0) { setFormError('Bitte einen gültigen Wert eingeben'); return }
    if (form.type === 'percent' && (valueNum < 1 || valueNum > 100)) { setFormError('Prozent muss 1–100 sein'); return }
    if (form.mode === 'code' && !form.code.trim()) { setFormError('Bitte einen Code eingeben oder generieren'); return }

    const value = form.type === 'percent' ? Math.round(valueNum) : Math.round(valueNum * 100)
    setSaving(true)
    try {
      const res = await fetch('/api/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code:            form.mode === 'code' ? form.code.toUpperCase().trim() : null,
          type:            form.type,
          value,
          applies_to:      form.applies_to,
          starts_at:       form.starts_at || null,
          ends_at:         form.ends_at   || null,
          max_redemptions: form.maxRedemptionsStr ? parseInt(form.maxRedemptionsStr, 10) : null,
        }),
      })
      const data = await res.json() as { discount?: Discount; error?: string }
      if (!res.ok) { setFormError(data.error ?? 'Fehler beim Speichern'); return }
      setDiscounts(prev => [data.discount!, ...prev])
      resetForm()
    } catch {
      setFormError('Netzwerkfehler')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(d: Discount) {
    const res = await fetch(`/api/discounts/${d.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !d.active }),
    })
    const data = await res.json() as { discount?: Discount }
    if (data.discount) setDiscounts(prev => prev.map(x => x.id === d.id ? data.discount! : x))
  }

  async function handleDelete(id: string) {
    if (!confirm('Rabatt wirklich löschen?')) return
    await fetch(`/api/discounts/${id}`, { method: 'DELETE' })
    setDiscounts(prev => prev.filter(d => d.id !== id))
  }

  function formatValue(d: Discount) {
    if (d.type === 'percent') return `${d.value} %`
    return formatCurrency(d.value / 100)
  }

  const inputCls = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400'
  const selectCls = inputCls

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-8 text-gray-400">Lädt…</div>

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rabatte & Gutscheine</h1>
          <p className="text-sm text-gray-500 mt-0.5">Rabattcodes und automatische Rabatte für deine Kunden</p>
        </div>
        <Button onClick={() => { setShowForm(true) }} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Neuer Rabatt
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="mb-6 border-green-200">
          <CardHeader>
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Tag className="h-4 w-4 text-green-600" />
              Neuen Rabatt erstellen
            </h2>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Mode: code vs auto */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Art des Rabatts</label>
              <div className="grid grid-cols-2 gap-2">
                {(['code', 'auto'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setField('mode', m)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all',
                      form.mode === m
                        ? 'border-green-400 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    {m === 'code' ? <Gift className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                    <div className="text-left">
                      <div>{m === 'code' ? 'Gutscheincode' : 'Automatischer Rabatt'}</div>
                      <div className="text-[10px] font-normal text-gray-400">
                        {m === 'code' ? 'Kunden geben einen Code ein' : 'Gilt automatisch für alle'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Code input (only for code mode) */}
            {form.mode === 'code' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Gutscheincode</label>
                <div className="flex gap-2">
                  <input
                    value={form.code}
                    onChange={e => setField('code', e.target.value.toUpperCase())}
                    placeholder="z. B. SOMMER20"
                    maxLength={20}
                    className={cn(inputCls, 'flex-1 font-mono tracking-wider')}
                  />
                  <button
                    onClick={() => setField('code', generateCode())}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Generieren
                  </button>
                </div>
              </div>
            )}

            {/* Type + value */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Rabatttyp</label>
                <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                  {(['percent', 'fixed'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setField('type', t)}
                      className={cn(
                        'flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium transition-all',
                        form.type === t
                          ? 'bg-green-600 text-white'
                          : 'bg-white text-gray-600 hover:bg-gray-50'
                      )}
                    >
                      {t === 'percent' ? <Percent className="h-3.5 w-3.5" /> : <Euro className="h-3.5 w-3.5" />}
                      {t === 'percent' ? 'Prozent' : 'Fester Betrag'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">
                  Wert {form.type === 'percent' ? '(%)' : '(€)'}
                </label>
                <div className="relative">
                  <input
                    value={form.valueStr}
                    onChange={e => setField('valueStr', e.target.value)}
                    type="number"
                    min="0"
                    step={form.type === 'percent' ? '1' : '0.01'}
                    placeholder={form.type === 'percent' ? '20' : '5,00'}
                    className={cn(inputCls, 'pr-8')}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    {form.type === 'percent' ? '%' : '€'}
                  </span>
                </div>
              </div>
            </div>

            {/* Applies to */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Gilt für</label>
              <select
                value={form.applies_to}
                onChange={e => setField('applies_to', e.target.value)}
                className={selectCls}
              >
                <option value="all">Alles (Produkte, Abos, Sessions)</option>
                <option value="products">Nur Produkte</option>
                <option value="subscriptions">Nur Abonnements</option>
                <option value="sessions">Nur 1:1 Sessions</option>
              </select>
            </div>

            {/* Dates */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Gültig von (optional)</label>
                <input
                  type="datetime-local"
                  value={form.starts_at}
                  onChange={e => setField('starts_at', e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Gültig bis (optional)</label>
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={e => setField('ends_at', e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            {/* Max redemptions */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Max. Einlösungen <span className="text-gray-400">(leer = unbegrenzt)</span>
              </label>
              <input
                type="number"
                min="1"
                value={form.maxRedemptionsStr}
                onChange={e => setField('maxRedemptionsStr', e.target.value)}
                placeholder="z. B. 50"
                className={cn(inputCls, 'w-40')}
              />
            </div>

            {formError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">{formError}</p>
            )}

            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={resetForm}>Abbrechen</Button>
              <Button className="flex-1" loading={saving} onClick={handleCreate}>Erstellen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Discount list */}
      {discounts.length === 0 && !showForm ? (
        <Card className="text-center py-16">
          <div className="h-14 w-14 rounded-2xl bg-gray-50 flex items-center justify-center mx-auto mb-4">
            <Tag className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-gray-500 mb-1 font-medium">Noch keine Rabatte</p>
          <p className="text-sm text-gray-400 mb-6">Erstelle Gutscheincodes oder automatische Rabatte für deine Kunden.</p>
          <Button onClick={() => setShowForm(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Ersten Rabatt erstellen
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {discounts.map(d => {
            const status = discountStatus(d)
            const cfg    = STATUS_CONFIG[status]
            return (
              <Card key={d.id} className={status === 'inactive' ? 'opacity-60' : ''}>
                <CardContent className="flex items-start gap-4 p-5">
                  {/* Icon */}
                  <div className={cn(
                    'h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    d.code ? 'bg-green-50' : 'bg-violet-50'
                  )}>
                    {d.code
                      ? <Gift className="h-5 w-5 text-green-600" />
                      : <Zap  className="h-5 w-5 text-violet-600" />}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {d.code ? (
                        <span className="font-mono font-bold text-gray-900 tracking-wider">{d.code}</span>
                      ) : (
                        <span className="font-semibold text-gray-900">Automatischer Rabatt</span>
                      )}
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
                        {formatValue(d)} Rabatt
                      </span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        {APPLIES_ICONS[d.applies_to]}
                        {APPLIES_LABELS[d.applies_to]}
                      </span>
                      {(d.ends_at || d.starts_at) && (
                        <span>
                          {d.starts_at ? new Date(d.starts_at).toLocaleDateString('de-DE') : '–'}
                          {' → '}
                          {d.ends_at ? new Date(d.ends_at).toLocaleDateString('de-DE') : '∞'}
                        </span>
                      )}
                      <span>
                        {d.redemption_count}
                        {d.max_redemptions !== null ? ` / ${d.max_redemptions}` : ''} Einlösungen
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(d)}
                      title={d.active ? 'Deaktivieren' : 'Aktivieren'}
                      className={cn(
                        'p-2 rounded-lg transition-colors',
                        d.active
                          ? 'text-gray-400 hover:text-amber-500 hover:bg-amber-50'
                          : 'text-amber-500 hover:text-green-600 hover:bg-green-50'
                      )}
                    >
                      {d.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      onClick={() => handleDelete(d.id)}
                      title="Löschen"
                      className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
