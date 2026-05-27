'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Flame, Users, Star } from 'lucide-react'
import { cn } from '@/lib/utils'

const schema = z.object({
  full_name: z.string().min(2, 'Mindestens 2 Zeichen'),
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(8, 'Mindestens 8 Zeichen'),
})

type FormData = z.infer<typeof schema>

export default function RegisterPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const defaultRole = searchParams.get('role') === 'creator' ? 'creator' : 'buyer'
  const [role, setRole] = useState<'buyer' | 'creator'>(defaultRole)
  const [error, setError] = useState('')
  const supabase = createClient()

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name,
          role,
        },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/verify-success&type=signup`,
      },
    })

    if (signUpError) {
      console.error('Supabase signUp error:', signUpError)
      if (signUpError.message === 'User already registered') {
        setError('Diese E-Mail-Adresse ist bereits registriert.')
      } else if (signUpError.message?.includes('Database error')) {
        setError('Datenbankfehler: Bitte stelle sicher, dass das Datenbankschema eingerichtet wurde.')
      } else {
        setError(`Fehler: ${signUpError.message}`)
      }
      return
    }

    router.push(`/verify-email?email=${encodeURIComponent(data.email)}`)
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-green-600 font-bold text-2xl mb-4">
            <Flame className="h-7 w-7" />
            Ardore
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Konto erstellen</h1>
          <p className="text-gray-500 mt-1">Wähle, wie du Ardore nutzen möchtest</p>
        </div>

        {/* Role selector */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setRole('buyer')}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
              role === 'buyer'
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            )}
          >
            <Users className="h-6 w-6" />
            <span className="text-sm font-medium">Als Kunde</span>
            <span className="text-xs opacity-70">Inhalte kaufen & abonnieren</span>
          </button>
          <button
            type="button"
            onClick={() => setRole('creator')}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
              role === 'creator'
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            )}
          >
            <Star className="h-6 w-6" />
            <span className="text-sm font-medium">Als Coach</span>
            <span className="text-xs opacity-70">Inhalte verkaufen & verdienen</span>
          </button>
        </div>

        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input
                label="Vollständiger Name"
                type="text"
                placeholder="Max Mustermann"
                autoComplete="name"
                error={errors.full_name?.message}
                {...register('full_name')}
              />
              <Input
                label="E-Mail-Adresse"
                type="email"
                placeholder="max@beispiel.de"
                autoComplete="email"
                error={errors.email?.message}
                {...register('email')}
              />
              <Input
                label="Passwort"
                type="password"
                placeholder="Mindestens 8 Zeichen"
                autoComplete="new-password"
                error={errors.password?.message}
                {...register('password')}
              />

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" loading={isSubmitting}>
                {role === 'creator' ? 'Als Coach registrieren' : 'Als Kunde registrieren'}
              </Button>
            </form>

            <p className="text-xs text-gray-500 text-center mt-4">
              Mit der Registrierung stimmst du unseren{' '}
              <Link href="/agb" className="text-green-600 hover:underline">AGB</Link>
              {' '}und der{' '}
              <Link href="/datenschutz" className="text-green-600 hover:underline">Datenschutzerklärung</Link>
              {' '}zu.
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-600 mt-6">
          Bereits ein Konto?{' '}
          <Link href="/login" className="text-green-600 font-medium hover:underline">
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  )
}
