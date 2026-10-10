'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Cookie, ChevronDown, ChevronUp } from 'lucide-react'
import { readConsent, saveConsent, REOPEN_EVENT } from '@/lib/cookie-consent'

function Toggle({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={id}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-11 w-11 flex-shrink-0 items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded-lg ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-green-600' : 'bg-gray-200'}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </span>
    </button>
  )
}

export default function CookieBanner() {
  const [visible,      setVisible]      = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [stats,        setStats]        = useState(false)
  const [marketing,    setMarketing]    = useState(false)

  useEffect(() => {
    if (!readConsent()) setVisible(true) // eslint-disable-line react-hooks/set-state-in-effect

    function onReopen() {
      const existing = readConsent()
      if (existing) {
        setStats(existing.statistics)
        setMarketing(existing.marketing)
      }
      setVisible(true)
    }

    window.addEventListener(REOPEN_EVENT, onReopen)
    return () => window.removeEventListener(REOPEN_EVENT, onReopen)
  }, [])

  function acceptAll() {
    saveConsent(true, true)
    setVisible(false)
    setShowSettings(false)
  }

  function acceptNecessary() {
    saveConsent(false, false)
    setVisible(false)
    setShowSettings(false)
  }

  function saveSettings() {
    saveConsent(stats, marketing)
    setVisible(false)
    setShowSettings(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] p-3 sm:p-4 flex justify-center animate-slide-up">
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-100 max-h-[calc(100svh-1.5rem)] sm:max-h-[calc(100svh-2rem)] overflow-y-auto overscroll-contain">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 sm:px-5 pt-5 pb-4">
          <div className="h-9 w-9 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Cookie className="h-4.5 w-4.5 text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 text-sm mb-1">Deine Cookie-Einstellungen</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              Wir verwenden Cookies, um diese Website zu betreiben und zu verbessern. Notwendige
              Cookies sind immer aktiv. Weitere Kategorien kannst du selbst wählen.{' '}
              <Link href="/datenschutz" className="min-h-11 inline-flex items-center text-green-600 hover:text-green-700 underline underline-offset-2">
                Datenschutzerklärung
              </Link>
            </p>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="mx-4 sm:mx-5 mb-4 rounded-xl border border-gray-100 bg-gray-50/60 divide-y divide-gray-100">
            {/* Notwendig */}
            <div className="flex flex-col sm:flex-row items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p id="cat-necessary" className="text-sm font-semibold text-gray-900">Notwendig</p>
                <p className="text-xs text-gray-600 leading-relaxed mt-1">
                  Ermöglichen grundlegende Funktionen wie Anmeldung und Warenkorb. Können nicht deaktiviert werden.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                <span className="text-xs font-semibold text-green-700 bg-green-50 px-2 py-1 rounded-full">Immer aktiv</span>
                <Toggle checked disabled onChange={() => {}} id="cat-necessary" />
              </div>
            </div>

            {/* Statistik */}
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p id="cat-stats" className="text-sm font-semibold text-gray-900">Statistik</p>
                <p className="text-xs text-gray-600 leading-relaxed mt-1">
                  Helfen uns zu verstehen, wie Besucher die Website nutzen (z.&nbsp;B. Seitenaufrufe, Verweildauer).
                </p>
              </div>
              <Toggle checked={stats} onChange={setStats} id="cat-stats" />
            </div>

            {/* Marketing */}
            <div className="flex items-start gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p id="cat-marketing" className="text-sm font-semibold text-gray-900">Marketing</p>
                <p className="text-xs text-gray-600 leading-relaxed mt-1">
                  Ermöglichen personalisierte Werbung und das Messen von Werbekampagnen auf anderen Plattformen.
                </p>
              </div>
              <Toggle checked={marketing} onChange={setMarketing} id="cat-marketing" />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2 px-4 sm:px-5 pb-5">
          <button
            onClick={acceptNecessary}
            className="min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            Nur notwendige
          </button>
          <button
            onClick={() => setShowSettings(s => !s)}
            aria-expanded={showSettings}
            className="min-h-11 flex-1 sm:flex-none flex items-center justify-center gap-1 px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors whitespace-nowrap"
          >
            Einstellungen
            {showSettings
              ? <ChevronUp  className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showSettings ? (
            <button
              onClick={saveSettings}
              className="min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              Auswahl speichern
            </button>
          ) : (
            <button
              onClick={acceptAll}
              className="min-h-11 flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              Alle akzeptieren
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
