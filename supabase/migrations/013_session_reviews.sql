create table if not exists session_reviews (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  buyer_id    uuid not null references profiles(id) on delete cascade,
  creator_id  uuid not null references creator_profiles(id) on delete cascade,
  rating      integer not null check (rating >= 1 and rating <= 5),
  content     text,
  created_at  timestamptz not null default now(),
  unique (booking_id, buyer_id)
);

create index if not exists session_reviews_creator_idx on session_reviews (creator_id, created_at desc);
create index if not exists session_reviews_buyer_idx   on session_reviews (buyer_id);

alter table session_reviews enable row level security;

-- Anyone can read session reviews (shown publicly on coach profiles)
create policy "session_reviews_select_all"
  on session_reviews for select using (true);

-- Only the buyer of the booking may insert, and only after the session has ended
create policy "session_reviews_insert_buyer"
  on session_reviews for insert with check (
    auth.uid() = buyer_id
    and exists (
      select 1 from bookings b
      where b.id = session_reviews.booking_id
        and b.buyer_id = auth.uid()
        and b.scheduled_at + (b.duration_minutes * interval '1 minute') < now()
    )
  );

create policy "session_reviews_update_own"
  on session_reviews for update using (auth.uid() = buyer_id);

create policy "session_reviews_delete_own"
  on session_reviews for delete using (auth.uid() = buyer_id);
