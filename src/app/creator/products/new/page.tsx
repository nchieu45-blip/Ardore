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
import {
  Upload, FileText, Video, BookOpen, Image as ImageIcon,
  Check, Globe, ArrowLeft, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import { CategoryPicker } from '@/components/ui/CategoryPicker'
import Link from 'next/link'

const schema = z.object({
  title: z.string().min(3, 'Mindestens 3 Zeichen').max(100),
  description: z.string().max(1000).optional(),
  type: z.enum(['pdf', 'video', 'course', 'image']),
  price: z.coerce.number().min(0.5, 'Mindestpreis: 0,50€').max(9999),
})

type FormData = z.infer<typeof schema>

const PRODUCT_TYPES = [
  { value: 'pdf',    label: 'PDF / E-Book', Icon: FileText,   desc: 'Trainingsplan, Ernährungsguide …' },
  { value: 'video',  label: 'Video',        Icon: Video,      desc: 'Einzelnes Video oder Tutorial' },
  { value: 'image',  label: 'Bild',         Icon: ImageIcon,  desc: 'Foto, Grafik, Infografik' },
  { value: 'course', label: 'Kurs',         Icon: BookOpen,   desc: 'Mehrere Lektionen / Programm' },
]

const ACCEPT_BY_TYPE: Record<string, string> = {
  pdf:    '.pdf',
  video:  '.mp4,.mov,.webm',
  image:  '.jpg,.jpeg,.png,.webp,.gif',
  course: '.pdf,.mp4,.mov,.zip,.rar',
}

const HINT_BY_TYPE: Record<string, string> = {
  pdf:    'PDF – Max. 500 MB',
  video:  'MP4, MOV, WEBM – Max. 500 MB',
  image:  'JPG, PNG, WEBP, GIF – Max. 50 MB',
  course: 'PDF, MP4, ZIP – Max. 500 MB',
}

const THUMB_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_THUMB_BYTES = 10 * 1024 * 1024

export default function NewProductPage() {
  const router = useRouter()
  const supabase = createClient()
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [thumbnail, setThumbnail] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState<string | null>(null)
  const [thumbnailError, setThumbnailError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([])
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<string | null>(null)

  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
    defaultValues: { type: 'pdf' },
  })

  const selectedType = watch('type')
  const isBusy = isSubmitting || uploading

  function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (!THUMB_TYPES.includes(f.type)) { setThumbnailError('Nur JPG, PNG oder WEBP erlaubt'); return }
    if (f.size > MAX_THUMB_BYTES) { setThumbnailError('Datei zu groß – max. 10 MB'); return }
    setThumbnailError('')
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview)
    setThumbnail(f)
    setThumbnailPreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  async function submitForm(data: FormData, isPublished: boolean) {
    setError('')
    setUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      const { data: creator } = await supabase
        .from('creator_profiles')
        .select('id')
        .eq('user_id', user.id)
        .single()
      if (!creator) { router.push('/creator/onboarding'); return }

      let fileUrl: string | null = null
      let thumbnailUrl: string | null = null

      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${creator.id}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage.from('products').upload(path, file, { upsert: false })
        if (uploadError) throw new Error('Datei-Upload fehlgeschlagen')
        const { data: urlData } = supabase.storage.from('products').getPublicUrl(path)
        fileUrl = urlData.publicUrl
      }

      if (thumbnail) {
        const ext = thumbnail.name.split('.').pop()
        const path = `${creator.id}/${Date.now()}_thumb.${ext}`
        const { error: thumbError } = await supabase.storage.from('thumbnails').upload(path, thumbnail, { upsert: false })
        if (thumbError) throw new Error('Thumbnail-Upload fehlgeschlagen')
        const { data: thumbUrlData } = supabase.storage.from('thumbnails').getPublicUrl(path)
        thumbnailUrl = thumbUrlData.publicUrl
      }

      const { error: insertError } = await supabase.from('products').insert({
        creator_id: creator.id,
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        price: data.price,
        categories: selectedCategories,
        equipment: selectedEquipment,
        level: selectedLevel,
        duration: selectedDuration,
        file_url: fileUrl,
        thumbnail_url: thumbnailUrl,
        is_published: isPublished,
      })
      if (insertError) throw new Error(insertError.message)

      router.push('/creator/products')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ein Fehler ist aufgetreten')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-full bg-gray-50/40">
      {/* Sticky action bar */}
      <div className="sticky top-16 z-20 bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Link href="/creator/products" className="text-gray-400 hover:text-gray-600 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="text-sm font-semibold text-gray-900">Neues Produkt</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmit(data => submitForm(data, false))}
              disabled={isBusy}
              className="px-4 py-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Als Entwurf speichern
            </button>
            <button
              type="button"
              onClick={handleSubmit(data => submitForm(data, true))}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              <Globe className="h-3.5 w-3.5" />
              {isBusy ? 'Wird gespeichert…' : 'Veröffentlichen'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        {/* Section 1: Grundlagen */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Grundlagen</h2>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Produkttyp</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PRODUCT_TYPES.map(({ value, label, Icon, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setValue('type', value as FormData['type']); setFile(null) }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all',
                    selectedType === value
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <Icon className={cn('h-5 w-5', selectedType === value ? 'text-green-600' : 'text-gray-400')} />
                  <span className={cn('text-xs font-semibold leading-tight', selectedType === value ? 'text-green-700' : 'text-gray-600')}>{label}</span>
                  <span className="text-[10px] text-gray-400 leading-tight">{desc}</span>
                </button>
              ))}
            </div>
          </div>

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

        {/* Section 2: Inhalt */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Inhalt</h2>
          <label className={cn(
            'flex flex-col items-center justify-center w-full border-2 border-dashed rounded-xl cursor-pointer transition-all',
            file ? 'h-28 border-green-400 bg-green-50' : 'h-44 border-gray-200 hover:border-green-400 hover:bg-gray-50/60'
          )}>
            <div className="flex flex-col items-center gap-2.5 text-center px-4">
              {file ? (
                <>
                  <div className="h-9 w-9 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="text-sm font-semibold text-green-700">{file.name}</p>
                  <p className="text-xs text-green-500">{(file.size / 1024 / 1024).toFixed(1)} MB – Datei bereit</p>
                </>
              ) : (
                <>
                  <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                    <Upload className="h-5 w-5 text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700">Produktdatei hochladen</p>
                    <p className="text-xs text-gray-400 mt-0.5">oder hier ablegen</p>
                  </div>
                  <p className="text-xs text-gray-300">{HINT_BY_TYPE[selectedType]}</p>
                </>
              )}
            </div>
            <input
              type="file"
              className="hidden"
              accept={ACCEPT_BY_TYPE[selectedType]}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </section>

        {/* Section 3: Darstellung */}
        <section className="bg-white rounded-2xl border border-gray-100 p-6 space-y-5">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Darstellung</h2>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-1.5">
              Cover-Bild <span className="text-gray-400 font-normal">(optional)</span>
            </p>
            {thumbnailPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbnailPreview} alt="Vorschau" className="w-full h-52 object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(thumbnailPreview)
                    setThumbnail(null)
                    setThumbnailPreview(null)
                    setThumbnailError('')
                  }}
                  className="absolute top-2 right-2 h-7 w-7 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition-colors"
                  aria-label="Bild entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <label className="absolute bottom-2 right-2 flex items-center gap-1 px-2.5 py-1.5 bg-white/90 hover:bg-white rounded-lg text-xs font-medium cursor-pointer border border-gray-100 shadow-sm transition-colors">
                  <Upload className="h-3 w-3" />
                  Ändern
                  <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp" onChange={handleThumbnailChange} />
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
                <input type="file" className="hidden" accept=".jpg,.jpeg,.png,.webp" onChange={handleThumbnailChange} />
              </label>
            )}
            {thumbnailError && <p className="mt-1.5 text-xs text-red-600">{thumbnailError}</p>}
          </div>

          <Textarea
            label="Beschreibung"
            placeholder="Beschreibe dein Produkt – was erhalten Käufer, für wen ist es geeignet?"
            hint="Optional – max. 1.000 Zeichen"
            {...register('description')}
          />
        </section>

        {/* Section 4: Kategorien */}
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

          {(selectedType === 'video' || selectedType === 'course') && (
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {/* Bottom actions */}
        <div className="flex gap-3 pb-4">
          <button
            type="button"
            onClick={handleSubmit(data => submitForm(data, false))}
            disabled={isBusy}
            className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Als Entwurf speichern
          </button>
          <button
            type="button"
            onClick={handleSubmit(data => submitForm(data, true))}
            disabled={isBusy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            <Globe className="h-4 w-4" />
            {isBusy ? 'Wird gespeichert…' : 'Veröffentlichen'}
          </button>
        </div>
      </div>
    </div>
  )
}
