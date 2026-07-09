'use client'

import { useState, useRef } from 'react'
import { ShieldCheck, Clock, XCircle, Upload, FileText, CheckCircle2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

interface VerificationRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  rejection_reason: string | null
  created_at: string
}

interface Props {
  isVerified: boolean
  verifiedAt: string | null
  latestRequest: VerificationRequest | null
}

const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'])
const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
}

export default function VerificationSection({ isVerified, verifiedAt, latestRequest }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(f.type)) {
      setFileError('Nur PDF, JPG, PNG oder WEBP erlaubt')
      setFile(null)
      return
    }
    if (f.size > MAX_BYTES) {
      setFileError('Datei zu groß – max. 10 MB')
      setFile(null)
      return
    }
    setFileError('')
    setFile(f)
    e.target.value = ''
  }

  async function handleSubmit() {
    if (!file) return
    setSubmitting(true)
    try {
      const form = new FormData()
      form.append('document', file)
      const res = await fetch('/api/creator/verification', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Fehler beim Einreichen')
      toast.success('Antrag eingereicht — wir prüfen dein Dokument')
      // Reload to show updated state
      window.location.reload()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler')
      setSubmitting(false)
    }
  }

  // ── State: already verified ────────────────────────────────────────────
  if (isVerified) {
    return (
      <div className="flex items-start gap-3 p-4 bg-green-50 rounded-xl border border-green-200">
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-green-800 text-sm">Verifiziert</p>
          {verifiedAt && (
            <p className="text-xs text-green-700 mt-0.5">
              Verifiziert seit {fmtDate(verifiedAt)}
            </p>
          )}
          <p className="text-xs text-green-600 mt-1">
            Dein Verifiziert-Siegel erscheint in deinem Profil und in der Coach-Übersicht.
          </p>
        </div>
      </div>
    )
  }

  // ── State: pending ─────────────────────────────────────────────────────
  if (latestRequest?.status === 'pending') {
    return (
      <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-xl border border-amber-200">
        <Clock className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-amber-800 text-sm">Eingereicht — wird geprüft</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Eingereicht am {fmtDate(latestRequest.created_at)}. Wir melden uns bei dir.
          </p>
        </div>
      </div>
    )
  }

  const isRejected = latestRequest?.status === 'rejected'

  // ── State: rejected or never submitted → show upload form ─────────────
  return (
    <div className="space-y-4">
      {/* Benefit explanation */}
      <div className="flex items-start gap-3 p-4 bg-green-50 rounded-xl border border-green-100">
        <ShieldCheck className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium text-green-900 mb-1">
            Verifizierte Coaches erhalten ein Siegel im Profil und in der Coach-Übersicht
          </p>
          <p className="text-green-700 text-xs leading-relaxed">
            Die Verifizierung ist optional — du verkaufst auch ohne sie. Mit Siegel können Kunden
            sehen, dass du ein geprüftes Zertifikat hast.
          </p>
        </div>
      </div>

      {/* Rejection note */}
      {isRejected && latestRequest?.rejection_reason && (
        <div className="flex items-start gap-3 p-4 bg-red-50 rounded-xl border border-red-200">
          <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-red-700">Antrag abgelehnt</p>
            <p className="text-red-600 mt-0.5 text-xs">{latestRequest.rejection_reason}</p>
            <p className="text-red-500 mt-1 text-xs">Du kannst einen neuen Antrag einreichen.</p>
          </div>
        </div>
      )}

      {/* Upload field */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-1.5">
          Zertifikat oder Qualifikationsnachweis hochladen
        </p>
        {file ? (
          <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
            <FileText className="h-4 w-4 text-gray-500 flex-shrink-0" />
            <span className="text-sm text-gray-700 truncate flex-1">{file.name}</span>
            <button
              type="button"
              onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = '' }}
              className="text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
            >
              Entfernen
            </button>
          </div>
        ) : (
          <label
            className={cn(
              'flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-xl cursor-pointer transition-all',
              'border-gray-200 hover:border-green-400 hover:bg-gray-50/60'
            )}
          >
            <div className="flex flex-col items-center gap-2 text-center px-4">
              <div className="h-9 w-9 rounded-full bg-gray-100 flex items-center justify-center">
                <Upload className="h-4.5 w-4.5 text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-700">Dokument auswählen</p>
              <p className="text-xs text-gray-400">PDF, JPG, PNG, WEBP – max. 10 MB</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleFileChange}
            />
          </label>
        )}
        {fileError && <p className="mt-1.5 text-xs text-red-600">{fileError}</p>}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!file || submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ShieldCheck className="h-4 w-4" />
        {submitting ? 'Wird eingereicht…' : 'Antrag einreichen'}
      </button>
    </div>
  )
}
