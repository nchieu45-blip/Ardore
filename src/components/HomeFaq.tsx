import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import AccordionItem from '@/components/ui/AccordionItem'

export default function HomeFaq({ launchPaused }: { launchPaused: boolean }) {
  const questions = [
    {
      question: 'Wie läuft ein Online-Coaching ab?',
      answer: launchPaused
        ? 'Sobald Buchungen wieder möglich sind, wählst du im Coach-Profil einen freien Termin. Nach der Bestätigung findest du den Videozugang oder den Link deines Coaches bei deinen Buchungen.'
        : 'Wähle im Coach-Profil einen freien Termin. Nach der Bestätigung findest du den Videozugang oder den Link deines Coaches bei deinen Buchungen.',
    },
    {
      question: 'Kann ich vor Ort trainieren?',
      answer: 'Ja, wenn dein Coach Vor-Ort-Coaching anbietet. Nutze den Filter „Vor Ort“. Ort, Termin und Preis klärst du direkt mit dem Coach.',
    },
    {
      question: 'Wie werden Coaches geprüft?',
      answer: 'Das Siegel „Verifiziert“ bedeutet, dass Ardore die eingereichten Unterlagen geprüft und die Verifizierung freigegeben hat. Du findest das Siegel im Coach-Profil.',
    },
    {
      question: 'Wie bezahle ich?',
      answer: launchPaused
        ? 'Zahlungen über Ardore sind vorübergehend pausiert. Sobald du wieder buchen oder kaufen kannst, siehst du die verfügbaren Zahlungsarten beim Bezahlen über Stripe.'
        : 'Du bezahlst kostenpflichtige Angebote über Stripe. Welche Zahlungsarten für dein Angebot verfügbar sind, siehst du beim Bezahlen.',
    },
    {
      question: 'Kann ich mein Abo kündigen?',
      answer: launchPaused
        ? 'Du kannst dein Abo zum Ende des laufenden Abrechnungszeitraums kündigen. Während der Pause hilft dir der Ardore-Support bei der Kündigung.'
        : 'Du kannst dein Abo unter „Meine Abonnements“ zum Ende des laufenden Abrechnungszeitraums kündigen. Dort siehst du auch den Status deiner Kündigung.',
    },
    {
      question: 'Wie werde ich Coach?',
      answer: 'Bei der Registrierung wählst du die Rolle „Coach“. Lege dein Profil an und ergänze deine Schwerpunkte. Im Coach-Bereich siehst du, was du zum Veröffentlichen noch brauchst.',
    },
  ]

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  }

  return (
    <section aria-labelledby="home-faq-title" className="bg-surface">
      <div className="ardore-container home-band-space grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10 lg:gap-16">
        <div>
          <h2 id="home-faq-title" className="section-title">Häufige Fragen</h2>
          <Link href="/hilfe" className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-brand hover:underline">
            Alle Fragen in der Hilfe
            <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>
        <div className="min-w-0 border-t border-border">
          {questions.map(({ question, answer }) => (
            <AccordionItem key={question} name="ardore-home-faq" title={question}>
              <p className="max-w-prose leading-relaxed text-muted">{answer}</p>
            </AccordionItem>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, '\\u003c') }} />
    </section>
  )
}
