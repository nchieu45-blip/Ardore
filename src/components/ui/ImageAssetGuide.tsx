'use client'

import { useState } from 'react'
import { VISUAL_ASSET_STANDARDS, assetDimensionAdvice, type VisualAssetKind } from '@/lib/visual-assets'

// Local crop inspection only: original file, upload paths and ownership remain untouched.
export function ImageAssetGuide({ kind, src }: { kind: VisualAssetKind; src?: string | null }) {
  const standard = VISUAL_ASSET_STANDARDS[kind]
  const [loaded, setLoaded] = useState<{ src: string; width: number; height: number } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const current = loaded?.src === src ? loaded : null
  const advice = current ? assetDimensionAdvice(kind, current.width, current.height) : null
  const ratio = kind === 'portrait' ? 'aspect-[4/5]' : kind === 'cover' ? 'aspect-video' : 'aspect-[4/1]'
  return <div className="mt-4 space-y-2 text-sm text-muted" data-asset-guide={kind}>
    <p><strong className="font-medium text-foreground">{standard.label} · {standard.ratio}</strong> · empfohlen {standard.recommended}</p>
    <p>{standard.help}</p>
    <p>JPG oder WEBP für Fotos, PNG für Grafiken · max. {standard.maxLabel}. Der Upload verändert das Original nicht.</p>
    {src && failed !== src && <div className="flex flex-wrap items-start gap-4 pt-2">
      <figure className={kind === 'portrait' ? 'w-28' : kind === 'cover' ? 'w-full max-w-sm' : 'w-full max-w-md'}>
        {/* Native img supports local object URLs before uploading. This is not a public image pipeline. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={`${standard.label}: mittiger Ausschnitt`} className={`w-full ${ratio} rounded-xl border border-border object-cover object-center`} onLoad={e => setLoaded({src, width:e.currentTarget.naturalWidth, height:e.currentTarget.naturalHeight})} onError={() => setFailed(src)} />
        <figcaption className="mt-1 text-xs">Vorschau · {standard.ratio}</figcaption>
      </figure>
      {kind === 'portrait' && <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Runder Avatar-Ausschnitt desselben Portraits" className="h-16 w-16 rounded-full border border-border object-cover object-center" />
        <figcaption className="mt-1 text-xs">Avatar · mittig</figcaption>
      </figure>}
    </div>}
    {src && failed === src && <p role="status" className="text-amber-800">Die Vorschau konnte nicht geladen werden. Bitte prüfe das Bildformat; die Vorschau verändert keine gespeicherten Bilder.</p>}
    {advice && <p role="status" className="text-amber-800">{advice}</p>}
  </div>
}
