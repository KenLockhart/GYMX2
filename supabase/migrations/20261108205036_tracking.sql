-- Mind, Body and Spirit tracking: daily habits, body measurements and a simple nutrition log.
-- Each person owns their own rows. Coaches can read them only when the member turns on sharing,
-- and only for members who joined them. Admins can't see them.

alter table public.profiles add column share_tracking boolean not null default false;
alter table public.profiles add column protein_target_g integer check (protein_target_g between 0 and 1000);
alter table public.profiles add column calorie_target integer check (calorie_target between 0 and 20000);
grant update (share_tracking, protein_target_g, calorie_target) on public.profiles to authenticated;

-- True when the signed-in coach may read this member's tracking.
create function private.can_view_tracking(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      join public.coach_members cm on cm.member_id = p.id
      where p.id = target_user_id and p.share_tracking and cm.coach_id = (select auth.uid())
    );
$$;
revoke all on function private.can_view_tracking(uuid) from public;
grant execute on function private.can_view_tracking(uuid) to authenticated;

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  pillar public.pillar not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index habits_user_idx on public.habits (user_id, created_at);

create table public.habit_logs (
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (habit_id, day)
);
create index habit_logs_user_idx on public.habit_logs (user_id, day);

create table public.body_logs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  weight_lb numeric(5, 1) check (weight_lb between 50 and 800),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 2 and 70),
  waist_in numeric(4, 1) check (waist_in between 15 and 80),
  updated_at timestamptz not null default now(),
  primary key (user_id, day),
  check (weight_lb is not null or body_fat_pct is not null or waist_in is not null)
);

create table public.nutrition_logs (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  protein_g integer check (protein_g between 0 and 1000),
  calories integer check (calories between 0 and 20000),
  water_glasses integer check (water_glasses between 0 and 50),
  notes text not null default '' check (char_length(notes) <= 500),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.habits enable row level security;
alter table public.habit_logs enable row level security;
alter table public.body_logs enable row level security;
alter table public.nutrition_logs enable row level security;

create policy "People read their own habits; shared with coaches"
on public.habits for select to authenticated using ((select private.can_view_tracking(user_id)));
create policy "People add their own habits"
on public.habits for insert to authenticated with check (user_id = (select auth.uid()));
create policy "People change their own habits"
on public.habits for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "People read their own check-ins; shared with coaches"
on public.habit_logs for select to authenticated using ((select private.can_view_tracking(user_id)));
create policy "People check off their own habits"
on public.habit_logs for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = (select auth.uid()))
);
create policy "People undo their own check-ins"
on public.habit_logs for delete to authenticated using (user_id = (select auth.uid()));

create policy "People read their own body log; shared with coaches"
on public.body_logs for select to authenticated using ((select private.can_view_tracking(user_id)));
create policy "People add to their own body log"
on public.body_logs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "People change their own body log"
on public.body_logs for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "People remove from their own body log"
on public.body_logs for delete to authenticated using (user_id = (select auth.uid()));

create policy "People read their own nutrition log; shared with coaches"
on public.nutrition_logs for select to authenticated using ((select private.can_view_tracking(user_id)));
create policy "People add to their own nutrition log"
on public.nutrition_logs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "People change their own nutrition log"
on public.nutrition_logs for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.habits, public.habit_logs, public.body_logs, public.nutrition_logs
  from public, anon, authenticated;
grant select, insert on public.habits to authenticated;
grant update (name, pillar, active) on public.habits to authenticated;
grant select, insert, delete on public.habit_logs to authenticated;
grant select, insert, delete on public.body_logs to authenticated;
-- Saving uses an upsert, which writes every column it sends; row security keeps it to their own row.
grant update (user_id, day, weight_lb, body_fat_pct, waist_in, updated_at) on public.body_logs to authenticated;
grant select, insert on public.nutrition_logs to authenticated;
grant update (user_id, day, protein_g, calories, water_glasses, notes, updated_at) on public.nutrition_logs to authenticated;
grant select on public.habits, public.habit_logs, public.body_logs, public.nutrition_logs to service_role;
