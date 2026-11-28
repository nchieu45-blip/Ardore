import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export default function AccordionItem({ title, name, children }: { title: string; name?: string; children: ReactNode }) {
  return (
    <details name={name} className="group border-b border-border">
      <summary className="accordion-summary grid min-h-12 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md px-2 py-3 font-semibold text-foreground hover:text-brand">
        <span>{title}</span>
        <ChevronDown className="size-5 text-brand group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-2 pb-4">{children}</div>
    </details>
  )
}
