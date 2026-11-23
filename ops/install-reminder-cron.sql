-- Run only after the scoped reminder credential has been installed in Vault
-- and the matching application revision has been deployed.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF (
    SELECT count(*) FROM vault.decrypted_secrets
    WHERE name = 'ardore_reminder_scheduler'
      AND decrypted_secret ~ '^[A-Za-z0-9_-]{43}$'
  ) <> 1 THEN
    RAISE EXCEPTION 'The single Ardore reminder scheduler credential is required';
  END IF;
END;
$$;

SELECT cron.schedule(
  'ardore-session-reminders',
  '2-57/5 * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://www.ardore-health.com/api/cron/session-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer ' || decrypted_secret),
      timeout_milliseconds := 60000
    )
    FROM vault.decrypted_secrets
    WHERE name = 'ardore_reminder_scheduler';
  $job$
);

COMMIT;
