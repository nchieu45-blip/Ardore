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
import { AuthShell } from '@/components/layout/AuthShell'
import { Users, Star } from 'lucide-react'
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
        data: { full_name: data.full_name, role },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/verify-success&type=signup`,
      },
    })
    if (signUpError) {
      if (signUpError.message === 'User already registered') {
        setError('Diese E-Mail-Adresse ist bereits registriert.')
      } else if (signUpError.message?.includes('Database error')) {
        setError('Datenbankfehler. Bitte stelle sicher, dass das Datenbankschema eingerichtet wurde.')
      } else {
        setError(signUpError.message)
      }
      return
    }
    router.push(`/verify-email?email=${encodeURIComponent(data.email)}`)
  }

  return (
    <AuthShell
      heading="Konto erstellen"
      subheading="Wähle, wie du Ardore nutzen möchtest"
      footer={
        <>
          Bereits ein Konto?{' '}
          <Link href="/login" className="text-green-600 font-medium hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      {/* Role selector */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {([
          { value: 'buyer', icon: <Users className="h-5 w-5" />, label: 'Als Kunde', sub: 'Inhalte kaufen & abonnieren' },
          { value: 'creator', icon: <Star className="h-5 w-5" />, label: 'Als Coach', sub: 'Inhalte verkaufen & verdienen' },
        ] as const).map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setRole(opt.value)}
            className={cn(
              'flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all text-center',
              role === opt.value
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            )}
          >
            {opt.icon}
            <span className="text-sm font-semibold">{opt.label}</span>
            <span className="text-xs opacity-70 leading-tight">{opt.sub}</span>
          </button>
        ))}
      </div>

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
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {role === 'creator' ? 'Als Coach registrieren' : 'Als Kunde registrieren'}
        </Button>
        <p className="text-xs text-gray-400 text-center">
          Mit der Registrierung stimmst du unseren{' '}
          <Link href="/agb" className="text-green-600 hover:underline">AGB</Link>
          {' '}und der{' '}
          <Link href="/datenschutz" className="text-green-600 hover:underline">Datenschutzerklärung</Link>
          {' '}zu.
        </p>
      </form>
    </AuthShell>
  )
}
