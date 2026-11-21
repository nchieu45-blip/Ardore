import type { Metadata } from 'next'

export function publicPageMetadata(path: string, title: string, description: string): Metadata {
  const brandedTitle = path === '/' ? title : `${title} – Ardore`
  const image = { url: '/og-default.png', width: 1200, height: 630, alt: 'Ardore' }

  return {
    title: { absolute: brandedTitle },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website', locale: 'de_DE', siteName: 'Ardore', url: path,
      title: brandedTitle, description, images: [image],
    },
    twitter: { card: 'summary_large_image', title: brandedTitle, description, images: [image] },
  }
}
