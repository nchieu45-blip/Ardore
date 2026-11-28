-- Coach discovery only. The existing booking flow continues to be for online sessions.
alter table public.creator_profiles
  add column format text not null default 'online'
  constraint creator_profiles_format_check check (format in ('online', 'beides'));

comment on column public.creator_profiles.format is
  'Online coaching only, or online plus in-person 1:1 coaching by arrangement (beides).';
