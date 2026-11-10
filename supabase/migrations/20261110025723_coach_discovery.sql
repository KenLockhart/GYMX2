-- Coach Discovery PR 6: members save or pass on coaches. Both lists are private to the member;
-- coaches never see who saved or passed on them.

create table public.coach_favorites (
  member_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, coach_id),
  check (member_id <> coach_id)
);

create table public.coach_passes (
  member_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, coach_id),
  check (member_id <> coach_id)
);

alter table public.coach_favorites enable row level security;
alter table public.coach_passes enable row level security;
revoke all on public.coach_favorites, public.coach_passes from anon, authenticated;

create policy "Members manage their saved coaches"
on public.coach_favorites for all to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()) and private.has_role(coach_id, 'coach'));

create policy "Members manage coaches they passed on"
on public.coach_passes for all to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()) and private.has_role(coach_id, 'coach'));

grant select, insert, delete on public.coach_favorites, public.coach_passes to authenticated;
grant all on public.coach_favorites, public.coach_passes to service_role;

-- Which coaches hold a current, verified certification or license, for discovery cards and filters.
-- Returns only yes or no per coach: no titles, numbers or documents.
create function public.verified_coaches()
returns table (coach_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct c.coach_id
  from public.coach_credentials c
  where c.status = 'verified'
    and c.kind in ('certification', 'license')
    and (c.expires_on is null or c.expires_on >= current_date);
$$;
revoke all on function public.verified_coaches() from public, anon;
grant execute on function public.verified_coaches() to authenticated;
