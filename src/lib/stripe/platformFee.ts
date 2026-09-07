export const ARDORE_PLATFORM_FEE_PERCENT = 10
export const ARDORE_PLATFORM_FEE_BASIS_POINTS = 1_000

export function calculateArdorePlatformFee(amountCents: number): number {
  return Math.round(amountCents * ARDORE_PLATFORM_FEE_BASIS_POINTS / 10_000)
}
