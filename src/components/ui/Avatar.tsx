'use client'

import { cn, getInitials } from '@/lib/utils'
import Image from 'next/image'
import { useState } from 'react'

interface AvatarProps {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const sizes = {
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-14 w-14 text-base',
    xl: 'h-20 w-20 text-xl',
  }

  if (src && src !== failedSrc) {
    return (
      <div className={cn('relative rounded-full overflow-hidden flex-shrink-0', sizes[size], className)}>
        <Image src={src} alt={name} fill sizes="80px" className="object-cover" onError={() => setFailedSrc(src)} />
      </div>
    )
  }

  return (
    <div role="img" aria-label={name}
      className={cn(
        'rounded-full bg-brand-soft text-brand flex items-center justify-center font-semibold flex-shrink-0',
        sizes[size],
        className
      )}
    >
      {getInitials(name)}
    </div>
  )
}
