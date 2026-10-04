-- The discount observer uses the existing reconciliation/refund flow when a
-- late successful payment loses its coupon capacity. Permit that explicit
-- technical reason without changing cancellation or refund policy.
ALTER TABLE public.coaching_payment_attempts
 DROP CONSTRAINT coaching_payment_attempts_reconciliation_reason_check;
ALTER TABLE public.coaching_payment_attempts
 ADD CONSTRAINT coaching_payment_attempts_reconciliation_reason_check CHECK (
  reconciliation_reason IN ('slot_unavailable','appointment_elapsed','booking_cancelled',
   'duplicate_payment','payment_already_refunded','discount_unavailable'));
