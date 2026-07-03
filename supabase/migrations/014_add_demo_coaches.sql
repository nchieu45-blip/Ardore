-- ── Add is_demo flag ──────────────────────────────────────────────────────────

alter table creator_profiles
  add column if not exists is_demo boolean not null default false;

-- ── Demo auth users ───────────────────────────────────────────────────────────
-- The handle_new_user trigger fires on each insert and auto-creates the profile.
-- encrypted_password is intentionally empty — these accounts can never log in.

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated',
   'sarah-menzel.demo@ardore-health.com', '',
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"creator","full_name":"Sarah Menzel"}'::jsonb,
   false, now(), now()),

  ('a1000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated',
   'daniel-krueger.demo@ardore-health.com', '',
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"creator","full_name":"Daniel Krüger"}'::jsonb,
   false, now(), now()),

  ('a1000000-0000-0000-0000-000000000003',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated',
   'lisa-hartmann.demo@ardore-health.com', '',
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"creator","full_name":"Dr. Lisa Hartmann"}'::jsonb,
   false, now(), now()),

  ('a1000000-0000-0000-0000-000000000004',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated',
   'jonas-weber.demo@ardore-health.com', '',
   now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"role":"creator","full_name":"Jonas Weber"}'::jsonb,
   false, now(), now())
on conflict (id) do nothing;

-- ── Creator profiles ──────────────────────────────────────────────────────────

insert into creator_profiles (user_id, display_name, slug, bio, category, categories, stripe_account_active, is_demo)
values
  ('a1000000-0000-0000-0000-000000000001',
   'Sarah Menzel', 'sarah-menzel',
   'Zertifizierte Yogalehrerin (RYT 500) aus Köln. Ich helfe dir, Beweglichkeit und innere Ruhe in deinen Alltag zu bringen — ohne Esoterik, mit fundierter Methodik.',
   'yoga', array['yoga'], false, true),

  ('a1000000-0000-0000-0000-000000000002',
   'Daniel Krüger', 'daniel-krueger',
   'Personal Trainer (A-Lizenz) mit 8 Jahren Erfahrung. Mein Fokus: sauberes Techniktraining und Trainingspläne, die zu deinem Leben passen — nicht umgekehrt.',
   'krafttraining', array['krafttraining'], false, true),

  ('a1000000-0000-0000-0000-000000000003',
   'Dr. Lisa Hartmann', 'dr-lisa-hartmann',
   'Ökotrophologin (M.Sc.) und zertifizierte Ernährungsberaterin. Ich zeige dir, wie gesunde Ernährung ohne Verzicht und Kalorienzählen funktioniert.',
   'ernaehrung', array['ernaehrung'], false, true),

  ('a1000000-0000-0000-0000-000000000004',
   'Jonas Weber', 'jonas-weber',
   'Systemischer Coach und Achtsamkeitstrainer. Ich unterstütze Berufstätige dabei, Stress abzubauen und mental gesund zu bleiben — praxisnah und ohne Floskeln.',
   'mental', array['mental'], false, true)
on conflict (slug) do nothing;

-- ── Products ──────────────────────────────────────────────────────────────────

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       'Morgenroutine: 20 Min Yoga für Einsteiger',
       'Ein geführtes 20-Minuten-Yoga-Programm für Einsteiger. Perfekt für einen achtsamen Start in den Tag — ohne Vorkenntnisse.',
       'course', 29.00, true
from creator_profiles cp
where cp.slug = 'sarah-menzel'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = 'Morgenroutine: 20 Min Yoga für Einsteiger'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       '1:1 Yoga-Session',
       'Eine persönliche 60-Minuten Yoga-Session, zugeschnitten auf deine Ziele und dein Level. Ideal für gezielte Fortschritte.',
       'video', 45.00, true
from creator_profiles cp
where cp.slug = 'sarah-menzel'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = '1:1 Yoga-Session'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       '12-Wochen Ganzkörper-Trainingsplan',
       'Strukturierter 12-Wochen-Plan für effektives Ganzkörpertraining. Mit Progressionsplan, Alternativübungen und Technik-Erläuterungen.',
       'pdf', 39.00, true
from creator_profiles cp
where cp.slug = 'daniel-krueger'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = '12-Wochen Ganzkörper-Trainingsplan'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       'Technik-Check per Video-Analyse',
       'Lade ein Video deiner Trainingseinheit hoch und erhalte detailliertes Technik-Feedback von Daniel. Perfekt zur Verletzungsprävention.',
       'video', 49.00, true
from creator_profiles cp
where cp.slug = 'daniel-krueger'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = 'Technik-Check per Video-Analyse'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       'Ernährungs-Basics: Der 4-Wochen-Kurs',
       'In vier Wochen lernst du die Grundlagen einer ausgewogenen Ernährung — wissenschaftlich fundiert, alltagstauglich und ohne Verbote.',
       'course', 59.00, true
from creator_profiles cp
where cp.slug = 'dr-lisa-hartmann'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = 'Ernährungs-Basics: Der 4-Wochen-Kurs'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       'Persönliche Ernährungsanalyse',
       'Lisa analysiert deine aktuelle Ernährung und erstellt einen individuellen Handlungsplan — inkl. Beratungsgespräch.',
       'video', 79.00, true
from creator_profiles cp
where cp.slug = 'dr-lisa-hartmann'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = 'Persönliche Ernährungsanalyse'
  );

insert into products (creator_id, title, description, type, price, is_published)
select cp.id,
       'Stressfrei durch den Arbeitsalltag',
       'Praktische Techniken und Achtsamkeitsübungen für Berufstätige. Lerne, Stress gezielt abzubauen — in deinem eigenen Tempo.',
       'course', 34.00, true
from creator_profiles cp
where cp.slug = 'jonas-weber'
  and not exists (
    select 1 from products p where p.creator_id = cp.id
      and p.title = 'Stressfrei durch den Arbeitsalltag'
  );

-- ── Subscription tier (Jonas Weber) ──────────────────────────────────────────

insert into subscription_tiers (creator_id, name, description, price_monthly, is_active)
select cp.id,
       'Coaching-Abo: 2 Sessions/Monat',
       'Zwei persönliche Coaching-Sessions pro Monat für nachhaltige Fortschritte im Stressmanagement und mentaler Gesundheit.',
       89.00, true
from creator_profiles cp
where cp.slug = 'jonas-weber'
  and not exists (
    select 1 from subscription_tiers t where t.creator_id = cp.id
      and t.name = 'Coaching-Abo: 2 Sessions/Monat'
  );

-- ── Delete old test data ──────────────────────────────────────────────────────
-- Cascade: auth.users → profiles → creator_profiles → products

delete from auth.users
where id in (
  select p.id
  from profiles p
  join creator_profiles cp on cp.user_id = p.id
  where cp.slug = 'coach-test-kpln'
);
