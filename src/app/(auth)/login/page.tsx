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

const schema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(1, 'Passwort erforderlich'),
})

type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') ?? '/'
  const supabase = createClient()
  const [error, setError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password })
    if (error) {
      setError('E-Mail oder Passwort falsch. Bitte versuche es erneut.')
      return
    }
    router.push(redirect)
    router.refresh()
  }

  return (
    <AuthShell
      heading="Willkommen zurück"
      subheading="Melde dich bei deinem Konto an"
      footer={
        <>
          Noch kein Konto?{' '}
          <Link href="/register" className="text-green-600 font-medium hover:underline">
            Jetzt registrieren
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input
          label="E-Mail-Adresse"
          type="email"
          placeholder="max@beispiel.de"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
        />
        <div>
          <Input
            label="Passwort"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />
          <div className="mt-1.5 text-right">
            <Link href="/forgot-password" className="text-xs text-green-600 hover:underline">
              Passwort vergessen?
            </Link>
          </div>
        </div>
        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Anmelden
        </Button>
      </form>
    </AuthShell>
  )
}
