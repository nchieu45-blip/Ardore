'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { slugify } from '@/lib/utils'
import { Flame } from 'lucide-react'

const schema = z.object({
  display_name: z.string().min(2, 'Mindestens 2 Zeichen').max(50),
  bio: z.string().max(500).optional(),
  category: z.string().min(1, 'Bitte wähle eine Kategorie'),
})

type FormData = z.infer<typeof schema>

const CATEGORIES = [
  { value: '', label: 'Kategorie wählen...' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'ernaehrung', label: 'Ernährung' },
  { value: 'mental', label: 'Mental Health' },
  { value: 'abnehmen', label: 'Abnehmen' },
  { value: 'schlaf', label: 'Schlaf' },
  { value: 'yoga', label: 'Yoga' },
  { value: 'laufen', label: 'Laufen' },
  { value: 'krafttraining', label: 'Krafttraining' },
  { value: 'meditation', label: 'Meditation' },
  { value: 'stressmanagement', label: 'Stressmanagement' },
  { value: 'rueckenschmerzen', label: 'Rückenschmerzen' },
  { value: 'schwangerschaft', label: 'Schwangerschaft & Postnatal' },
  { value: 'mobility', label: 'Mobility & Dehnen' },
]

export default function CreatorOnboardingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [error, setError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const slug = slugify(data.display_name) + '-' + Math.random().toString(36).slice(2, 6)

    const { error: insertError } = await supabase.from('creator_profiles').insert({
      user_id: user.id,
      display_name: data.display_name,
      slug,
      bio: data.bio ?? null,
      category: data.category,
    })

    if (insertError) {
      setError('Fehler beim Erstellen des Profils. Bitte versuche es erneut.')
      return
    }

    router.push('/creator')
    router.refresh()
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-green-100 mb-4">
            <Flame className="h-7 w-7 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Richte dein Coach-Profil ein</h1>
          <p className="text-gray-500 mt-1">Nur noch wenige Schritte bis du loslegen kannst</p>
        </div>

        <Card>
          <CardHeader>
            <p className="text-sm font-medium text-gray-700">Schritt 1 von 1 – Profil-Informationen</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <Input
                label="Anzeigename / Coach-Name"
                placeholder="z.B. Fitness mit Max"
                hint="Dieser Name wird auf deinem öffentlichen Profil angezeigt"
                error={errors.display_name?.message}
                {...register('display_name')}
              />
              <Select
                label="Kategorie"
                options={CATEGORIES}
                error={errors.category?.message}
                {...register('category')}
              />
              <Textarea
                label="Über mich (optional)"
                placeholder="Erzähl deinen Kunden, wer du bist und was du anbietest..."
                hint="Max. 500 Zeichen"
                error={errors.bio?.message}
                {...register('bio')}
              />

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
                Profil erstellen & loslegen
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
