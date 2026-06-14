'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { AuthShell } from '@/components/layout/AuthShell'
import { Mail, CheckCircle } from 'lucide-react'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const supabase = createClient()
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')

  async function resend() {
    if (!email) return
    setResending(true)
    setResendError('')
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/verify-success&type=signup`,
      },
    })
    setResending(false)
    if (error) {
      setResendError('Fehler beim Senden. Bitte versuche es erneut.')
    } else {
      setResent(true)
    }
  }

  return (
    <AuthShell
      heading="Bitte bestätige deine E-Mail"
      subheading={email ? `Wir haben eine E-Mail an ${email} gesendet` : 'Wir haben dir eine Bestätigungs-E-Mail gesendet'}
      icon={<Mail className="h-6 w-6 text-green-600" />}
      footer={
        <>
          Falsches Konto?{' '}
          <Link href="/register" className="text-green-600 font-medium hover:underline">
            Neu registrieren
          </Link>
          {' · '}
          <Link href="/login" className="text-green-600 font-medium hover:underline">
            Anmelden
          </Link>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-600 text-center">
          Klicke auf den Link in der E-Mail, um dein Konto zu aktivieren.
          Überprüfe auch deinen Spam-Ordner, falls du keine E-Mail erhalten hast.
        </p>

        {resent ? (
          <div className="flex items-center gap-2 justify-center bg-green-50 border border-green-100 text-green-700 text-sm rounded-xl px-4 py-3">
            <CheckCircle className="h-4 w-4 flex-shrink-0" />
            E-Mail erneut gesendet!
          </div>
        ) : (
          <>
            {resendError && (
              <div className="bg-red-50 border border-red-100 text-red-600 text-sm rounded-xl px-4 py-3 text-center">
                {resendError}
              </div>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={resend}
              loading={resending}
              disabled={!email}
            >
              E-Mail erneut senden
            </Button>
          </>
        )}
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
