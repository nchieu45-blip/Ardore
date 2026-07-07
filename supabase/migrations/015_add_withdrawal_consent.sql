-- Withdrawal-right consent storage (§ 356 Abs. 5 BGB)
-- Allows proving that the buyer explicitly consented to immediate performance
-- and acknowledged the resulting loss of the right of withdrawal.
ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS withdrawal_consent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS withdrawal_consent_version TEXT;
