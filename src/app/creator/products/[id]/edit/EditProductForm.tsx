'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any
import { createClient } from '@/lib/supabase/client'
import { Input, Textarea } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  FileText, Video, BookOpen, Image as ImageIcon,
  Check, Globe, EyeOff, ArrowLeft, Upload, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import { CategoryPicker } from '@/components/ui/CategoryPicker'
import { toast } from '@/lib/toast'
import Link from 'next/link'

const MAX_THUMB_BYTES = 10 * 1024 * 1024
const THUMB_ACCEPT = '.jpg,.jpeg,.png,.webp'
const THUMB_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const schema = z.object({
  title: z.string().min(3, 'Mindestens 3 Zeichen').max(100),
  description: z.string().max(1000).optional(),
  price: z.coerce.number().min(0.5, 'Mindestpreis: 0,50€').max(9999),
})

type FormData = z.infer<typeof schema>

interface Product {
  id: string
  title: string
  description: string | null
  type: 'pdf' | 'video' | 'course' | 'image'
  price: number
  categories: string[]
  equipment: string[]
  level: string | null
  duration: string | null
  is_published: boolean
  thumbnail_url: string | null
}

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF / E-Book', video: 'Video', image: 'Bild', course: 'Kurs',
}

const TYPE_ICONS: Record<string, React.ElementType> = {
  pdf: FileText, video: Video, image: ImageIcon, course: BookOpen,
}

export default function EditProductForm({ product }: { product: Product }) {
  const router = useRouter()
  const supabase = createClient()
  const [saving, setSaving] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(product.categories ?? [])
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(product.equipment ?? [])
  const [selectedLevel, setSelectedLevel] = useState<string | null>(product.level)
  const [selectedDuration, setSelectedDuration] = useState<string | null>(product.duration)

  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [removeThumb, setRemoveThumb] = useState(false)
  const [thumbError, setThumbError] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
    defaultValues: {
      title: product.title,
      description: product.description ?? '',
      price: product.price,
    },
  })

  function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!THUMB_TYPES.includes(f.type)) { setThumbError('Nur JPG, PNG oder WEBP erlaubt'); return }
    if (f.size > MAX_THUMB_BYTES) { setThumbError('Datei zu groß – max. 10 MB'); return }
    setThumbError('')
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview)
    setThumbnailFile(f)
    setThumbnailPreview(URL.createObjectURL(f))
    setRemoveThumb(false)
    e.target.value = ''
  }

  function handleRemoveThumbnail() {
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview)
    setThumbnailFile(null)
    setThumbnailPreview(null)
    setRemoveThumb(true)
    setThumbError('')
  }

  const displayThumbUrl = thumbnailPreview ?? (removeThumb ? null : product.thumbnail_url)

  async function save(data: FormData, isPublished: boolean) {
    setSaving(true)
    try {
      let finalThumbnailUrl: string | null | undefined = undefined

      if (thumbnailFile) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        const { data: creator } = await supabase
          .from('creator_profiles')
          .select('id')
          .eq('user_id', user.id)
          .single()
        if (!creator) throw new Error('Kein Creator-Profil gefunden')

        const ext = thumbnailFile.name.split('.').pop()
        // eslint-disable-next-line react-hooks/purity
        const path = `${creator.id}/${Date.now()}_thumb.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('thumbnails')
          .upload(path, thumbnailFile, { upsert: false })
        if (uploadError) throw new Error('Bild-Upload fehlgeschlagen: ' + uploadError.message)
        const { data: urlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
        finalThumbnailUrl = urlData.publicUrl
      } else if (removeThumb) {
        finalThumbnailUrl = null
      }

      const body: Record<string, unknown> = {
        title: data.title,
        description: data.description ?? null,
        price: data.price,
        categories: selectedCategories,
        equipment: selectedEquipment,
        level: selectedLevel,
        duration: selectedDuration,
        is_published: isPublished,
      }
      if (finalThumbnailUrl !== undefined) body.thumbnail_url = finalThumbnailUrl

      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Fehler beim Speichern')
      }
      const label = isPublished ? 'Veröffentlicht' : 'Als Entwurf gespeichert'
      toast.success(`Produkt ${label.toLowerCase()}`)
      router.push('/creator/products')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ein Fehler ist aufgetreten')
      setSaving(false)
    }
  }

  const TypeIcon = TYPE_ICONS[product.type]

  return (
    <div className="min-h-full bg-gray-50/40">
      {/* Sticky action bar */}
      <div className="sticky top-16 z-20 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link href="/creator/products" className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-gray-900 truncate">Produkt bearbeiten</span>
              <span className="hidden sm:flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                <TypeIcon className="h-3.5 w-3.5" />
                {TYPE_LABELS[product.type]}
              </span>
              <Badge variant={product.is_published ? 'success' : 'default'} className="flex-shrink-0">
                {product.is_published ? 'Live' : 'Entwurf'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {!product.is_published ? (
              <>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, false))}
                  disabled={saving}
                  className="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Als Entwurf speichern
                </button>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, true))}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {saving ? 'Wird gespeichert…' : 'Veröffentlichen'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, false))}
                  disabled={saving}
                  className="hidden sm:flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Zurückziehen
                </button>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, true))}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        {/* Section 1: Grundlagen */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Grundlagen</h2>

          <Input
            label="Titel"
            placeholder="z.B. 12-Wochen Trainingsplan"
            error={errors.title?.message}
            {...register('title')}
          />

          <Input
            label="Preis (€)"
            type="number"
            step="0.01"
            min="0.50"
            placeholder="9.99"
            error={errors.price?.message}
            hint="Mindestpreis: 0,50 €"
            {...register('price')}
          />
        </section>

        {/* Section 2: Darstellung */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Darstellung</h2>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">Cover-Bild</p>
            {displayThumbUrl ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displayThumbUrl} alt="Vorschau" className="w-full h-52 object-cover" />
                <button
                  type="button"
                  onClick={handleRemoveThumbnail}
                  className="absolute top-2 right-2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                  aria-label="Bild entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <label className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1.5 bg-white/90 hover:bg-white rounded-lg text-xs font-medium cursor-pointer border border-gray-100 shadow-sm transition-colors">
                  <Upload className="h-3 w-3" />
                  Ändern
                  <input type="file" className="hidden" accept={THUMB_ACCEPT} onChange={handleThumbnailChange} />
                </label>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all border-gray-200 hover:border-green-400 hover:bg-gray-50/60">
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <div className="h-10 w-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <ImageIcon className="h-5 w-5 text-gray-400" />
                  </div>
                  <p className="text-sm font-semibold text-gray-700">Cover-Bild auswählen</p>
                  <p className="text-xs text-gray-400">JPG, PNG, WEBP – Max. 10 MB</p>
                </div>
                <input type="file" className="hidden" accept={THUMB_ACCEPT} onChange={handleThumbnailChange} />
              </label>
            )}
            {thumbError && <p className="mt-1.5 text-xs text-red-600">{thumbError}</p>}
          </div>

          <Textarea
            label="Beschreibung"
            placeholder="Beschreibe dein Produkt – was erhalten Käufer, für wen ist es geeignet?"
            hint="Optional – max. 1.000 Zeichen"
            {...register('description')}
          />
        </section>

        {/* Section 3: Kategorien */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Kategorien & Metadaten</h2>

          <CategoryPicker label="Kategorien" selected={selectedCategories} onChange={setSelectedCategories} />

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Equipment / Voraussetzungen</p>
            <div className="flex flex-wrap gap-2">
              {EQUIPMENT_OPTIONS.map(opt => {
                const active = selectedEquipment.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedEquipment(active ? selectedEquipment.filter(v => v !== opt.value) : [...selectedEquipment, opt.value])}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    )}
                  >
                    {active && <Check className="h-3 w-3" />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Level</p>
            <div className="flex flex-wrap gap-2">
              {LEVEL_OPTIONS.map(opt => {
                const active = selectedLevel === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedLevel(active ? null : opt.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                      active ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {(product.type === 'video' || product.type === 'course') && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Dauer</p>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map(opt => {
                  const active = selectedDuration === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedDuration(active ? null : opt.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        active ? 'bg-green-700 text-white border-green-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {/* Bottom actions */}
        <div className="flex gap-3 pb-4">
          {!product.is_published ? (
            <>
              <button
                type="button"
                onClick={handleSubmit(data => save(data, false))}
                disabled={saving}
                className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Als Entwurf speichern
              </button>
              <button
                type="button"
                onClick={handleSubmit(data => save(data, true))}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Globe className="h-4 w-4" />
                {saving ? 'Wird gespeichert…' : 'Veröffentlichen'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleSubmit(data => save(data, false))}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <EyeOff className="h-4 w-4" />
                Zurückziehen
              </button>
              <button
                type="button"
                onClick={handleSubmit(data => save(data, true))}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                {saving ? 'Wird gespeichert…' : 'Änderungen speichern'}
              </button>
            </>
          )}
        </div>

        <div className="text-center pb-2">
          <Link href="/creator/products" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            Abbrechen
          </Link>
        </div>
      </div>
    </div>
  )
}
