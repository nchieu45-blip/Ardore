'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Flame } from 'lucide-react'

const schema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
})

type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
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
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    if (error) {
      setError('Fehler beim Senden der E-Mail. Bitte versuche es erneut.')
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-green-600 font-bold text-2xl mb-4">
            <Flame className="h-7 w-7" />
            Ardore
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Passwort zurücksetzen</h1>
          <p className="text-gray-500 mt-1">Wir senden dir einen Link per E-Mail</p>
        </div>

        <Card>
          <CardContent>
            {linkError && !sent && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3 mb-4">
                Dein Reset-Link ist ungültig oder abgelaufen. Bitte fordere unten einen neuen an.
              </div>
            )}
            {sent ? (
              <div className="text-center py-4 space-y-2">
                <p className="text-green-700 font-medium">E-Mail gesendet!</p>
                <p className="text-sm text-gray-500">
                  Prüfe dein Postfach und klicke auf den Link, um dein Passwort zurückzusetzen.
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
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
                    {error}
                  </div>
                )}
                <Button type="submit" className="w-full" loading={isSubmitting}>
                  Link senden
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-600 mt-6">
          <Link href="/login" className="text-green-600 font-medium hover:underline">
            Zurück zur Anmeldung
          </Link>
        </p>
      </div>
    </div>
  )
}
