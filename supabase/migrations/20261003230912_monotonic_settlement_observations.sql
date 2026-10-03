-- A delayed provider read must not erase a proved refund/reversal or its IDs.
CREATE OR REPLACE FUNCTION public.observe_payment_settlement(p_settlement_id uuid,p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s public.payment_settlements%ROWTYPE; refunded integer:=(p_snapshot->>'refunded_cents')::integer;
 reversed integer:=(p_snapshot->>'reversed_cents')::integer; reversal_ids jsonb;
BEGIN
 SELECT * INTO s FROM public.payment_settlements WHERE id=p_settlement_id FOR UPDATE;
 IF s.id IS NULL OR refunded IS NULL OR reversed IS NULL OR refunded<0 OR refunded>s.gross_cents
  OR reversed<0 OR reversed>coalesce(s.transfer_amount_cents,0)
  OR (p_snapshot ? 'reversal_ids' AND jsonb_typeof(p_snapshot->'reversal_ids') IS DISTINCT FROM 'array') THEN
  RAISE EXCEPTION 'Invalid settlement observation'; END IF;
 IF s.provider_checked_at>(p_snapshot->>'checked_at')::timestamptz THEN RETURN to_jsonb(s); END IF;
 refunded:=greatest(s.amount_refunded_cents,refunded);
 reversed:=greatest(s.amount_reversed_cents,reversed);
 SELECT coalesce(jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb) INTO reversal_ids
 FROM jsonb_array_elements(s.transfer_reversal_ids||coalesce(p_snapshot->'reversal_ids','[]'::jsonb));
 UPDATE public.payment_settlements SET amount_refunded_cents=refunded,amount_reversed_cents=reversed,
  transfer_reversal_ids=reversal_ids,provider_checked_at=(p_snapshot->>'checked_at')::timestamptz,
  state=CASE WHEN refunded=gross_cents AND
    ((stripe_transfer_id IS NOT NULL AND reversed=coalesce(transfer_amount_cents,0)) OR
      (stripe_transfer_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.payment_settlement_actions pa
        WHERE pa.settlement_id=s.id AND pa.kind='transfer' AND pa.uncertain))) THEN 'refunded'
    WHEN refund_requested_cents>refunded THEN 'refund_pending' WHEN lease_expires_at>now() THEN state
    WHEN stripe_transfer_id IS NOT NULL THEN 'settled' ELSE state END,
  fulfillment_state=CASE WHEN refunded=gross_cents THEN 'refunded' ELSE fulfillment_state END,
  eligibility_checked_at=coalesce((p_snapshot->>'eligibility_checked_at')::timestamptz,eligibility_checked_at),
  last_error_code=CASE WHEN p_snapshot ? 'error_code' THEN p_snapshot->>'error_code' ELSE last_error_code END,
  updated_at=now() WHERE id=s.id RETURNING * INTO s;
 RETURN to_jsonb(s);
END; $$;
REVOKE ALL ON FUNCTION public.observe_payment_settlement(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.observe_payment_settlement(uuid,jsonb) TO service_role;
