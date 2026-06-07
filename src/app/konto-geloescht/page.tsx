import Link from 'next/link'
import type { Metadata } from 'next'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'

export const metadata: Metadata = { title: 'Konto gelöscht – Ardore' }

export default function AccountDeletedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="max-w-md w-full text-center">
        <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Dein Konto wurde gelöscht</h1>
        <p className="text-gray-500 mb-2">
          Alle deine Daten wurden dauerhaft und DSGVO-konform gelöscht.
        </p>
        <p className="text-gray-500 mb-8">
          Wir bedauern, dich gehen zu sehen. Du kannst jederzeit ein neues Konto erstellen.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button variant="outline">Zur Startseite</Button>
          </Link>
          <Link href="/register">
            <Button>Neues Konto erstellen</Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
