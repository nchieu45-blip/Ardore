'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import MarketplaceFormatToggle from '@/components/MarketplaceFormatToggle'
import { DISCOVERY_CATEGORIES } from '@/lib/discoveryCategories'
import { marketplaceAreaHref } from '@/lib/marketplaceAreas'
import type { MarketplaceFormat } from '@/lib/marketplaceFilters'

export default function HomeCategoryDiscovery() {
  const [format, setFormat] = useState<MarketplaceFormat>('beides')
  const [imagesReady, setImagesReady] = useState(false)

  useEffect(() => {
    let timer: number | undefined
    const loadImages = () => {
      // Keep category image requests off the critical path of the hero.
      timer = window.setTimeout(() => setImagesReady(true), 600)
    }
    if (document.readyState === 'complete') loadImages()
    else window.addEventListener('load', loadImages, { once: true })
    return () => {
      window.removeEventListener('load', loadImages)
      window.clearTimeout(timer)
    }
  }, [])

  return (
    <section className="ardore-container category-discovery" aria-labelledby="category-discovery-title">
      <div className="category-discovery-header">
        <h2 id="category-discovery-title" className="section-title">Was bewegt dich?</h2>
        <MarketplaceFormatToggle value={format} onChange={setFormat} />
      </div>
      <ul className="category-discovery-rail" aria-label="Disziplinen" role="list">
        {DISCOVERY_CATEGORIES.map(({ key, title, description, image, alt }) => (
          <li key={key} className="min-w-0">
            <Link className="category-discovery-link" prefetch={false}
              href={marketplaceAreaHref('coaching', '', key, format, 'kategorie')}>
              <span className="category-discovery-photo">
                {imagesReady && <Image src={image} alt={alt} fill fetchPriority="low"
                  sizes="(min-width: 1280px) 240px, (min-width: 1024px) 19vw, (min-width: 640px) 260px, 73vw" />}
                <span className="category-discovery-title">
                  {title}<ArrowUpRight size={17} aria-hidden="true" />
                </span>
              </span>
              <span className="category-discovery-copy">{description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
