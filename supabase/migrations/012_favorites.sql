create table if not exists favorites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_type   text not null check (item_type in ('product', 'coach')),
  item_id     uuid not null,
  created_at  timestamptz not null default now(),
  unique (user_id, item_type, item_id)
);

create index if not exists favorites_user_idx on favorites (user_id, created_at desc);

alter table favorites enable row level security;

create policy "Users can read own favorites"
  on favorites for select using (auth.uid() = user_id);

create policy "Users can create own favorites"
  on favorites for insert with check (auth.uid() = user_id);

create policy "Users can delete own favorites"
  on favorites for delete using (auth.uid() = user_id);
