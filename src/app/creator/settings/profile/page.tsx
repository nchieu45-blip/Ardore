'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { CategoryPicker, ServicePicker } from '@/components/ui/CategoryPicker'
import { getInitials } from '@/lib/utils'
import { ArrowLeft, Camera, GraduationCap, Globe, Music2, Plus, X } from 'lucide-react'
import { InstagramIcon, YoutubeIcon } from '@/components/ui/SocialIcons'
import Link from 'next/link'
import { toast } from '@/lib/toast'
import {
  normalizeInstagram, normalizeTiktok, normalizeYoutube, normalizeWebsite,
  isValidHandle, isValidYoutube, isValidWebsite,
} from '@/lib/socialLinks'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResolver = any

const schema = z.object({
  display_name: z.string().min(2, 'Mindestens 2 Zeichen').max(50, 'Maximal 50 Zeichen'),
  bio: z.string().max(500, 'Maximal 500 Zeichen').optional(),
})

type FormData = z.infer<typeof schema>

const MAX_AVATAR_BYTES = 5 * 1024 * 1024   // 5 MB
const MAX_BANNER_BYTES = 10 * 1024 * 1024  // 10 MB

export default function ProfileSettingsPage() {
  const router = useRouter()
  const supabase = createClient()

  const [creatorId, setCreatorId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [categoryError, setCategoryError] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [qualifications, setQualifications] = useState<string[]>([])
  const [qualInput, setQualInput] = useState('')

  const [instagram, setInstagram] = useState('')
  const [tiktok, setTiktok] = useState('')
  const [youtube, setYoutube] = useState('')
  const [website, setWebsite] = useState('')
  const [socialErrors, setSocialErrors] = useState<{ instagram?: string; tiktok?: string; youtube?: string; website?: string }>({})

  // Images: current URLs + selected files + local previews
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [bannerUrl, setBannerUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [bannerFile, setBannerFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as AnyResolver,
  })

  const bioValue = watch('bio') ?? ''

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/login'); return }

        const { data: creator } = await supabase
          .from('creator_profiles')
          .select('id, display_name, bio, category, categories, services, qualifications, avatar_url, banner_url, social_links')
          .eq('user_id', user.id)
          .single()

        if (!creator) { router.push('/creator/onboarding'); return }

        setCreatorId(creator.id)
        setDisplayName(creator.display_name)
        setAvatarUrl(creator.avatar_url)
        setBannerUrl(creator.banner_url)
        setSelectedCategories(
          (creator.categories as string[] | null)?.length
            ? (creator.categories as string[])
            : creator.category ? [creator.category] : []
        )
        setSelectedServices((creator.services as string[] | null) ?? [])
        setQualifications((creator.qualifications as string[] | null) ?? [])

        const social = (creator.social_links as Record<string, string> | null) ?? {}
        setInstagram(social.instagram ?? '')
        setTiktok(social.tiktok ?? '')
        setYoutube(social.youtube ?? '')
        setWebsite(social.website ?? '')

        reset({
          display_name: creator.display_name,
          bio: creator.bio ?? '',
        })

        setLoading(false)
      } catch (err) {
        console.log('[creator/settings/profile] load error:', err)
      }
    }
    load()
  }, [router, supabase, reset])

  function pickFile(
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'avatar' | 'banner',
  ) {
    setImageError('')
    const file = e.target.files?.[0]
    if (!file) return

    const maxBytes = type === 'avatar' ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES
    const maxLabel = type === 'avatar' ? '5 MB' : '10 MB'

    if (!file.type.startsWith('image/')) {
      setImageError('Nur Bilddateien sind erlaubt.')
      return
    }
    if (file.size > maxBytes) {
      setImageError(`Bild ist zu groß. Maximum: ${maxLabel}.`)
      return
    }

    const preview = URL.createObjectURL(file)
    if (type === 'avatar') {
      setAvatarFile(file)
      setAvatarPreview(preview)
    } else {
      setBannerFile(file)
      setBannerPreview(preview)
    }
  }

  async function uploadImage(file: File, path: string): Promise<string> {
    const { error: uploadError } = await supabase.storage
      .from('profile-images')
      .upload(path, file, { upsert: true, contentType: file.type })

    if (uploadError) throw uploadError

    const { data } = supabase.storage.from('profile-images').getPublicUrl(path)
    // Bust cache so the browser fetches the new image
    return `${data.publicUrl}?t=${Date.now()}`
  }

  async function onSubmit(data: FormData) {
    setImageError('')
    if (selectedCategories.length === 0) {
      setCategoryError('Bitte wähle mindestens eine Kategorie')
      return
    }
    setCategoryError('')

    const normInstagram = normalizeInstagram(instagram)
    const normTiktok = normalizeTiktok(tiktok)
    const normYoutube = normalizeYoutube(youtube)
    const normWebsite = normalizeWebsite(website)

    const nextSocialErrors: typeof socialErrors = {}
    if (normInstagram && !isValidHandle(normInstagram)) {
      nextSocialErrors.instagram = 'Ungültiger Instagram-Handle (max. 30 Zeichen, Buchstaben/Zahlen/./_).'
    }
    if (normTiktok && !isValidHandle(normTiktok)) {
      nextSocialErrors.tiktok = 'Ungültiger TikTok-Handle (max. 30 Zeichen, Buchstaben/Zahlen/./_).'
    }
    if (normYoutube && !isValidYoutube(normYoutube)) {
      nextSocialErrors.youtube = 'Ungültiger YouTube-Kanal oder -Link.'
    }
    if (normWebsite && !isValidWebsite(normWebsite)) {
      nextSocialErrors.website = 'Ungültige Website-URL.'
    }
    setSocialErrors(nextSocialErrors)
    if (Object.keys(nextSocialErrors).length > 0) return

    let newAvatarUrl = avatarUrl
    let newBannerUrl = bannerUrl

    try {
      if (avatarFile) {
        newAvatarUrl = await uploadImage(avatarFile, `${creatorId}/avatar`)
      }
      if (bannerFile) {
        newBannerUrl = await uploadImage(bannerFile, `${creatorId}/banner`)
      }
    } catch {
      setImageError('Bild-Upload fehlgeschlagen. Prüfe ob der Storage-Bucket "profile-images" existiert.')
      return
    }

    const { error: updateError } = await supabase
      .from('creator_profiles')
      .update({
        display_name: data.display_name,
        bio: data.bio || null,
        category: selectedCategories[0] ?? null,
        categories: selectedCategories,
        services: selectedServices,
        qualifications: qualifications.filter(q => q.trim().length > 0),
        avatar_url: newAvatarUrl,
        banner_url: newBannerUrl,
        social_links: {
          ...(normInstagram && { instagram: normInstagram }),
          ...(normTiktok && { tiktok: normTiktok }),
          ...(normYoutube && { youtube: normYoutube }),
          ...(normWebsite && { website: normWebsite }),
        },
      })
      .eq('id', creatorId)

    if (updateError) {
      toast.error('Speichern fehlgeschlagen. Bitte versuche es erneut.')
      return
    }

    setDisplayName(data.display_name)
    setAvatarUrl(newAvatarUrl)
    setBannerUrl(newBannerUrl)
    setAvatarFile(null)
    setBannerFile(null)
    setInstagram(normInstagram)
    setTiktok(normTiktok)
    setYoutube(normYoutube)
    setWebsite(normWebsite)
    toast.success('Profil gespeichert')
  }

  if (loading) {
    return <div className="max-w-2xl mx-auto px-4 py-8 text-gray-500">Lädt...</div>
  }

  const avatarSrc = avatarPreview ?? avatarUrl
  const bannerSrc = bannerPreview ?? bannerUrl

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link
        href="/creator/settings"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zu Einstellungen
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Coach-Profil bearbeiten</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Banner + Avatar */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900 text-sm">Profilbild & Banner</h2>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Banner */}
            <div className="relative">
              <div
                className="h-36 rounded-xl overflow-hidden bg-gradient-to-br from-green-400 to-green-600 relative group cursor-pointer"
                onClick={() => bannerInputRef.current?.click()}
              >
                {bannerSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={bannerSrc} alt="Banner" className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2">
                    <Camera className="h-5 w-5 text-gray-700" />
                  </div>
                </div>
              </div>
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickFile(e, 'banner')}
              />

              {/* Avatar overlapping banner */}
              <div className="absolute bottom-0 left-5 translate-y-1/2">
                <div
                  className="relative h-20 w-20 rounded-full ring-4 ring-white overflow-hidden cursor-pointer group"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatarSrc} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-green-100 flex items-center justify-center text-green-700 text-xl font-semibold">
                      {getInitials(displayName || 'C')}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <Camera className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => pickFile(e, 'avatar')}
                />
              </div>
            </div>

            {/* Spacer for avatar overlap */}
            <div className="mt-14 flex gap-3 text-xs text-gray-500">
              <span>Profilbild: max. 5 MB</span>
              <span>·</span>
              <span>Banner: max. 10 MB</span>
            </div>

            {imageError && (
              <p className="mt-2 text-xs text-red-600">{imageError}</p>
            )}
          </CardContent>
        </Card>

        {/* Profile fields */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900 text-sm">Profilinformationen</h2>
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            <Input
              label="Coach-Name"
              placeholder="z.B. Fitness mit Max"
              error={errors.display_name?.message}
              {...register('display_name')}
            />

            <CategoryPicker
              selected={selectedCategories}
              onChange={(cats) => { setSelectedCategories(cats); if (cats.length > 0) setCategoryError('') }}
              error={categoryError}
            />

            <ServicePicker
              selected={selectedServices}
              onChange={setSelectedServices}
            />

            {/* Qualifications */}
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                Qualifikationen &amp; Zertifikate
              </label>
              <p className="text-xs text-gray-400 mb-3">
                Füge deine Ausbildung, Studium oder Zertifikate hinzu. Coaches mit hinterlegten Qualifikationen erhalten ein Badge auf ihrem Profil.
              </p>
              {qualifications.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {qualifications.map((q, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-green-50 border border-green-200 text-green-800 text-xs font-medium rounded-full">
                      <GraduationCap className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                      {q}
                      <button
                        type="button"
                        onClick={() => setQualifications(prev => prev.filter((_, j) => j !== i))}
                        className="h-4 w-4 rounded-full hover:bg-green-200 flex items-center justify-center transition-colors ml-0.5"
                        aria-label="Entfernen"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={qualInput}
                  onChange={e => setQualInput(e.target.value)}
                  onKeyDown={e => {
                    if ((e.key === 'Enter' || e.key === ',') && qualInput.trim()) {
                      e.preventDefault()
                      setQualifications(prev => [...prev, qualInput.trim()])
                      setQualInput('')
                    }
                  }}
                  placeholder="z.B. B.Sc. Sportwissenschaft, Personal Trainer IHK…"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 hover:border-gray-400"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (qualInput.trim()) {
                      setQualifications(prev => [...prev, qualInput.trim()])
                      setQualInput('')
                    }
                  }}
                  disabled={!qualInput.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Hinzufügen
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Textarea
                label="Über mich"
                placeholder="Erzähl deinen Kunden, wer du bist und was du anbietest..."
                rows={4}
                error={errors.bio?.message}
                {...register('bio')}
              />
              <p className={`text-xs self-end ${bioValue.length > 480 ? 'text-amber-600' : 'text-gray-400'}`}>
                {bioValue.length} / 500
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Social media */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900 text-sm">Social Media</h2>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <p className="text-xs text-gray-400 -mt-1">
              Bringst du deine eigene Community mit? Verlinke deine Kanäle — das schafft Vertrauen bei neuen Kund:innen.
            </p>

            <div className="flex gap-3 items-start">
              <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 mt-6">
                <InstagramIcon className="h-4 w-4 text-gray-500" />
              </div>
              <Input
                label="Instagram"
                placeholder="dein.handle"
                hint="Ohne @"
                value={instagram}
                onChange={e => setInstagram(e.target.value)}
                error={socialErrors.instagram}
                className="flex-1"
              />
            </div>

            <div className="flex gap-3 items-start">
              <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 mt-6">
                <Music2 className="h-4 w-4 text-gray-500" />
              </div>
              <Input
                label="TikTok"
                placeholder="dein.handle"
                hint="Ohne @"
                value={tiktok}
                onChange={e => setTiktok(e.target.value)}
                error={socialErrors.tiktok}
                className="flex-1"
              />
            </div>

            <div className="flex gap-3 items-start">
              <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 mt-6">
                <YoutubeIcon className="h-4 w-4 text-gray-500" />
              </div>
              <Input
                label="YouTube"
                placeholder="Kanal-Handle oder -Link"
                value={youtube}
                onChange={e => setYoutube(e.target.value)}
                error={socialErrors.youtube}
                className="flex-1"
              />
            </div>

            <div className="flex gap-3 items-start">
              <div className="h-9 w-9 rounded-lg bg-gray-50 flex items-center justify-center flex-shrink-0 mt-6">
                <Globe className="h-4 w-4 text-gray-500" />
              </div>
              <Input
                label="Website"
                placeholder="https://deine-website.de"
                value={website}
                onChange={e => setWebsite(e.target.value)}
                error={socialErrors.website}
                className="flex-1"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Link href="/creator/settings">
            <Button type="button" variant="outline">Abbrechen</Button>
          </Link>
          <Button type="submit" loading={isSubmitting} className="flex-1 sm:flex-none sm:min-w-36">
            Änderungen speichern
          </Button>
        </div>
      </form>
    </div>
  )
}
