// Route tests exercise the real RPC adapter/arithmetic. The database contract
// is independently tested against synthetic Postgres rows and concurrent RPCs.
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const loadedModule = { exports: {} }
new Function('exports', 'module', ts.transpileModule(readFileSync(new URL('../../src/lib/discounts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(loadedModule.exports, loadedModule)
export const discountFunctions = loadedModule.exports
export function discountReservationFixture(discount) {
  return {
    ...discountFunctions,
    async reserveDiscount(_service, input) {
      const d = discount
      const scope = d && d.creator_id === input.creatorId && d.active &&
        (input.kind === 'sessions' ? !d.target_product_id && !d.target_tier_id && ['all', 'sessions'].includes(d.applies_to)
          : input.kind === 'products' ? !d.target_tier_id && (d.target_product_id
            ? input.productIds?.length === 1 && input.productIds[0] === d.target_product_id : ['all', 'products'].includes(d.applies_to))
            : !d.target_product_id && (d.target_tier_id ? d.target_tier_id === input.tierId : ['all', 'subscriptions'].includes(d.applies_to)))
      return discountFunctions.reserveDiscount({ rpc: async () => {
        if (!scope) return { data: { error: 'wrong_discount_scope' }, error: null }
        const savings = discountFunctions.savingsCents(d.type, d.value, input.originalCents)
        return { data: { id: input.id, discount_id: d.id, original_cents: input.originalCents, savings_cents: savings,
          final_cents: input.originalCents - savings, expires_at: new Date(Date.now() + 45 * 60_000).toISOString() }, error: null }
      } }, input)
    },
    async releaseDiscount() {},
  }
}
