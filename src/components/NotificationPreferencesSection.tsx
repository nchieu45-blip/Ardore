'use client'

import { useState } from 'react'
import { Bell } from 'lucide-react'

export interface NotifPrefs {
  email_new_booking: boolean
  email_session_reminder: boolean
  email_new_message: boolean
  email_new_video_class_booking: boolean
  inapp_new_booking: boolean
  inapp_session_reminder: boolean
  inapp_new_message: boolean
  inapp_new_video_class_booking: boolean
}

interface PrefItem {
  key: keyof NotifPrefs
  label: string
}

const EMAIL_BUYER: PrefItem[] = [
  { key: 'email_session_reminder',         label: 'Session-Erinnerungen' },
  { key: 'email_new_message',              label: 'Neue Nachrichten' },
]

const EMAIL_CREATOR: PrefItem[] = [
  { key: 'email_new_booking',              label: 'Neue 1:1-Buchungen' },
  { key: 'email_new_video_class_booking',  label: 'Neue Gruppen-Kurs-Anmeldungen' },
  { key: 'email_session_reminder',         label: 'Session-Erinnerungen' },
  { key: 'email_new_message',              label: 'Neue Nachrichten' },
]

const INAPP_BUYER: PrefItem[] = [
  { key: 'inapp_session_reminder',         label: 'Session-Erinnerungen' },
  { key: 'inapp_new_message',              label: 'Neue Nachrichten' },
]

const INAPP_CREATOR: PrefItem[] = [
  { key: 'inapp_new_booking',              label: 'Neue 1:1-Buchungen' },
  { key: 'inapp_new_video_class_booking',  label: 'Neue Gruppen-Kurs-Anmeldungen' },
  { key: 'inapp_session_reminder',         label: 'Session-Erinnerungen' },
  { key: 'inapp_new_message',             label: 'Neue Nachrichten' },
]

function Toggle({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 disabled:opacity-50 ${on ? 'bg-green-500' : 'bg-gray-200'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export default function NotificationPreferencesSection({
  initialPrefs,
  isCreator = false,
}: {
  initialPrefs: NotifPrefs
  isCreator?: boolean
}) {
  const [prefs, setPrefs] = useState<NotifPrefs>(initialPrefs)
  const [saving, setSaving] = useState<keyof NotifPrefs | null>(null)
  const [error, setError] = useState('')

  const emailPrefs = isCreator ? EMAIL_CREATOR : EMAIL_BUYER
  const inappPrefs = isCreator ? INAPP_CREATOR : INAPP_BUYER

  async function toggle(key: keyof NotifPrefs) {
    const newVal = !prefs[key]
    setPrefs(p => ({ ...p, [key]: newVal }))
    setSaving(key)
    setError('')
    try {
      const res = await fetch('/api/notification-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newVal }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setPrefs(p => ({ ...p, [key]: !newVal }))
      setError('Einstellung konnte nicht gespeichert werden.')
    } finally {
      setSaving(null)
    }
  }

  function Group({ title, items }: { title: string; items: PrefItem[] }) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{title}</p>
        <div className="divide-y divide-gray-50">
          {items.map(item => (
            <div key={item.key} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-gray-700">{item.label}</span>
              <Toggle
                on={prefs[item.key]}
                busy={saving === item.key}
                onToggle={() => toggle(item.key)}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="h-4 w-4 text-gray-500" />
        <h2 className="font-semibold text-gray-900 text-sm">Benachrichtigungen</h2>
      </div>
      <div className="space-y-5">
        <Group title="E-Mail" items={emailPrefs} />
        <Group title="In-App" items={inappPrefs} />
      </div>
      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
    </div>
  )
}
