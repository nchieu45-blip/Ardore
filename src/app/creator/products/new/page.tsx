'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Upload, FileText, Video, BookOpen, Image as ImageIcon, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import { CategoryPicker } from '@/components/ui/CategoryPicker'

const schema = z.object({
  title: z.string().min(3, 'Mindestens 3 Zeichen').max(100),
  description: z.string().max(1000).optional(),
  type: z.enum(['pdf', 'video', 'course', 'image']),
  price: z.coerce.number().min(0.5, 'Mindestpreis: 0,50€').max(9999),
})

type FormData = z.infer<typeof schema>

const PRODUCT_TYPES = [
  { value: 'pdf', label: 'PDF / E-Book', icon: <FileText className="h-5 w-5" />, desc: 'Trainingsplan, Ernährungsguide, etc.' },
  { value: 'video', label: 'Video', icon: <Video className="h-5 w-5" />, desc: 'Einzelnes Video oder Tutorial' },
  { value: 'image', label: 'Bild', icon: <ImageIcon className="h-5 w-5" />, desc: 'Foto, Grafik, Infografik' },
  { value: 'course', label: 'Kurs', icon: <BookOpen className="h-5 w-5" />, desc: 'Mehrere Lektionen / Programm' },
]

const ACCEPT_BY_TYPE: Record<string, string> = {
  pdf: '.pdf',
  video: '.mp4,.mov,.webm',
  image: '.jpg,.jpeg,.png,.webp,.gif',
  course: '.pdf,.mp4,.mov,.zip,.rar',
}

const HINT_BY_TYPE: Record<string, string> = {
  pdf: 'PDF – Max. 500 MB',
  video: 'MP4, MOV, WEBM – Max. 500 MB',
  image: 'JPG, PNG, WEBP, GIF – Max. 50 MB',
  course: 'PDF, MP4, ZIP – Max. 500 MB',
}

function FileUploadZone({
  file,
  onChange,
  accept,
  hint,
  label,
}: {
  file: File | null
  onChange: (f: File | null) => void
  accept: string
  hint: string
  label: string
}) {
  return (
    <label className={cn(
      'flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
      file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-green-400 hover:bg-gray-50'
    )}>
      <div className="flex flex-col items-center gap-2 text-center px-4">
        <Upload className={cn('h-8 w-8', file ? 'text-green-600' : 'text-gray-400')} />
        {file ? (
          <>
            <p className="text-sm font-medium text-green-700">{file.name}</p>
            <p className="text-xs text-green-600">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-700">{label}</p>
            <p className="text-xs text-gray-400">{hint}</p>
          </>
        )}
      </div>
      <input
        type="file"
        className="hidden"
        accept={accept}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  )
}

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

  async function onSubmit(data: FormData) {
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
        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(path, file, { upsert: false })
        if (uploadError) throw new Error('Datei-Upload fehlgeschlagen')
        const { data: urlData } = supabase.storage.from('products').getPublicUrl(path)
        fileUrl = urlData.publicUrl
      }

      if (thumbnail) {
        const ext = thumbnail.name.split('.').pop()
        const path = `${creator.id}/${Date.now()}_thumb.${ext}`
        const { error: thumbError } = await supabase.storage
          .from('thumbnails')
          .upload(path, thumbnail, { upsert: false })
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
        is_published: false,
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
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Neues Produkt erstellen</h1>
        <p className="text-gray-500">Füge ein neues Produkt zu deinem Portfolio hinzu</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Product Type */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Produkttyp</h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {PRODUCT_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    setValue('type', type.value as FormData['type'])
                    setFile(null)
                  }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all',
                    selectedType === type.value
                      ? 'border-green-600 bg-green-50 text-green-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  )}
                >
                  {type.icon}
                  <span className="text-sm font-medium">{type.label}</span>
                  <span className="text-xs opacity-70">{type.desc}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Produkt-Details</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Titel"
              placeholder="z.B. 12-Wochen Trainingsplan"
              error={errors.title?.message}
              {...register('title')}
            />
            <Textarea
              label="Beschreibung (optional)"
              placeholder="Beschreibe dein Produkt..."
              {...register('description')}
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
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Tags & Filter</h2>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Categories */}
            <CategoryPicker
              label="Kategorien"
              selected={selectedCategories}
              onChange={setSelectedCategories}
            />

            {/* Equipment */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Equipment / Voraussetzungen</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_OPTIONS.map(opt => {
                  const active = selectedEquipment.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setSelectedEquipment(
                        active ? selectedEquipment.filter(v => v !== opt.value) : [...selectedEquipment, opt.value]
                      )}
                      className={cn(
                        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                        active
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Level */}
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
                        active
                          ? 'bg-green-700 text-white border-green-700'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      )}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Duration — only for video / course */}
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
                          active
                            ? 'bg-green-700 text-white border-green-700'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        )}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Main file upload */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Produktdatei hochladen</h2>
          </CardHeader>
          <CardContent>
            <FileUploadZone
              file={file}
              onChange={setFile}
              accept={ACCEPT_BY_TYPE[selectedType]}
              hint={HINT_BY_TYPE[selectedType]}
              label="Datei auswählen"
            />
          </CardContent>
        </Card>

        {/* Thumbnail upload */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Vorschaubild (optional)</h2>
          </CardHeader>
          <CardContent>
            {thumbnailPreview ? (
              <div className="relative rounded-xl overflow-hidden border border-gray-200">
                <img src={thumbnailPreview} alt="Vorschau" className="w-full h-52 object-cover" />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(thumbnailPreview)
                    setThumbnail(null)
                    setThumbnailPreview(null)
                    setThumbnailError('')
                  }}
                  className="absolute top-2 right-2 h-8 w-8 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center transition-colors"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <p className="absolute bottom-2 left-3 text-[11px] text-white/80 bg-black/30 px-2 py-0.5 rounded-full backdrop-blur-sm">
                  {thumbnail?.name}
                </p>
              </div>
            ) : (
              <label className={cn(
                'flex flex-col items-center justify-center w-full h-36 border-2 border-dashed rounded-xl cursor-pointer transition-colors',
                'border-gray-300 hover:border-green-400 hover:bg-gray-50'
              )}>
                <div className="flex flex-col items-center gap-2 text-center px-4">
                  <Upload className="h-8 w-8 text-gray-400" />
                  <p className="text-sm font-medium text-gray-700">Vorschaubild auswählen</p>
                  <p className="text-xs text-gray-400">JPG, PNG, WEBP – Max. 10 MB</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
                      setThumbnailError('Nur JPG, PNG oder WEBP erlaubt')
                      return
                    }
                    if (f.size > 10 * 1024 * 1024) {
                      setThumbnailError('Datei zu groß – max. 10 MB')
                      return
                    }
                    setThumbnailError('')
                    setThumbnail(f)
                    setThumbnailPreview(URL.createObjectURL(f))
                    e.target.value = ''
                  }}
                />
              </label>
            )}
            {thumbnailError && (
              <p className="mt-2 text-xs text-red-600">{thumbnailError}</p>
            )}
          </CardContent>
        </Card>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
            Abbrechen
          </Button>
          <Button type="submit" className="flex-1" loading={isSubmitting || uploading}>
            Produkt speichern
          </Button>
        </div>
      </form>
    </div>
  )
}
