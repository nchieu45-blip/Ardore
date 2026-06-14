'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AuthShell } from '@/components/layout/AuthShell'
import { KeyRound, CheckCircle } from 'lucide-react'

const schema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
})

type FormData = z.infer<typeof schema>

function ForgotPasswordContent() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password&type=recovery`,
    })
    if (error) {
      setError('Fehler beim Senden der E-Mail. Bitte versuche es erneut.')
      return
    }
    setSent(true)
  }

  return (
    <AuthShell
      heading="Passwort zurücksetzen"
      subheading="Wir senden dir einen Link per E-Mail"
      icon={<KeyRound className="h-6 w-6 text-green-600" />}
      footer={
        <Link href="/login" className="text-green-600 font-medium hover:underline">
          ← Zurück zur Anmeldung
        </Link>
      }
    >
      {linkError && !sent && (
        <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3 mb-4">
          Dein Reset-Link ist ungültig oder abgelaufen. Bitte fordere unten einen neuen an.
        </div>
      )}

      {sent ? (
        <div className="text-center py-4 space-y-3">
          <div className="flex justify-center">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <p className="font-semibold text-gray-900">E-Mail gesendet!</p>
          <p className="text-sm text-gray-500">
            Prüfe dein Postfach und klicke auf den Link, um dein Passwort zurückzusetzen. Schau auch im Spam-Ordner nach.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label="E-Mail-Adresse"
            type="email"
            placeholder="max@beispiel.de"
            autoComplete="email"
            error={errors.email?.message}
            {...register('email')}
          />
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Link senden
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-sm text-gray-400">Lädt…</p></div>}>
      <ForgotPasswordContent />
    </Suspense>
  )
}
