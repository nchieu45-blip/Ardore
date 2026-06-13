'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { CategoryPicker } from '@/components/ui/CategoryPicker'
import { slugify, getInitials, cn } from '@/lib/utils'
import {
  Flame, Camera, Check, ChevronRight, Sparkles, Plus,
  FileText, Video, BookOpen, Image as ImageIcon,
} from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any

// ─── Schemas ──────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  display_name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  bio: z.string().max(500, 'Max. 500 Zeichen').optional(),
})

const tierSchema = z.object({
  name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  description: z.string().max(300).optional(),
  price_monthly: z.coerce.number().int('Nur ganze Zahlen').min(0).max(999),
})

const productSchema = z.object({
  title: z.string().min(3, 'Mindestens 3 Zeichen').max(100),
  description: z.string().max(1000).optional(),
  type: z.enum(['pdf', 'video', 'course', 'image']),
  price: z.coerce.number().min(0.5, 'Mindestpreis: 0,50 €').max(9999),
})

type ProfileData = z.infer<typeof profileSchema>
type TierData    = z.infer<typeof tierSchema>
type ProductData = z.infer<typeof productSchema>

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_TYPES = [
  { value: 'pdf',    label: 'PDF / E-Book', icon: <FileText  className="h-5 w-5" />, desc: 'Trainingsplan, Guide, etc.' },
  { value: 'video',  label: 'Video',        icon: <Video     className="h-5 w-5" />, desc: 'Tutorial oder Workout' },
  { value: 'image',  label: 'Bild',         icon: <ImageIcon className="h-5 w-5" />, desc: 'Foto, Grafik, Infografik' },
  { value: 'course', label: 'Kurs',         icon: <BookOpen  className="h-5 w-5" />, desc: 'Mehrere Lektionen' },
]

const STEPS = [
  { n: 1, label: 'Profil' },
  { n: 2, label: 'Bilder' },
  { n: 3, label: 'Abos' },
  { n: 4, label: 'Produkt' },
]

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const MAX_BANNER_BYTES = 10 * 1024 * 1024

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center mb-8">
      {STEPS.map((s, i) => (
        <div key={s.n} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={cn(
              'h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300',
              current > s.n
                ? 'bg-green-600 text-white'
                : current === s.n
                ? 'bg-green-600 text-white ring-4 ring-green-100'
                : 'bg-gray-100 text-gray-400',
            )}>
              {current > s.n ? <Check className="h-3.5 w-3.5" /> : s.n}
            </div>
            <span className={cn(
              'text-xs font-medium hidden sm:block',
              current === s.n ? 'text-green-700' : current > s.n ? 'text-gray-500' : 'text-gray-400',
            )}>
              {s.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn(
              'w-8 sm:w-12 h-px mx-2 sm:mx-3 transition-colors duration-300',
              current > s.n ? 'bg-green-600' : 'bg-gray-200',
            )} />
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CreatorOnboardingPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState(1)
  const [creatorId, setCreatorId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [tierCreated, setTierCreated] = useState(false)
  const [productCreated, setProductCreated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [categoryError, setCategoryError] = useState('')

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: existing } = await supabase
        .from('creator_profiles').select('id').eq('user_id', user.id).maybeSingle()
      if (existing) { router.push('/creator'); return }
      setChecking(false)
    }
    check()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Step 1: Profile ────────────────────────────────────────────────────────

  const profileForm = useForm<ProfileData>({
    resolver: zodResolver(profileSchema) as AnyResolver,
  })
  const [profileError, setProfileError] = useState('')

  async function submitProfile(data: ProfileData) {
    setProfileError('')
    if (selectedCategories.length === 0) {
      setCategoryError('Bitte wähle mindestens eine Kategorie')
      return
    }
    setCategoryError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const slug = slugify(data.display_name) + '-' + Math.random().toString(36).slice(2, 6)
    const { data: creator, error } = await supabase
      .from('creator_profiles')
      .insert({
        user_id: user.id,
        display_name: data.display_name,
        slug,
        bio: data.bio ?? null,
        category: selectedCategories[0],
        categories: selectedCategories,
      })
      .select('id')
      .single()

    if (error) { setProfileError('Fehler beim Erstellen des Profils. Bitte versuche es erneut.'); return }
    setCreatorId(creator.id)
    setDisplayName(data.display_name)
    setStep(2)
  }

  // ── Step 2: Images ─────────────────────────────────────────────────────────

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')
  const [uploadingImages, setUploadingImages] = useState(false)

  function pickFile(e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') {
    setImageError('')
    const file = e.target.files?.[0]
    if (!file) return
    const maxBytes = type === 'avatar' ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES
    const maxLabel = type === 'avatar' ? '5 MB' : '10 MB'
    if (!file.type.startsWith('image/')) { setImageError('Nur Bilddateien sind erlaubt.'); return }
    if (file.size > maxBytes) { setImageError(`Bild zu groß. Max.: ${maxLabel}.`); return }
    const preview = URL.createObjectURL(file)
    if (type === 'avatar') { setAvatarFile(file); setAvatarPreview(preview) }
    else { setBannerFile(file); setBannerPreview(preview) }
  }

  async function uploadImage(file: File, path: string): Promise<string> {
    const { error } = await supabase.storage
      .from('profile-images').upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw error
    const { data } = supabase.storage.from('profile-images').getPublicUrl(path)
    return `${data.publicUrl}?t=${Date.now()}`
  }

  async function submitImages() {
    if (!avatarFile && !bannerFile) { setStep(3); return }
    setUploadingImages(true)
    setImageError('')
    try {
      const updates: Record<string, string> = {}
      if (avatarFile) updates.avatar_url = await uploadImage(avatarFile, `${creatorId}/avatar`)
      if (bannerFile) updates.banner_url = await uploadImage(bannerFile, `${creatorId}/banner`)
      await supabase.from('creator_profiles').update(updates).eq('id', creatorId)
    } catch {
      setImageError('Upload fehlgeschlagen. Bitte versuche es erneut.')
      setUploadingImages(false)
      return
    }
    setUploadingImages(false)
    setStep(3)
  }

  // ── Step 3: Tier ───────────────────────────────────────────────────────────

  const tierForm = useForm<TierData>({
    resolver: zodResolver(tierSchema) as AnyResolver,
    defaultValues: { name: '', price_monthly: 9 },
  })
  const [tierError, setTierError] = useState('')

  async function submitTier(data: TierData) {
    setTierError('')
    const { error } = await supabase.from('subscription_tiers').insert({
      creator_id: creatorId,
      name: data.name,
      description: data.description ?? null,
      price_monthly: data.price_monthly,
      features: [],
      is_active: true,
    })
    if (error) { setTierError('Fehler beim Erstellen der Preisstufe.'); return }
    setTierCreated(true)
    setStep(4)
  }

  // ── Step 4: Product ────────────────────────────────────────────────────────

  const productForm = useForm<ProductData>({
    resolver: zodResolver(productSchema) as AnyResolver,
    defaultValues: { type: 'pdf', price: 9.99 },
  })
  const selectedType = productForm.watch('type')
  const [productError, setProductError] = useState('')

  async function submitProduct(data: ProductData) {
    setProductError('')
    const { error } = await supabase.from('products').insert({
      creator_id: creatorId,
      title: data.title,
      description: data.description ?? null,
      type: data.type,
      price: data.price,
      file_url: null,
      thumbnail_url: null,
      is_published: false,
    })
    if (error) { setProductError('Fehler beim Erstellen des Produkts.'); return }
    setProductCreated(true)
    setStep(5)
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (checking) {
    return (
      <div className="min-h-[calc(100vh-64px)] flex items-center justify-center">
        <p className="text-sm text-gray-400">Lädt…</p>
      </div>
    )
  }

  const totalSteps = STEPS.length   // 4
  const remainingSteps = totalSteps + 1 - step  // steps left including current

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50 px-4 py-10">
      <div className="max-w-lg mx-auto">

        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl text-green-600 mb-5">
            <div className="h-8 w-8 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
              <Flame className="h-4 w-4 text-white" />
            </div>
            Ardore
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Coach-Profil einrichten</h1>
          {step <= totalSteps && (
            <p className="text-gray-500 mt-1.5 text-sm">
              Schritt {step} von {totalSteps}
            </p>
          )}
        </div>

        {step <= totalSteps && <Stepper current={step} />}

        {/* ── Step 1: Profile Info ── */}
        {step === 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-slide-up">
            <h2 className="font-semibold text-gray-900 mb-1">Profilinformationen</h2>
            <p className="text-sm text-gray-500 mb-5">Diese Angaben erscheinen auf deinem öffentlichen Coach-Profil.</p>
            <form onSubmit={profileForm.handleSubmit(submitProfile)} className="space-y-4">
              <Input
                label="Coach-Name"
                placeholder="z.B. Fitness mit Max"
                hint="Wie sollen Kunden dich finden?"
                error={profileForm.formState.errors.display_name?.message}
                {...profileForm.register('display_name')}
              />
              <CategoryPicker
                selected={selectedCategories}
                onChange={(cats) => { setSelectedCategories(cats); if (cats.length > 0) setCategoryError('') }}
                error={categoryError}
              />
              <Textarea
                label="Über mich (optional)"
                placeholder="Erzähl deinen Kunden, wer du bist und was du anbietest…"
                hint="Max. 500 Zeichen"
                error={profileForm.formState.errors.bio?.message}
                {...profileForm.register('bio')}
              />
              {profileError && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
                  {profileError}
                </div>
              )}
              <Button type="submit" className="w-full" size="lg" loading={profileForm.formState.isSubmitting}>
                Weiter <ChevronRight className="h-4 w-4" />
              </Button>
            </form>
          </div>
        )}

        {/* ── Step 2: Avatar & Banner ── */}
        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-slide-up">
            <h2 className="font-semibold text-gray-900 mb-1">Profilbild & Banner</h2>
            <p className="text-sm text-gray-500 mb-5">Du kannst Bilder auch später noch in den Einstellungen ändern.</p>

            <div className="relative">
              <div
                className="h-32 rounded-xl overflow-hidden bg-gradient-to-br from-green-400 to-green-600 cursor-pointer group"
                onClick={() => bannerInputRef.current?.click()}
              >
                {bannerPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bannerPreview} alt="Banner" className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full px-3 py-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-700">
                    <Camera className="h-3.5 w-3.5" /> Banner hochladen
                  </div>
                </div>
              </div>
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e, 'banner')} />

              <div className="absolute bottom-0 left-4 translate-y-1/2">
                <div
                  className="relative h-16 w-16 rounded-full ring-4 ring-white overflow-hidden cursor-pointer group bg-green-100"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-green-700 font-semibold text-lg">
                      {getInitials(displayName)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <Camera className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e, 'avatar')} />
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-12 mb-5">
              Profilbild: max. 5 MB · Banner: max. 10 MB
            </p>

            {imageError && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">
                {imageError}
              </div>
            )}

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(3)}>
                Überspringen
              </Button>
              <Button type="button" className="flex-1" loading={uploadingImages} onClick={submitImages}>
                {avatarFile || bannerFile ? 'Hochladen & Weiter' : 'Weiter'}
                {!uploadingImages && <ChevronRight className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: First Tier ── */}
        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-slide-up">
            <h2 className="font-semibold text-gray-900 mb-1">Erste Abo-Preisstufe</h2>
            <p className="text-sm text-gray-500 mb-5">
              Lege fest, was Abonnenten zahlen. Du kannst weitere Stufen jederzeit hinzufügen.
            </p>
            <form onSubmit={tierForm.handleSubmit(submitTier)} className="space-y-4">
              <Input
                label="Name der Stufe"
                placeholder="z.B. Basic, Premium, VIP"
                error={tierForm.formState.errors.name?.message}
                {...tierForm.register('name')}
              />
              <Input
                label="Preis pro Monat (€)"
                type="number"
                step="1"
                min="0"
                placeholder="9"
                hint="0 für ein kostenloses Abo"
                error={tierForm.formState.errors.price_monthly?.message}
                {...tierForm.register('price_monthly')}
              />
              <Textarea
                label="Was ist enthalten? (optional)"
                placeholder="z.B. Wöchentliche Trainingspläne, persönliche Betreuung…"
                error={tierForm.formState.errors.description?.message}
                {...tierForm.register('description')}
              />
              {tierError && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
                  {tierError}
                </div>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(4)}>
                  Überspringen
                </Button>
                <Button type="submit" className="flex-1" loading={tierForm.formState.isSubmitting}>
                  Erstellen & Weiter
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 4: First Product ── */}
        {step === 4 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 animate-slide-up">
            <h2 className="font-semibold text-gray-900 mb-1">Erstes Produkt anlegen</h2>
            <p className="text-sm text-gray-500 mb-5">
              Erstelle ein Produkt als Entwurf — die Datei kannst du danach im Dashboard hochladen.
            </p>
            <form onSubmit={productForm.handleSubmit(submitProduct)} className="space-y-4">
              {/* Type selector */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {PRODUCT_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => productForm.setValue('type', t.value as ProductData['type'])}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all',
                      selectedType === t.value
                        ? 'border-green-600 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-300',
                    )}
                  >
                    {t.icon}
                    <span className="text-xs font-medium">{t.label}</span>
                    <span className="text-[10px] opacity-60 leading-tight hidden sm:block">{t.desc}</span>
                  </button>
                ))}
              </div>

              <Input
                label="Titel"
                placeholder="z.B. 12-Wochen Trainingsplan"
                error={productForm.formState.errors.title?.message}
                {...productForm.register('title')}
              />
              <Input
                label="Preis (€)"
                type="number"
                step="0.01"
                min="0.50"
                placeholder="9.99"
                hint="Mindestpreis: 0,50 €"
                error={productForm.formState.errors.price?.message}
                {...productForm.register('price')}
              />
              <Textarea
                label="Beschreibung (optional)"
                placeholder="Beschreibe dein Produkt…"
                error={productForm.formState.errors.description?.message}
                {...productForm.register('description')}
              />

              {productError && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
                  {productError}
                </div>
              )}
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setStep(5)}>
                  Überspringen
                </Button>
                <Button type="submit" className="flex-1" loading={productForm.formState.isSubmitting}>
                  Entwurf speichern
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === 5 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center animate-slide-up">
            <div className="flex justify-center mb-5">
              <div className="h-16 w-16 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center shadow-sm">
                <Sparkles className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              Willkommen bei Ardore, {displayName}!
            </h2>
            <p className="text-gray-500 text-sm mb-6 leading-relaxed">
              Dein Coach-Profil ist eingerichtet.{' '}
              {productCreated
                ? 'Dein erstes Produkt wurde als Entwurf gespeichert — lade jetzt die Datei hoch und veröffentliche es.'
                : tierCreated
                ? 'Deine erste Preisstufe ist aktiv — Kunden können jetzt abonnieren.'
                : 'Erstelle jetzt Produkte und richte deine Preisstufen ein.'}
            </p>

            <div className="space-y-3">
              <Button className="w-full" size="lg" onClick={() => { router.push('/creator'); router.refresh() }}>
                Zum Dashboard
              </Button>
              {productCreated && (
                <Button variant="outline" className="w-full" onClick={() => router.push('/creator/products')}>
                  Produkt fertigstellen
                </Button>
              )}
              {!tierCreated && !productCreated && (
                <Button variant="outline" className="w-full" onClick={() => router.push('/creator/settings/tiers')}>
                  <Plus className="h-4 w-4" /> Abo-Preisstufe erstellen
                </Button>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
