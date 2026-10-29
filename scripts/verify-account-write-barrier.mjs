// Offline structural contracts. Real SQL/API races live in the opted-in runner.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const sql = readFileSync(new URL('../supabase/migrations/20261023090520_account_deletion_write_barrier.sql', import.meta.url), 'utf8')

test('write barrier migration is bounded, additive and never rewrites Auth/Storage/customer data', () => {
  assert.match(sql, /BEGIN;\s*SET LOCAL lock_timeout = '5s';\s*SET LOCAL statement_timeout = '30s';/)
  assert.match(sql, /COMMIT;\s*$/)
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE|DROP TABLE)\s+(?:auth|storage|public)\./i)
  assert.match(sql, /ALTER TABLE private\.account_deletion_barriers ENABLE ROW LEVEL SECURITY/)
  assert.doesNotMatch(sql, /user_id uuid PRIMARY KEY\s+REFERENCES/)
})
test('all producers and final deletion use short ordered transaction locks and fresh read-committed snapshots', () => {
  assert.match(sql, /SELECT DISTINCT id FROM unnest\(p_users\).*ORDER BY id/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('ardore-account-write:'/)
  assert.match(sql, /transaction_isolation'\) <> 'read committed'/)
  assert.doesNotMatch(sql, /LANGUAGE (?:sql|plpgsql) STABLE/)
  assert.match(sql, /CREATE OR REPLACE FUNCTION private\.guard_account_storage_deletion[\s\S]*private\.lock_account_writes\(ARRAY\[OLD.id\]\)/)
})
test('service-only deletion API keeps privileged code private and fences stale workers', () => {
  for (const name of ['begin_account_deletion', 'mark_account_deletion_auth', 'release_account_deletion']) {
    assert.match(sql, new RegExp(`CREATE FUNCTION private\\.${name}[^;]*SECURITY DEFINER SET search_path = ''`))
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${name}[^;]*SECURITY INVOKER SET search_path = ''`))
  }
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.begin_account_deletion[^;]*FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /WHERE user_id = p_user_id AND attempt_id = p_attempt_id AND NOT auth_started/)
  assert.match(sql, /ON CONFLICT \(user_id\) DO UPDATE SET attempt_id = EXCLUDED.attempt_id, lease_until = EXCLUDED.lease_until;/)
  assert.match(sql, /AND lease_until > clock_timestamp\(\)/)
})
test('all actual account record producers, including async fulfillment, have insert/ownership guards', () => {
  for (const table of ['payment_orders','payment_settlements','coaching_payment_attempts','discount_redemptions',
    'bookings','subscriptions','purchases','video_class_bookings','verification_requests','creator_profiles','group_booking_reservations','video_class_occurrences']) {
    assert.match(sql, new RegExp(`CREATE TRIGGER guard_account_record_write BEFORE INSERT OR UPDATE OF [^;]* ON public\\.${table} FOR EACH ROW`))
  }
})
test('Storage hook covers service-role bypass and stale JWTs without granting access or writing managed metadata', () => {
  assert.match(sql, /BEFORE INSERT OR UPDATE OF name,bucket_id,owner_id,owner ON storage\.objects/)
  assert.match(sql, /ARRAY\[owner_user, NEW.owner, folder_user\]/)
  assert.match(sql, /'verification-docs','products','thumbnails','profile-images'/)
  assert.match(sql, /NEW.bucket_id = 'avatars'/)
  assert.doesNotMatch(sql, /CREATE (?:OR REPLACE )?FUNCTION (?:storage|auth)\./)
  assert.doesNotMatch(sql, /GRANT .* ON storage\.objects/)
})
