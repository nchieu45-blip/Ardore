// Upload guidance only. Does not mutate files or add publishing/authority requirements.
export type VisualAssetKind = 'portrait' | 'cover' | 'banner'
export const VISUAL_ASSET_STANDARDS = {
  portrait: { label: 'Coach-Portrait', ratio: '4:5', recommended: '1200 × 1500 px', minimumWidth: 800, minimumHeight: 1000, maxLabel: '5 MB', help: 'Gesicht mittig, mit etwas Abstand zu Kopf und Schultern. Dasselbe Bild wird auch rund als Avatar gezeigt.' },
  cover: { label: 'Produktcover', ratio: '16:9', recommended: '1600 × 900 px', minimumWidth: 800, minimumHeight: 450, maxLabel: '10 MB', help: 'Zeige das tatsächliche Thema. Wichtige Motive und höchstens eine kurze Textzeile im mittleren Bereich halten.' },
  banner: { label: 'Optionales Banner', ratio: '4:1', recommended: '2400 × 600 px', minimumWidth: 1200, minimumHeight: 300, maxLabel: '10 MB', help: 'Eine ruhige echte Szene; wichtige Motive mittig. Der sichtbare Ausschnitt hängt von der bestehenden Profilansicht ab.' },
} as const
export function assetDimensionAdvice(kind: VisualAssetKind, width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const standard = VISUAL_ASSET_STANDARDS[kind]
  const ratio = kind === 'portrait' ? 4 / 5 : kind === 'cover' ? 16 / 9 : 4
  // Object-cover always crops: test effective pixel resolution after the centered crop.
  const cropWidth = Math.min(width, height * ratio)
  const cropHeight = Math.min(height, width / ratio)
  if (cropWidth < standard.minimumWidth || cropHeight < standard.minimumHeight) {
    return `Für einen scharfen ${standard.ratio}-Ausschnitt empfehlen wir mindestens ${standard.minimumWidth} × ${standard.minimumHeight} px im sichtbaren Bereich. Das Bild kann weiterhin gespeichert werden.`
  }
  if (Math.abs(width / height / ratio - 1) > 0.12) return `Dieses Bild wird für ${standard.ratio} mittig beschnitten. Prüfe, ob das wichtige Motiv im Ausschnitt bleibt.`
  return null
}
