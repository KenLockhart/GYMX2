-- Public coach pages at gymx2.com/c/<slug>, off until the coach turns them on, and member reviews.
alter table public.profiles
  add column public_slug text unique
    check (public_slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and public_slug not like '%--%'),
  add column public_page boolean not null default false;
grant update (public_slug, public_page) on public.profiles to authenticated;

create table public.coach_reviews (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coach_id, member_id)
);
create index coach_reviews_coach_idx on public.coach_reviews (coach_id, created_at desc);

-- True when the signed-in member has joined this coach.
create function private.joined_coach(target_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_members
    where coach_id = target_coach_id and member_id = (select auth.uid())
  );
$$;
revoke all on function private.joined_coach(uuid) from public, anon;
grant execute on function private.joined_coach(uuid) to authenticated;

alter table public.coach_reviews enable row level security;
-- Visible reviews are public (the public page reads them on the server); the writer, the coach
-- and admins also see hidden ones.
create policy "Anyone signed in reads visible reviews"
on public.coach_reviews for select to authenticated
using (not hidden or member_id = (select auth.uid()) or coach_id = (select auth.uid()) or (select private.is_admin()));
create policy "Members review coaches they joined"
on public.coach_reviews for insert to authenticated
with check (member_id = (select auth.uid()) and (select private.joined_coach(coach_id)));
create policy "Members edit their review"
on public.coach_reviews for update to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()) and (select private.joined_coach(coach_id)));
create policy "Members remove their review"
on public.coach_reviews for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.coach_reviews from public, anon, authenticated;
grant select, insert, delete on public.coach_reviews to authenticated;
grant update (rating, body, updated_at) on public.coach_reviews to authenticated;
grant select, update on public.coach_reviews to service_role;
