'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { appOrigin } from '@/lib/app-url'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AuthShell } from '@/components/layout/AuthShell'
import { Mail, CheckCircle } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const supabase = createClient()
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')
  const [cooldown, setCooldown] = useState(searchParams.get('sent') === '1' ? 60 : 0)
  const inFlight = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => setCooldown(value => Math.max(0, value - 1)), 1000)
    return () => clearInterval(interval)
  }, [])

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current || cooldown > 0) return
    inFlight.current = true
    setResending(true)
    setResendError('')
    setResent(false)
    // Supabase enforces the server-side SMTP frequency and project rate limits.
    setCooldown(60)
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: `${appOrigin()}/auth/callback?next=/verify-success&type=signup` },
      })
      if (error) {
        setResendError(error.status === 429
          ? 'Bitte warte einen Moment, bevor du eine weitere E-Mail anforderst.'
          : 'Die E-Mail konnte nicht angefordert werden. Bitte versuche es später erneut.')
      } else {
        setResent(true)
      }
    } catch {
      setResendError('Die E-Mail konnte nicht angefordert werden. Bitte prüfe deine Verbindung und versuche es später erneut.')
    } finally {
      inFlight.current = false
      setResending(false)
    }
  }

  return (
    <AuthShell
      heading="Bitte bestätige deine E-Mail"
      subheading="Erst nach der Bestätigung kannst du dich anmelden und Ardore nutzen"
      icon={<Mail className="h-6 w-6 text-green-600" />}
      footer={
        <>
          Bereits bestätigt?{' '}
          <Link href="/login" className="text-green-600 font-medium hover:underline">Anmelden</Link>
          {' · '}
          <Link href="/register" className="text-green-600 font-medium hover:underline">Neu registrieren</Link>
        </>
      }
    >
      <div className="space-y-4">
        {searchParams.get('error') === 'link_invalid' && (
          <div role="alert" className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">
            Dieser Bestätigungslink ist ungültig oder abgelaufen. Falls du dein Konto bereits bestätigt hast, melde dich an. Sonst kannst du eine neue E-Mail anfordern.
          </div>
        )}
        <p className="text-sm text-gray-600 text-center">
          Klicke auf den Link in der Bestätigungs-E-Mail. Überprüfe auch deinen Spam-Ordner.
          Falls keine E-Mail ankommt, kannst du sie unten erneut anfordern.
        </p>
        {resent && (
          <div role="status" className="flex items-start gap-2 bg-green-50 border border-green-100 text-green-700 text-sm rounded-xl px-4 py-3">
            <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            Wenn für diese Adresse eine Bestätigung aussteht, erhältst du eine neue E-Mail.
          </div>
        )}
        <form onSubmit={resend} className="space-y-4">
          <Input label="E-Mail-Adresse" type="email" autoComplete="email" required value={email}
            onChange={event => setEmail(event.target.value)} disabled={resending} />
          {resendError && (
            <div role="alert" className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3">{resendError}</div>
          )}
          <Button type="submit" variant="outline" className="w-full" loading={resending} disabled={!email.trim() || cooldown > 0}>
            {cooldown > 0 ? `Erneut senden in ${cooldown} Sekunden` : 'E-Mail erneut senden'}
          </Button>
        </form>
      </div>
    </AuthShell>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-sm text-gray-400">Lädt…</p></div>}>
      <VerifyEmailContent />
    </Suspense>
  )
}
