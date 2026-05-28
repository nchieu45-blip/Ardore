import Link from 'next/link'
import { Flame, ShieldCheck, Sparkles, MessageCircle } from 'lucide-react'

interface AuthShellProps {
  children: React.ReactNode
  heading: string
  subheading?: string
  icon?: React.ReactNode
  footer?: React.ReactNode
}

const FEATURES = [
  { icon: <Sparkles    className="h-4 w-4" />, text: 'Hunderte Premium-Inhalte von geprüften Coaches' },
  { icon: <MessageCircle className="h-4 w-4" />, text: 'Direkt mit deinem Coach chatten' },
  { icon: <ShieldCheck className="h-4 w-4" />, text: 'Sicher, verschlüsselt und DSGVO-konform' },
]

export function AuthShell({ children, heading, subheading, icon, footer }: AuthShellProps) {
  return (
    <div className="min-h-[calc(100vh-64px)] flex">
      {/* ── Brand panel (desktop only) ──────────────────────── */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] flex-col justify-between relative overflow-hidden bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 px-10 py-12 flex-shrink-0">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-green-600/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />

        {/* Logo */}
        <Link href="/" className="relative flex items-center gap-2 text-white font-bold text-xl w-fit">
          <div className="h-9 w-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
            <Flame className="h-5 w-5 text-white" />
          </div>
          <span className="tracking-tight">Ardore</span>
        </Link>

        {/* Tagline */}
        <div className="relative">
          <p className="text-green-300 text-xs font-semibold uppercase tracking-widest mb-3">Gesundheit & Fitness</p>
          <h2 className="text-3xl font-bold text-white leading-snug mb-6">
            Deine Gesundheit.<br />Dein Tempo.
          </h2>
          <ul className="space-y-3">
            {FEATURES.map(f => (
              <li key={f.text} className="flex items-start gap-3 text-green-100/80 text-sm">
                <span className="flex-shrink-0 mt-0.5 h-5 w-5 rounded-full bg-green-600/40 flex items-center justify-center text-green-200">
                  {f.icon}
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom quote */}
        <p className="relative text-green-300/50 text-xs">
          © {new Date().getFullYear()} Ardore · Alle Rechte vorbehalten
        </p>
      </div>

      {/* ── Form panel ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-4 py-12 overflow-y-auto">
        <div className="w-full max-w-md animate-slide-up">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-2 font-bold text-xl text-green-600">
              <div className="h-8 w-8 rounded-xl bg-green-600 flex items-center justify-center shadow-sm">
                <Flame className="h-4 w-4 text-white" />
              </div>
              Ardore
            </Link>
          </div>

          {/* Icon (optional) */}
          {icon && (
            <div className="flex justify-center mb-5">
              <div className="h-14 w-14 rounded-2xl bg-green-50 border border-green-100 flex items-center justify-center shadow-sm">
                {icon}
              </div>
            </div>
          )}

          {/* Heading */}
          <div className="text-center mb-7">
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{heading}</h1>
            {subheading && <p className="text-gray-500 mt-1.5 text-sm">{subheading}</p>}
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            {children}
          </div>

          {/* Footer links */}
          {footer && (
            <div className="text-center text-sm text-gray-500 mt-5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
