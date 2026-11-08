-- Coach memberships: monthly plans members subscribe to through Stripe. Each coach decides who can
-- join: anyone for free, subscribers only, or both. Only the server writes plans' Stripe details
-- and subscriptions; it does that after Stripe confirms.

alter table public.profiles add column join_mode text not null default 'free'
  check (join_mode in ('free', 'paid', 'both'));
grant update (join_mode) on public.profiles to authenticated;

-- Reads a coach's join setting without row security, for the join rule below.
create function private.coach_join_mode(target_coach_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select join_mode from public.profiles where id = target_coach_id;
$$;
revoke all on function private.coach_join_mode(uuid) from public;
grant execute on function private.coach_join_mode(uuid) to authenticated;

-- Members can join a coach for free unless the coach takes subscribers only.
drop policy "Members can join a coach" on public.coach_members;
create policy "Members can join a coach"
on public.coach_members for insert to authenticated
with check (
  member_id = (select auth.uid())
  and private.has_role(member_id, 'member')
  and private.has_role(coach_id, 'coach')
  and private.coach_join_mode(coach_id) <> 'paid'
);
grant insert, delete on public.coach_members to service_role;

create table public.coach_plans (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 1000),
  price_cents integer not null check (price_cents between 100 and 100000),
  trial_days integer not null default 0 check (trial_days in (0, 7)),
  active boolean not null default true,
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_plans_coach_idx on public.coach_plans (coach_id, price_cents);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid references public.coach_plans (id) on delete set null,
  plan_name text not null check (char_length(plan_name) <= 60),
  price_cents integer not null check (price_cents >= 0),
  stripe_subscription_id text not null unique,
  stripe_customer_id text,
  status text not null,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_member_idx on public.subscriptions (member_id);
create index subscriptions_coach_idx on public.subscriptions (coach_id, status);

-- Membership payments are kept with Armory purchases, so sales, refunds and affiliates cover them.
alter table public.purchases add column kind text not null default 'item' check (kind in ('item', 'membership'));

alter table public.coach_plans enable row level security;
alter table public.subscriptions enable row level security;

create policy "People see active plans; coaches see their own"
on public.coach_plans for select to authenticated
using (active or coach_id = (select auth.uid()) or (select private.is_admin()));

create policy "Members and coaches see their subscriptions; admins see all"
on public.subscriptions for select to authenticated
using (
  member_id = (select auth.uid())
  or coach_id = (select auth.uid())
  or (select private.is_admin())
);

revoke all on public.coach_plans, public.subscriptions from public, anon, authenticated;
grant select on public.coach_plans, public.subscriptions to authenticated;
grant select, insert, update on public.coach_plans, public.subscriptions to service_role;
