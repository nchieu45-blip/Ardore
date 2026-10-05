'use client'

import Image from 'next/image'
import { Image as ImageIcon, UserRound } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface MediaProps {
  src?: string | null
  alt: string
  className?: string
  sizes?: string
  fallback?: ReactNode
  children?: ReactNode
  ratio?: 'product' | 'portrait' | 'square'
}
export function Media({ src, alt, className, sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw', fallback, children, ratio = 'product' }: MediaProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const usable = src && failedSrc !== src
  const ratios = { product: 'aspect-video', portrait: 'aspect-[4/5]', square: 'aspect-square' }
  return <div className={cn('relative shrink-0 overflow-hidden bg-surface-muted', ratios[ratio], className)}>
    {usable ? <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" onError={() => setFailedSrc(src)} />
      : <div className="absolute inset-0 flex items-center justify-center text-muted" aria-hidden="true">
          {fallback ?? (ratio === 'portrait' ? <UserRound className="h-8 w-8" /> : <ImageIcon className="h-8 w-8" />)}
        </div>}
    {children}
  </div>
}
export function ProductThumbnail(props: Omit<MediaProps, 'ratio'>) { return <Media {...props} ratio="product" /> }
export function CoachPortrait(props: Omit<MediaProps, 'ratio'>) { return <Media {...props} ratio="portrait" /> }
