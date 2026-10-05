'use client'

import { Media } from './Media'
import { cn } from '@/lib/utils'

interface EditorialVisualProps {
  src?: string | null
  alt: string
  word: string
  tone?: 'sage' | 'sand' | 'green'
  className?: string
  sizes?: string
}

/** Reserve geometry for approved photography; use honest typography until then. */
export function EditorialVisual({
  src,
  alt,
  word,
  tone = 'sage',
  className,
  sizes = '(max-width: 767px) 100vw, 50vw',
}: EditorialVisualProps) {
  return (
    <Media
      src={src}
      alt={alt}
      ratio="square"
      sizes={sizes}
      className={cn('editorial-visual', `editorial-visual--${tone}`, className)}
      fallback={
        <div className="editorial-art">
          <div className="editorial-art-orbit" />
          <div className="editorial-art-orbit editorial-art-orbit--inner" />
          <span className="editorial-art-word">{word}</span>
          <span className="editorial-art-signature">ARDORE / DEIN WEG</span>
        </div>
      }
    />
  )
}
