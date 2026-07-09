'use client'

import { useState } from 'react'
import { FileText, Check, X, ExternalLink, Loader2 } from 'lucide-react'

interface VerificationRow {
  id: string
  original_filename: string
  created_at: string
  creator: {
    display_name: string
    slug: string
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function VerificationCard({ row, onDone }: { row: VerificationRow; onDone: (id: string) => void }) {
  const [loadingDoc, setLoadingDoc] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function openDoc() {
    setLoadingDoc(true)
    try {
      const res = await fetch(`/api/admin/verification-doc/${row.id}`)
      const json = await res.json()
      if (!res.ok) { alert(json.error); return }
      window.open(json.url, '_blank')
    } finally {
      setLoadingDoc(false)
    }
  }

  async function approve() {
    if (!confirm(`Verifizierung für ${row.creator.display_name} genehmigen?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/verifications/${row.id}/approve`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { alert(json.error); return }
      onDone(row.id)
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!reason.trim()) { alert('Bitte einen Ablehnungsgrund eingeben'); return }
    if (!confirm(`Antrag von ${row.creator.display_name} ablehnen?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/verifications/${row.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const json = await res.json()
      if (!res.ok) { alert(json.error); return }
      onDone(row.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 shadow-sm">
      {/* Coach info */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold text-gray-900">{row.creator.display_name}</p>
          <p className="text-xs text-gray-400 mt-0.5">Eingereicht: {fmtDate(row.created_at)}</p>
        </div>
        <a
          href={`/creators/${row.creator.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1 flex-shrink-0"
        >
          Profil <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* File info + view button */}
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
        <FileText className="h-4 w-4 text-gray-400 flex-shrink-0" />
        <span className="text-sm text-gray-600 truncate flex-1">{row.original_filename}</span>
        <button
          onClick={openDoc}
          disabled={loadingDoc}
          className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 flex-shrink-0"
        >
          {loadingDoc ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          Ansehen
        </button>
      </div>

      {/* Approve / Reject */}
      {!rejecting ? (
        <div className="flex gap-2">
          <button
            onClick={approve}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Genehmigen
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
            Ablehnen
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Ablehnungsgrund (wird dem Coach angezeigt)…"
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <div className="flex gap-2">
            <button
              onClick={reject}
              disabled={busy || !reason.trim()}
              className="flex-1 py-2 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {busy ? 'Wird abgelehnt…' : 'Ablehnung senden'}
            </button>
            <button
              onClick={() => { setRejecting(false); setReason('') }}
              disabled={busy}
              className="px-4 py-2 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminVerificationList({ initial }: { initial: VerificationRow[] }) {
  const [rows, setRows] = useState(initial)

  function remove(id: string) {
    setRows(prev => prev.filter(r => r.id !== id))
  }

  if (rows.length === 0) {
    return (
      <div className="py-20 text-center">
        <div className="h-16 w-16 rounded-2xl bg-green-50 flex items-center justify-center mx-auto mb-4">
          <Check className="h-7 w-7 text-green-600" />
        </div>
        <p className="text-gray-500 text-sm">Keine offenen Verifizierungsanträge.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {rows.map(row => (
        <VerificationCard key={row.id} row={row} onDone={remove} />
      ))}
    </div>
  )
}
