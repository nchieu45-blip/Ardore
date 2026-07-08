/**
 * Returns true only when the creator has opted in (default) AND at least one
 * sale exists. Used on every surface that renders a purchase count.
 */
export function showSalesCount(
  product: { show_sales_count?: boolean | null },
  count: number,
): boolean {
  return product.show_sales_count !== false && count > 0
}
