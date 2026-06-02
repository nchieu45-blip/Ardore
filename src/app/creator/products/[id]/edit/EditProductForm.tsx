'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { FileText, Video, BookOpen, Image as ImageIcon, Check, Globe, EyeOff, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EQUIPMENT_OPTIONS, LEVEL_OPTIONS, DURATION_OPTIONS } from '@/lib/productOptions'
import Link from 'next/link'

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
  equipment: string[]
  level: string | null
  duration: string | null
  is_published: boolean
}

const TYPE_LABELS: Record<string, string> = {
  pdf: 'PDF / E-Book', video: 'Video', image: 'Bild', course: 'Kurs',
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  pdf:    <FileText className="h-4 w-4" />,
  video:  <Video    className="h-4 w-4" />,
  image:  <ImageIcon className="h-4 w-4" />,
  course: <BookOpen className="h-4 w-4" />,
}

export default function EditProductForm({ product }: { product: Product }) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>(product.equipment ?? [])
  const [selectedLevel, setSelectedLevel] = useState<string | null>(product.level)
  const [selectedDuration, setSelectedDuration] = useState<string | null>(product.duration)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
    defaultValues: {
      title: product.title,
      description: product.description ?? '',
      price: product.price,
    },
  })

  async function save(data: FormData, isPublished: boolean) {
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: data.title,
          description: data.description ?? null,
          price: data.price,
          equipment: selectedEquipment,
          level: selectedLevel,
          duration: selectedDuration,
          is_published: isPublished,
        }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? 'Fehler beim Speichern')
      }
      router.push('/creator/products')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ein Fehler ist aufgetreten')
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/creator/products" className="text-gray-400 hover:text-gray-600 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Produkt bearbeiten</h1>
          <p className="text-gray-500 text-sm flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-1.5">
              {TYPE_ICONS[product.type]}
              {TYPE_LABELS[product.type]}
            </span>
            <span className="text-gray-300">·</span>
            <Badge variant={product.is_published ? 'success' : 'default'}>
              {product.is_published ? 'Veröffentlicht' : 'Entwurf'}
            </Badge>
          </p>
        </div>
      </div>

      <div className="space-y-6">
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

        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900">Tags & Filter</h2>
          </CardHeader>
          <CardContent className="space-y-5">
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <Card>
          <CardContent className="pt-5 space-y-3">
            {!product.is_published ? (
              <>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, true))}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Globe className="h-4 w-4" />
                  Veröffentlichen
                </button>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, false))}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Als Entwurf speichern
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, true))}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  Änderungen speichern
                </button>
                <button
                  type="button"
                  onClick={handleSubmit(data => save(data, false))}
                  disabled={saving}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <EyeOff className="h-4 w-4" />
                  Zurückziehen (als Entwurf)
                </button>
              </>
            )}
            <Link
              href="/creator/products"
              className="block text-center text-sm text-gray-400 hover:text-gray-600 transition-colors pt-1"
            >
              Abbrechen
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
