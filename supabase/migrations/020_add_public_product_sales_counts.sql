-- Migration 020: Public aggregate product sales counts
-- Exposes only per-product totals for published products. Individual purchase
-- rows and customer-specific fields remain protected by the existing RLS.

CREATE INDEX IF NOT EXISTS purchases_product_id_idx
  ON public.purchases (product_id);

CREATE OR REPLACE FUNCTION public.get_public_product_sales_counts(
  requested_product_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  product_id UUID,
  sales_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    product.id AS product_id,
    COUNT(purchase.id)::BIGINT AS sales_count
  FROM public.products AS product
  LEFT JOIN public.purchases AS purchase
    ON purchase.product_id = product.id
  WHERE product.is_published = true
    AND (
      requested_product_ids IS NULL
      OR product.id = ANY(requested_product_ids)
    )
  GROUP BY product.id;
$$;

-- Functions are executable by PUBLIC by default. Restrict this RPC to the two
-- application roles and expose only its fixed aggregate return shape.
REVOKE ALL ON FUNCTION public.get_public_product_sales_counts(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_product_sales_counts(UUID[])
  TO anon, authenticated;
