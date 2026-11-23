-- Run only after the scoped reminder credential is in Vault and its matching
-- application revision has been deployed.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE SCHEMA IF NOT EXISTS ardore_scheduler;
REVOKE ALL ON SCHEMA ardore_scheduler FROM PUBLIC, anon, authenticated, service_role;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA ardore_scheduler;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_extension WHERE extname = 'http'
      AND extnamespace = 'ardore_scheduler'::regnamespace
  ) OR EXISTS (
    SELECT FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
    WHERE has_schema_privilege(role_name, 'ardore_scheduler', 'USAGE')
  ) THEN
    RAISE EXCEPTION 'The HTTP extension must be in the private scheduler schema';
  END IF;
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
    DO $request$
    DECLARE
      credential text;
      response_status integer;
    BEGIN
      SELECT decrypted_secret INTO STRICT credential
      FROM vault.decrypted_secrets WHERE name = 'ardore_reminder_scheduler';
      PERFORM set_config('http.curlopt_timeout_ms', '60000', true);
      PERFORM set_config('http.curlopt_connecttimeout_ms', '10000', true);

      SELECT status INTO STRICT response_status
      FROM ardore_scheduler.http(ROW(
        'GET',
        'https://www.ardore-health.com/api/cron/session-reminders',
        ARRAY[ardore_scheduler.http_header('Authorization', 'Bearer ' || credential)],
        NULL,
        NULL
      )::ardore_scheduler.http_request);

      IF response_status NOT BETWEEN 200 AND 299 THEN
        RAISE EXCEPTION 'Ardore reminders returned HTTP %', response_status;
      END IF;
    END;
    $request$;
  $job$
);

COMMIT;
