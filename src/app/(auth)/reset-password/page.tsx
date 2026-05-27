'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { Flame } from 'lucide-react'

const schema = z.object({
  password: z.string().min(8, 'Mindestens 8 Zeichen'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwörter stimmen nicht überein',
  path: ['confirmPassword'],
})

type FormData = z.infer<typeof schema>

type Status = 'checking' | 'ready' | 'invalid'

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState<Status>('checking')
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    // Primary path: /auth/callback already exchanged the code and set the
    // session in cookies. getSession() reads it immediately.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setStatus('ready')
        return
      }

      // Fallback A: direct PKCE link (user somehow bypassed /auth/callback)
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        supabase.auth.exchangeCodeForSession(code)
          .then(({ error }) => {
            if (error) {
              setStatus('invalid')
            } else {
              window.history.replaceState({}, '', window.location.pathname)
              setStatus('ready')
            }
          })
          .catch(() => setStatus('invalid'))
        return
      }

      // Fallback B: implicit-flow hash token — wait for PASSWORD_RECOVERY event
      if (window.location.hash.includes('type=recovery')) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') setStatus('ready')
        })
        unsubscribe = () => subscription.unsubscribe()
        return
      }

      // No session, no code, no recovery hash → link is missing or expired
      setStatus('invalid')
    })

    return () => unsubscribe?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setSubmitError('')
    const { error } = await supabase.auth.updateUser({ password: data.password })
    if (error) {
      setSubmitError('Fehler beim Zurücksetzen des Passworts. Bitte versuche es erneut.')
      return
    }
    router.push('/login')
  }

  return (
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-green-600 font-bold text-2xl mb-4">
            <Flame className="h-7 w-7" />
            Ardore
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Neues Passwort setzen</h1>
          <p className="text-gray-500 mt-1">Wähle ein neues Passwort für dein Konto</p>
        </div>

        <Card>
          <CardContent>
            {status === 'checking' && (
              <p className="text-center text-gray-500 py-4">Link wird überprüft…</p>
            )}

            {status === 'invalid' && (
              <div className="text-center py-4 space-y-3">
                <p className="text-red-600 font-medium">Dieser Link ist ungültig oder abgelaufen.</p>
                <p className="text-sm text-gray-500">Bitte fordere einen neuen Reset-Link an.</p>
                <Link href="/forgot-password" className="inline-block text-sm text-green-600 font-medium hover:underline">
                  Neuen Link anfordern →
                </Link>
              </div>
            )}

            {status === 'ready' && (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input
                  label="Neues Passwort"
                  type="password"
                  placeholder="Mindestens 8 Zeichen"
                  autoComplete="new-password"
                  error={errors.password?.message}
                  {...register('password')}
                />
                <Input
                  label="Passwort bestätigen"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  error={errors.confirmPassword?.message}
                  {...register('confirmPassword')}
                />
                {submitError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">
                    {submitError}
                  </div>
                )}
                <Button type="submit" className="w-full" loading={isSubmitting}>
                  Passwort ändern
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
