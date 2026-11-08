-- Affiliate program. People apply, an admin approves them and can set their own rates, and
-- affiliates earn on Armory sales and sign-ups they refer. Commissions become payable after a
-- hold period and are paid through Stripe. Only the server writes these tables; admins and the
-- affiliate themselves can read their rows.

create type public.affiliate_status as enum ('pending', 'approved', 'paused', 'rejected');
create type public.commission_kind as enum ('sale', 'signup');
create type public.commission_status as enum ('pending', 'paid', 'void');
create type public.commission_base as enum ('platform_share', 'sale_price');

-- One row of program-wide defaults that admins can change.
create table public.affiliate_settings (
  id boolean primary key default true check (id),
  sale_percent numeric(5, 2) not null default 10 check (sale_percent between 0 and 100),
  -- What the percentage is taken from: GYMX2's share of the sale (its 10% fee on coach items, or
  -- the whole item price on GYMX2's own items), or the full item price.
  sale_base public.commission_base not null default 'platform_share',
  signup_bonus_cents integer not null default 500 check (signup_bonus_cents between 0 and 100000),
  hold_days integer not null default 30 check (hold_days between 0 and 365),
  attribution_months integer not null default 12 check (attribution_months between 1 and 120),
  cookie_days integer not null default 30 check (cookie_days between 1 and 365),
  min_payout_cents integer not null default 2500 check (min_payout_cents between 100 and 1000000),
  updated_at timestamptz not null default now()
);
insert into public.affiliate_settings default values;

create table public.affiliates (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,23}$'),
  status public.affiliate_status not null default 'pending',
  application text not null default '' check (char_length(application) <= 1000),
  -- Rates for this affiliate. Empty means the program default applies.
  sale_percent numeric(5, 2) check (sale_percent between 0 and 100),
  signup_bonus_cents integer check (signup_bonus_cents between 0 and 100000),
  stripe_account_id text,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.referrals (
  referred_user_id uuid primary key references public.profiles (id) on delete cascade,
  affiliate_id uuid not null references public.affiliates (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Purchases after this no longer earn the affiliate anything.
  expires_at timestamptz not null,
  check (referred_user_id <> affiliate_id)
);
create index referrals_affiliate_idx on public.referrals (affiliate_id, created_at desc);

create table public.affiliate_clicks (
  id bigint generated always as identity primary key,
  affiliate_id uuid not null references public.affiliates (user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create index affiliate_clicks_affiliate_idx on public.affiliate_clicks (affiliate_id, created_at desc);

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (user_id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  stripe_transfer_id text,
  paid_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index affiliate_payouts_affiliate_idx on public.affiliate_payouts (affiliate_id, created_at desc);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates (user_id) on delete cascade,
  kind public.commission_kind not null,
  purchase_id uuid references public.purchases (id) on delete set null,
  referred_user_id uuid references public.profiles (id) on delete set null,
  description text not null check (char_length(description) <= 200),
  base_cents integer not null check (base_cents >= 0),
  rate text not null check (char_length(rate) <= 40),
  amount_cents integer not null check (amount_cents >= 0),
  status public.commission_status not null default 'pending',
  available_at timestamptz not null,
  payout_id uuid references public.affiliate_payouts (id) on delete set null,
  created_at timestamptz not null default now()
);
-- A purchase earns one sale commission; a referred person earns one sign-up bonus.
create unique index commissions_one_per_sale on public.commissions (purchase_id) where kind = 'sale';
create unique index commissions_one_signup on public.commissions (referred_user_id) where kind = 'signup';
create index commissions_affiliate_idx on public.commissions (affiliate_id, created_at desc);

alter table public.affiliate_settings enable row level security;
alter table public.affiliates enable row level security;
alter table public.referrals enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.commissions enable row level security;

create policy "Signed-in users can see the program terms"
on public.affiliate_settings for select to authenticated using (true);

create policy "Affiliates see their own row; admins see all"
on public.affiliates for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

create policy "Affiliates see their referrals; admins see all"
on public.referrals for select to authenticated
using (affiliate_id = (select auth.uid()) or (select private.is_admin()));

create policy "Affiliates see their clicks; admins see all"
on public.affiliate_clicks for select to authenticated
using (affiliate_id = (select auth.uid()) or (select private.is_admin()));

create policy "Affiliates see their payouts; admins see all"
on public.affiliate_payouts for select to authenticated
using (affiliate_id = (select auth.uid()) or (select private.is_admin()));

create policy "Affiliates see their commissions; admins see all"
on public.commissions for select to authenticated
using (affiliate_id = (select auth.uid()) or (select private.is_admin()));

revoke all on public.affiliate_settings, public.affiliates, public.referrals, public.affiliate_clicks,
  public.affiliate_payouts, public.commissions from public, anon, authenticated;
grant select on public.affiliate_settings, public.affiliates, public.referrals, public.affiliate_clicks,
  public.affiliate_payouts, public.commissions to authenticated;
grant select, insert, update on public.affiliate_settings, public.affiliates, public.referrals,
  public.affiliate_clicks, public.affiliate_payouts, public.commissions to service_role;
