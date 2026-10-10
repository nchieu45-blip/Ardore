'use client'

import { useEffect } from 'react'

// Keyboard interaction stays immediate; pointer-triggered overlays may animate.
export default function InteractionMode() {
  useEffect(() => {
    const root = document.documentElement
    const keyboard = () => { root.dataset.inputMethod = 'keyboard' }
    const pointer = () => { root.dataset.inputMethod = 'pointer' }
    keyboard()
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('pointerdown', pointer, true)
    return () => {
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('pointerdown', pointer, true)
      delete root.dataset.inputMethod
    }
  }, [])
  return null
}
