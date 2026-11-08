-- GYMX2 paid downloads: members buy a coach's ebook with Stripe Checkout.
-- The money goes to the coach's own Stripe account (Stripe Connect) and GYMX2 keeps a 10% fee.
-- Sales of GYMX2's own items (added by admins) go entirely to GYMX2.

-- A third kind of Armory item: a file that unlocks after payment.
alter table public.armory_items drop constraint armory_items_kind_check;
alter table public.armory_items add constraint armory_items_kind_check check (kind in ('link', 'download', 'paid'));
alter table public.armory_items add constraint armory_items_paid_check
  check (kind <> 'paid' or (file_path is not null and file_name is not null and buy_url is null and price_cents between 100 and 10000000));

-- Each coach's Stripe account. Written only by the server after talking to Stripe.
create table public.payout_accounts (
  coach_id uuid primary key references public.profiles (id) on delete cascade,
  stripe_account_id text not null unique,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger payout_accounts_set_updated_at
before update on public.payout_accounts
for each row execute function public.set_updated_at();

-- One row per completed payment, recorded by the Stripe webhook. Amounts are in cents.
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.armory_items (id) on delete set null,
  member_id uuid not null references public.profiles (id) on delete cascade,
  seller_id uuid references public.profiles (id) on delete set null,
  item_title text not null,
  amount_cents integer not null check (amount_cents >= 0),
  fee_cents integer not null check (fee_cents >= 0),
  currency text not null default 'usd',
  stripe_session_id text not null unique,
  created_at timestamptz not null default now()
);

create index purchases_member_idx on public.purchases (member_id, created_at desc);
create index purchases_seller_idx on public.purchases (seller_id, created_at desc);
create index purchases_item_member_idx on public.purchases (item_id, member_id);

alter table public.payout_accounts enable row level security;
alter table public.purchases enable row level security;

create policy "Coaches can see their own payout account"
on public.payout_accounts for select to authenticated
using (coach_id = (select auth.uid()) or (select private.is_admin()));

create policy "People can see purchases they made or received"
on public.purchases for select to authenticated
using (
  member_id = (select auth.uid())
  or seller_id = (select auth.uid())
  or (select private.is_admin())
);

-- Only the server (service role) writes these, after Stripe confirms.
revoke all on public.payout_accounts from public, anon, authenticated;
revoke all on public.purchases from public, anon, authenticated;
grant select on public.payout_accounts to authenticated;
grant select on public.purchases to authenticated;
grant select, insert, update on public.payout_accounts to service_role;
grant select, insert on public.purchases to service_role;
