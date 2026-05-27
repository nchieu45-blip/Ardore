'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Flame, Mail } from 'lucide-react'

export default function VerifyEmailPage() {
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
    <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-green-600 font-bold text-2xl mb-4">
            <Flame className="h-7 w-7" />
            Ardore
          </Link>
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-50 flex items-center justify-center">
            <Mail className="h-8 w-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Bitte bestätige deine E-Mail</h1>
          <p className="text-gray-500 mt-2">
            Wir haben eine Bestätigungs-E-Mail an{' '}
            {email ? <strong className="text-gray-700">{email}</strong> : 'deine E-Mail-Adresse'} gesendet.
          </p>
        </div>

        <Card>
          <CardContent className="py-6 space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Klicke auf den Link in der E-Mail, um dein Konto zu aktivieren und dich anzumelden.
              Überprüfe auch deinen Spam-Ordner, falls du keine E-Mail erhalten hast.
            </p>

            {resent ? (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 text-center">
                E-Mail erneut gesendet!
              </div>
            ) : (
              <>
                {resendError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3 text-center">
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
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-600 mt-6">
          Falsches Konto?{' '}
          <Link href="/register" className="text-green-600 font-medium hover:underline">
            Neu registrieren
          </Link>
          {' · '}
          <Link href="/login" className="text-green-600 font-medium hover:underline">
            Anmelden
          </Link>
        </p>
      </div>
    </div>
  )
}
