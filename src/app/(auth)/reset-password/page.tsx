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
import { AuthShell } from '@/components/layout/AuthShell'
import { LockKeyhole, AlertCircle, Loader2 } from 'lucide-react'

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

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) { setStatus('ready'); return }

      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        supabase.auth.exchangeCodeForSession(code)
          .then(({ error }) => {
            if (error) setStatus('invalid')
            else { window.history.replaceState({}, '', window.location.pathname); setStatus('ready') }
          })
          .catch(() => setStatus('invalid'))
        return
      }

      if (window.location.hash.includes('type=recovery')) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') setStatus('ready')
        })
        unsubscribe = () => subscription.unsubscribe()
        return
      }

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
    if (error) { setSubmitError('Fehler beim Zurücksetzen. Bitte versuche es erneut.'); return }
    router.push('/login')
  }

  return (
    <AuthShell
      heading="Neues Passwort setzen"
      subheading="Wähle ein sicheres Passwort für dein Konto"
      icon={<LockKeyhole className="h-6 w-6 text-green-600" />}
      footer={
        <Link href="/login" className="text-green-600 font-medium hover:underline">
          ← Zurück zur Anmeldung
        </Link>
      }
    >
      {status === 'checking' && (
        <div className="flex flex-col items-center gap-3 py-6 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Link wird überprüft…</p>
        </div>
      )}

      {status === 'invalid' && (
        <div className="text-center py-4 space-y-3">
          <div className="flex justify-center">
            <AlertCircle className="h-10 w-10 text-red-400" />
          </div>
          <p className="font-semibold text-gray-900">Link ungültig oder abgelaufen</p>
          <p className="text-sm text-gray-500">Bitte fordere einen neuen Reset-Link an.</p>
          <Link href="/forgot-password">
            <Button variant="outline" className="mt-2">Neuen Link anfordern</Button>
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
            <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
              {submitError}
            </div>
          )}
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Passwort ändern
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
