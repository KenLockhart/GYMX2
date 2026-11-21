-- Program commerce Gate 1: trusted ledger and entitlement foundation only.
-- No checkout session, webhook, or content route is activated by this migration.

create table public.program_promotions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  offer_version_id uuid not null,
  code text not null check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  discount_kind text not null check (discount_kind in ('fixed', 'percent')),
  discount_value integer not null check (discount_value > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_redemptions integer not null check (max_redemptions between 1 and 1000000),
  enabled boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (program_id, offer_version_id, code),
  unique (program_id, offer_version_id, id),
  foreign key (program_id, offer_version_id)
    references public.program_offer_versions (program_id, id) on delete restrict,
  check (ends_at is null or ends_at > starts_at),
  check ((discount_kind = 'fixed' and discount_value <= 2147483647)
      or (discount_kind = 'percent' and discount_value between 1 and 10000))
);

create table public.program_orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  buyer_id uuid not null,
  program_id uuid not null references public.programs (id) on delete restrict,
  offer_version_id uuid not null,
  content_version_id uuid not null,
  lesson_count smallint not null check (lesson_count between 1 and 365),
  seller_profile_id uuid not null,
  platform_owned boolean not null,
  connected_account_id text,
  application_fee_basis_points smallint not null,
  currency text not null check (currency = 'usd'),
  list_price_cents integer not null check (list_price_cents between 50 and 2147483647),
  discount_cents integer not null check (discount_cents between 0 and list_price_cents),
  effective_total_cents integer not null check (effective_total_cents = list_price_cents - discount_cents),
  payment_plan text not null check (payment_plan in ('free', 'pay_in_full', 'installments')),
  installment_count smallint not null check (installment_count between 0 and 12),
  installment_amounts_cents integer[] not null,
  promotion_id uuid,
  zero_total_grant_reason text,
  created_at timestamptz not null default now(),
  unique (buyer_id, idempotency_key),
  unique (buyer_id, program_id),
  unique (id, buyer_id),
  foreign key (program_id, offer_version_id)
    references public.program_offer_versions (program_id, id) on delete restrict,
  foreign key (program_id, content_version_id)
    references public.program_content_versions (program_id, id) on delete restrict,
  foreign key (program_id, offer_version_id, promotion_id)
    references public.program_promotions (program_id, offer_version_id, id) on delete restrict,
  check (
    (platform_owned and connected_account_id is null and application_fee_basis_points = 0)
    or (not platform_owned and connected_account_id ~ '^acct_[A-Za-z0-9]+$'
        and application_fee_basis_points = 1000)
  ),
  check (
    (effective_total_cents = 0 and payment_plan = 'free' and installment_count = 0
      and cardinality(installment_amounts_cents) = 0 and promotion_id is not null
      and zero_total_grant_reason = 'promotion_100_percent')
    or (effective_total_cents > 0 and payment_plan = 'pay_in_full' and installment_count = 1
      and cardinality(installment_amounts_cents) = 1 and zero_total_grant_reason is null)
    or (effective_total_cents > 0 and payment_plan = 'installments'
      and installment_count between 2 and least(12, lesson_count)
      and cardinality(installment_amounts_cents) = installment_count and zero_total_grant_reason is null)
  )
);

create table public.program_order_state (
  order_id uuid primary key references public.program_orders (id) on delete restrict,
  revision bigint not null default 0 check (revision >= 0),
  billing_state text not null check (billing_state in (
    'awaiting_checkout', 'checkout_pending', 'active', 'paid',
    'cancel_requested', 'canceled', 'closed', 'free_grant'
  )),
  checkout_session_id text,
  -- Set by the trusted first settled installment or an atomic no-charge grant.
  access_started_on date,
  updated_at timestamptz not null default now(),
  check (checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$')
);

create table public.program_order_installments (
  order_id uuid not null references public.program_orders (id) on delete restrict,
  installment_number smallint not null check (installment_number between 1 and 12),
  due_cents integer not null check (due_cents between 50 and 2147483647),
  revision bigint not null default 0 check (revision >= 0),
  provider_status text not null default 'unpaid' check (provider_status in (
    'unpaid', 'requires_payment_method', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled'
  )),
  gross_settled_cents integer not null default 0 check (gross_settled_cents >= 0),
  provider_refunded_cents integer not null default 0 check (provider_refunded_cents >= 0),
  refund_marker_cents integer not null default 0 check (refund_marker_cents >= 0),
  net_settled_cents integer generated always as
    (greatest(0, gross_settled_cents - greatest(provider_refunded_cents, refund_marker_cents))) stored,
  updated_at timestamptz not null default now(),
  primary key (order_id, installment_number),
  check (provider_refunded_cents <= gross_settled_cents),
  check (gross_settled_cents <= due_cents),
  check (refund_marker_cents <= due_cents),
  check (provider_status <> 'succeeded' or gross_settled_cents = due_cents),
  check (provider_status = 'succeeded' or gross_settled_cents = 0)
);

create table public.program_provider_object_claims (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'stripe'),
  object_type text not null check (object_type in (
    'checkout_session', 'invoice', 'charge', 'schedule'
  )),
  object_id text not null check (char_length(object_id) between 4 and 255),
  canonical_payment_intent_id text,
  order_id uuid not null references public.program_orders (id) on delete restrict,
  installment_number smallint,
  created_at timestamptz not null default now(),
  unique (provider, object_type, object_id),
  foreign key (order_id, installment_number)
    references public.program_order_installments (order_id, installment_number) on delete restrict,
  check ((object_type in ('checkout_session', 'schedule') and installment_number is null and canonical_payment_intent_id is null)
      or (object_type in ('invoice', 'charge') and installment_number is not null and installment_number between 1 and 12
          and canonical_payment_intent_id is not null and canonical_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$')),
  check ((object_type = 'checkout_session' and object_id ~ '^cs_[A-Za-z0-9_]+$')
      or (object_type = 'invoice' and object_id ~ '^in_[A-Za-z0-9_]+$')
      or (object_type = 'charge' and object_id ~ '^ch_[A-Za-z0-9_]+$')
      or (object_type = 'schedule' and object_id ~ '^sub_sched_[A-Za-z0-9_]+$'))
);

create table public.program_payment_intent_claims (
  payment_intent_id text primary key check (payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  order_id uuid not null,
  installment_number smallint not null,
  created_at timestamptz not null default now(),
  unique (payment_intent_id, order_id, installment_number),
  unique (order_id, installment_number),
  foreign key (order_id, installment_number)
    references public.program_order_installments (order_id, installment_number) on delete restrict
);
alter table public.program_provider_object_claims
  add constraint program_provider_alias_payment_intent_fk
  foreign key (canonical_payment_intent_id, order_id, installment_number)
  references public.program_payment_intent_claims (payment_intent_id, order_id, installment_number)
  on delete restrict;

create table public.program_payment_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique check (char_length(provider_event_id) between 4 and 255),
  event_kind text not null check (event_kind in ('payment_snapshot', 'refund_marker')),
  order_id uuid not null,
  installment_number smallint not null,
  provider_object_type text not null,
  provider_object_id text not null,
  provider_status text not null check (provider_status in ('unpaid', 'requires_payment_method', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled', 'refund_marker')),
  provider_invoice_id text check (provider_invoice_id is null or provider_invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  provider_charge_id text check (provider_charge_id is null or provider_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  amount_cents integer not null check (amount_cents >= 0),
  provider_refunded_cents integer not null default 0 check (provider_refunded_cents >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  accepted_revision bigint not null check (accepted_revision >= 0),
  created_at timestamptz not null default now(),
  foreign key (order_id, installment_number)
    references public.program_order_installments (order_id, installment_number) on delete restrict,
  check (provider_object_type = 'payment_intent' and provider_object_id ~ '^pi_[A-Za-z0-9_]+$')
);

create table public.program_refund_markers (
  id uuid primary key default gen_random_uuid(),
  provider_refund_id text not null unique check (char_length(provider_refund_id) between 4 and 255),
  provider_charge_id text not null check (provider_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
  provider_payment_intent_id text not null check (provider_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  provider_event_id text not null unique check (char_length(provider_event_id) between 4 and 255),
  order_id uuid not null,
  installment_number smallint not null,
  amount_cents integer not null check (amount_cents between 1 and 2147483647),
  created_at timestamptz not null default now(),
  foreign key (order_id, installment_number)
    references public.program_order_installments (order_id, installment_number) on delete restrict,
  foreign key (provider_payment_intent_id, order_id, installment_number)
    references public.program_payment_intent_claims (payment_intent_id, order_id, installment_number) on delete restrict
);

create table public.program_promotion_reservations (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  program_id uuid not null,
  offer_version_id uuid not null,
  order_id uuid not null unique references public.program_orders (id) on delete restrict,
  member_id uuid not null,
  state text not null check (state in ('reserved', 'redeemed', 'released')),
  revision bigint not null default 0 check (revision >= 0),
  checkout_session_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (promotion_id, order_id),
  foreign key (program_id, offer_version_id, promotion_id)
    references public.program_promotions (program_id, offer_version_id, id) on delete restrict,
  foreign key (order_id, member_id)
    references public.program_orders (id, buyer_id) on delete restrict,
  check (checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$')
);
create index program_promotion_reservations_quota_idx
  on public.program_promotion_reservations (promotion_id, state, member_id);

create table public.program_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null,
  program_id uuid not null,
  offer_version_id uuid not null,
  order_id uuid not null unique references public.program_orders (id) on delete restrict,
  member_id uuid not null,
  discount_cents integer not null check (discount_cents > 0),
  redeemed_at timestamptz not null default now(),
  unique (promotion_id, member_id),
  foreign key (program_id, offer_version_id, promotion_id)
    references public.program_promotions (program_id, offer_version_id, id) on delete restrict,
  foreign key (order_id, member_id)
    references public.program_orders (id, buyer_id) on delete restrict
);

create index program_orders_buyer_created_idx on public.program_orders (buyer_id, created_at desc);
create index program_orders_program_version_idx on public.program_orders (program_id, content_version_id);

alter table public.program_promotions enable row level security;
alter table public.program_orders enable row level security;
alter table public.program_order_state enable row level security;
alter table public.program_order_installments enable row level security;
alter table public.program_provider_object_claims enable row level security;
alter table public.program_payment_intent_claims enable row level security;
alter table public.program_payment_events enable row level security;
alter table public.program_refund_markers enable row level security;
alter table public.program_promotion_reservations enable row level security;
alter table public.program_promotion_redemptions enable row level security;

revoke all on public.program_promotions, public.program_orders, public.program_order_state,
  public.program_order_installments, public.program_provider_object_claims, public.program_payment_intent_claims,
  public.program_payment_events, public.program_refund_markers,
  public.program_promotion_reservations, public.program_promotion_redemptions
  from public, anon, authenticated;
grant select, insert, update, delete on public.program_promotions, public.program_orders,
  public.program_order_state, public.program_order_installments,
  public.program_provider_object_claims, public.program_payment_intent_claims, public.program_payment_events,
  public.program_refund_markers, public.program_promotion_reservations,
  public.program_promotion_redemptions to service_role;

create function private.prevent_program_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Program financial audit rows are immutable' using errcode = '55000';
end;
$$;
revoke all on function private.prevent_program_ledger_mutation() from public, anon, authenticated;
create trigger program_orders_append_only before update or delete on public.program_orders
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_provider_claims_append_only before update or delete on public.program_provider_object_claims
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_payment_intent_claims_append_only before update or delete on public.program_payment_intent_claims
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_payment_events_append_only before update or delete on public.program_payment_events
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_refund_markers_append_only before update or delete on public.program_refund_markers
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_promotion_redemptions_append_only before update or delete on public.program_promotion_redemptions
  for each row execute function private.prevent_program_ledger_mutation();
create trigger program_promotions_append_only before update or delete on public.program_promotions
  for each row execute function private.prevent_program_ledger_mutation();

create function private.validate_program_order_state_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.program_orders%rowtype;
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Program order state revision must advance by one' using errcode = '40001';
  end if;
  if old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id then
    raise exception 'A Program Checkout Session binding is immutable' using errcode = '55000';
  end if;
  if old.access_started_on is not null and new.access_started_on is distinct from old.access_started_on then
    raise exception 'A Program access start date is immutable once set' using errcode = '55000';
  end if;
  if old.access_started_on is null and new.access_started_on is not null then
    select orders.* into order_row from public.program_orders orders where orders.id = new.order_id;
    if order_row.zero_total_grant_reason = 'promotion_100_percent' then
      if not exists (select 1 from public.program_promotion_redemptions redemption
        where redemption.order_id = new.order_id and redemption.promotion_id = order_row.promotion_id) then
        raise exception 'A zero-total access start requires a recorded promotion redemption' using errcode = '23514';
      end if;
    elsif not exists (
      select 1 from public.program_order_installments installment
      where installment.order_id = new.order_id and installment.installment_number = 1
        and installment.provider_status = 'succeeded'
        and installment.net_settled_cents = installment.due_cents
    ) then
      raise exception 'A paid access start requires the first net-settled installment' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_order_state_change() from public, anon, authenticated;
create trigger program_order_state_guard before update on public.program_order_state
  for each row execute function private.validate_program_order_state_change();

create function private.validate_program_promotion_reservation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.revision <> old.revision + 1
     or (old.state <> 'reserved' and new.state <> old.state)
     or (old.checkout_session_id is not null and new.checkout_session_id is distinct from old.checkout_session_id) then
    raise exception 'Program promotion reservation transition is invalid' using errcode = '40001';
  end if;
  if new.state not in ('reserved', 'redeemed', 'released') then
    raise exception 'Program promotion reservation state is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_promotion_reservation_change() from public, anon, authenticated;
create trigger program_promotion_reservation_guard before update on public.program_promotion_reservations
  for each row execute function private.validate_program_promotion_reservation_change();

create function private.validate_program_order_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  offer_row public.program_offer_versions%rowtype;
  promo_row public.program_promotions%rowtype;
  version_count integer;
  expected_amount integer;
  expected_discount integer;
  allocated_sum bigint := 0;
  index_value integer;
begin
  select offer.* into offer_row from public.program_offer_versions offer
  where offer.program_id = new.program_id and offer.id = new.offer_version_id;
  if not found or offer_row.offer_kind <> 'paid'
     or offer_row.content_version_id <> new.content_version_id
     or offer_row.platform_owned <> new.platform_owned
     or offer_row.seller_profile_id <> new.seller_profile_id
     or offer_row.connected_account_id is distinct from new.connected_account_id
     or offer_row.currency <> new.currency
     or offer_row.list_price_cents <> new.list_price_cents
     or new.installment_count > offer_row.max_installments then
    raise exception 'Program order snapshot does not match its immutable offer' using errcode = '23514';
  end if;
  select version.lesson_count::integer into version_count
  from public.program_content_versions version
  where version.program_id = new.program_id and version.id = new.content_version_id
    and version.revision_kind = 'paid';
  if not found or version_count <> new.lesson_count then
    raise exception 'Program order lesson version is invalid' using errcode = '23514';
  end if;
  if new.platform_owned then
    if new.application_fee_basis_points <> 0 or new.connected_account_id is not null then
      raise exception 'Platform-owned order cannot contain a coach transfer' using errcode = '23514';
    end if;
  elsif new.application_fee_basis_points <> 1000 or new.connected_account_id is null then
    raise exception 'Coach-owned order must snapshot the 10 percent destination split' using errcode = '23514';
  end if;
  if cardinality(new.installment_amounts_cents) <> new.installment_count then
    raise exception 'Program order installment amounts are incomplete' using errcode = '23514';
  end if;
  if new.effective_total_cents = 0 then
    if new.promotion_id is null or new.payment_plan <> 'free' or new.installment_count <> 0
       or new.zero_total_grant_reason <> 'promotion_100_percent' then
      raise exception 'A zero-total order needs an explicit 100 percent promotion grant' using errcode = '23514';
    end if;
  else
    if new.zero_total_grant_reason is not null
       or new.installment_count < 1 or new.installment_count > least(12, new.lesson_count)
       or (new.payment_plan = 'pay_in_full' and new.installment_count <> 1)
       or (new.payment_plan = 'installments' and new.installment_count < 2)
       or new.payment_plan = 'free' then
      raise exception 'Program order payment plan is invalid' using errcode = '23514';
    end if;
    for index_value in 1..new.installment_count loop
      expected_amount := case when index_value = new.installment_count
        then new.effective_total_cents - (new.effective_total_cents / new.installment_count) * (new.installment_count - 1)
        else new.effective_total_cents / new.installment_count end;
      if new.installment_amounts_cents[index_value] <> expected_amount or expected_amount < 50 then
        raise exception 'Program installment amount does not match the fixed total' using errcode = '23514';
      end if;
      allocated_sum := allocated_sum + new.installment_amounts_cents[index_value];
    end loop;
    if allocated_sum <> new.effective_total_cents then
      raise exception 'Program installment amounts do not sum to the fixed total' using errcode = '23514';
    end if;
  end if;
  if new.promotion_id is null and new.discount_cents <> 0 then
    raise exception 'Program discounts require a server-owned promotion' using errcode = '23514';
  end if;
  if new.promotion_id is not null and not exists (
    select 1 from public.program_promotions promo
    where promo.id = new.promotion_id and promo.program_id = new.program_id
      and promo.offer_version_id = new.offer_version_id
  ) then
    raise exception 'Program promotion does not match the order offer' using errcode = '23514';
  end if;
  if new.promotion_id is not null then
    select promo.* into promo_row from public.program_promotions promo where promo.id = new.promotion_id;
    expected_discount := case promo_row.discount_kind
      when 'fixed' then least(new.list_price_cents, promo_row.discount_value)
      else round((new.list_price_cents::numeric * promo_row.discount_value::numeric) / 10000)::integer
    end;
    if new.discount_cents <> expected_discount then
      raise exception 'Program order discount does not match its immutable promotion' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_order_snapshot() from public, anon, authenticated;
create trigger program_orders_validate_insert before insert on public.program_orders
  for each row execute function private.validate_program_order_snapshot();

create function private.prevent_program_installment_term_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.order_id is distinct from old.order_id
     or new.installment_number is distinct from old.installment_number
     or new.due_cents is distinct from old.due_cents then
    raise exception 'Program installment terms are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_program_installment_term_mutation() from public, anon, authenticated;
create trigger program_installment_terms_immutable before update or delete on public.program_order_installments
  for each row execute function private.prevent_program_installment_term_mutation();

create function public.create_program_order_reservation(
  target_member_id uuid,
  target_program_id uuid,
  target_offer_version_id uuid,
  target_installment_count smallint,
  target_idempotency_key text,
  target_promotion_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_order public.program_orders%rowtype;
  program_row public.programs%rowtype;
  offer_row public.program_offer_versions%rowtype;
  version_row public.program_content_versions%rowtype;
  promo_row public.program_promotions%rowtype;
  promo_code text := nullif(upper(btrim(target_promotion_code)), '');
  promo_id uuid;
  discount_amount integer := 0;
  total_amount integer;
  installment_count smallint;
  payment_plan text;
  amounts integer[] := array[]::integer[];
  each_amount integer;
  remainder_amount integer;
  order_id uuid;
  promo_used integer;
  current_eastern_date date := (now() at time zone 'America/New_York')::date;
  index_value integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program order reservations are server managed' using errcode = '42501';
  end if;
  if target_member_id is null or target_program_id is null or target_offer_version_id is null
     or target_installment_count is null
     or target_idempotency_key is null or char_length(target_idempotency_key) not between 8 and 128
     or (promo_code is not null and promo_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception 'Program order request is invalid' using errcode = '22023';
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '30s', true);
  -- Match the advisory key used by lock_platform_membership_account_for_deletion.
  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));

  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = target_member_id) then
    raise exception 'Program order is blocked while account deletion is pending' using errcode = '55000';
  end if;
  select orders.* into existing_order
  from public.program_orders orders
  where orders.buyer_id = target_member_id and orders.idempotency_key = target_idempotency_key;
  if found then
    if existing_order.program_id <> target_program_id
       or existing_order.offer_version_id <> target_offer_version_id
       or existing_order.installment_count <> target_installment_count
       or ((promo_code is null) <> (existing_order.promotion_id is null))
       or (promo_code is not null and not exists (
         select 1 from public.program_promotions promo
         where promo.id = existing_order.promotion_id and promo.code = promo_code
       )) then
      raise exception 'Program order idempotency key was reused with different terms' using errcode = '23505';
    end if;
    return existing_order.id;
  end if;

  if not private.has_role(target_member_id, 'member'::public.user_role)
     or not private.has_platform_tier(target_member_id, 'regular') then
    raise exception 'An active Regular or Premium member account is required' using errcode = '42501';
  end if;
  if exists (select 1 from public.program_orders prior_order
             where prior_order.buyer_id = target_member_id and prior_order.program_id = target_program_id) then
    -- Gate 1 deliberately blocks all second orders, including after a locally expired Session.
    -- A later billing phase may reopen only after provider-verified terminal reconciliation.
    raise exception 'PROGRAM_ALREADY_OWNED_OR_IN_PROGRESS' using errcode = 'P0001';
  end if;

  select program.* into program_row
  from public.programs program
  join public.program_commerce_state state on state.program_id = program.id
  where program.id = target_program_id and state.current_offer_version_id = target_offer_version_id
  for update of program, state;
  if not found or not program_row.published then
    raise exception 'Program offer is unavailable' using errcode = 'P0002';
  end if;
  select offer.* into offer_row from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = target_offer_version_id for share;
  if not found or offer_row.offer_kind <> 'paid'
     or offer_row.platform_owned <> program_row.platform_owned
     or offer_row.seller_profile_id <> program_row.coach_id then
    raise exception 'Program offer is unavailable' using errcode = 'P0002';
  end if;
  if not program_row.platform_owned and not exists (
    select 1 from public.coach_members cm
    where cm.coach_id = program_row.coach_id and cm.member_id = target_member_id
  ) then
    raise exception 'A coach link is required for this Program' using errcode = '42501';
  end if;
  select version.* into version_row
  from public.program_content_versions version
  where version.program_id = target_program_id and version.id = offer_row.content_version_id
    and version.revision_kind = 'paid' and version.lesson_count between 1 and 365
  for share;
  if not found then
    raise exception 'Paid Program lesson version is unavailable' using errcode = '23514';
  end if;

  if promo_code is not null then
    select promo.* into promo_row
    from public.program_promotions promo
    where promo.program_id = target_program_id and promo.offer_version_id = target_offer_version_id
      and promo.code = promo_code
    for update;
    if not found or not promo_row.enabled or promo_row.starts_at > now()
       or (promo_row.ends_at is not null and promo_row.ends_at <= now()) then
      raise exception 'Program promotion is unavailable' using errcode = 'P0002';
    end if;
    select count(*)::integer into promo_used
    from public.program_promotion_reservations reservation
    where reservation.promotion_id = promo_row.id and reservation.state in ('reserved', 'redeemed');
    if promo_used >= promo_row.max_redemptions or exists (
      select 1 from public.program_promotion_redemptions redemption
      where redemption.promotion_id = promo_row.id and redemption.member_id = target_member_id
    ) or exists (
      select 1 from public.program_promotion_reservations reservation
      where reservation.promotion_id = promo_row.id and reservation.member_id = target_member_id
        and reservation.state in ('reserved', 'redeemed')
    ) then
      raise exception 'Program promotion quota is unavailable' using errcode = '23505';
    end if;
    promo_id := promo_row.id;
    discount_amount := case promo_row.discount_kind
      when 'fixed' then least(offer_row.list_price_cents, promo_row.discount_value)
      else round((offer_row.list_price_cents::numeric * promo_row.discount_value::numeric) / 10000)::integer
    end;
  elsif target_promotion_code is not null and btrim(target_promotion_code) <> '' then
    raise exception 'Program promotion code is invalid' using errcode = '22023';
  end if;

  total_amount := offer_row.list_price_cents - discount_amount;
  if total_amount = 0 then
    if promo_id is null or target_installment_count <> 0 then
      raise exception 'A zero-total grant must come from a 100 percent promotion' using errcode = '23514';
    end if;
    installment_count := 0;
    payment_plan := 'free';
  else
    if target_installment_count < 1
       or target_installment_count > least(12, version_row.lesson_count, offer_row.max_installments) then
      raise exception 'Program installment count is invalid' using errcode = '23514';
    end if;
    installment_count := target_installment_count;
    payment_plan := case when installment_count = 1 then 'pay_in_full' else 'installments' end;
    each_amount := total_amount / installment_count;
    remainder_amount := total_amount - each_amount * (installment_count - 1);
    if each_amount < 50 or remainder_amount < 50 then
      raise exception 'Each Program installment must meet the minimum charge' using errcode = '23514';
    end if;
    for index_value in 1..installment_count loop
      amounts := array_append(amounts, case when index_value = installment_count then remainder_amount else each_amount end);
    end loop;
  end if;

  insert into public.program_orders (
    idempotency_key, buyer_id, program_id, offer_version_id, content_version_id, lesson_count,
    seller_profile_id, platform_owned, connected_account_id, application_fee_basis_points,
    currency, list_price_cents, discount_cents, effective_total_cents, payment_plan,
    installment_count, installment_amounts_cents, promotion_id, zero_total_grant_reason
  ) values (
    target_idempotency_key, target_member_id, target_program_id, target_offer_version_id,
    offer_row.content_version_id, version_row.lesson_count, offer_row.seller_profile_id,
    offer_row.platform_owned, offer_row.connected_account_id,
    case when offer_row.platform_owned then 0 else 1000 end,
    offer_row.currency, offer_row.list_price_cents, discount_amount, total_amount, payment_plan,
    installment_count, amounts, promo_id,
    case when total_amount = 0 then 'promotion_100_percent' else null end
  ) returning id into order_id;
  insert into public.program_order_state (order_id, billing_state, access_started_on)
  values (order_id, case when total_amount = 0 then 'free_grant' else 'awaiting_checkout' end,
    case when total_amount = 0 then current_eastern_date else null end);
  if installment_count > 0 then
    for index_value in 1..installment_count loop
      insert into public.program_order_installments (order_id, installment_number, due_cents)
      values (order_id, index_value, amounts[index_value]);
    end loop;
  end if;
  if promo_id is not null then
    insert into public.program_promotion_reservations (
      promotion_id, program_id, offer_version_id, order_id, member_id, state
    ) values (
      promo_id, target_program_id, target_offer_version_id, order_id, target_member_id,
      case when total_amount = 0 then 'redeemed' else 'reserved' end
    );
    if total_amount = 0 then
      insert into public.program_promotion_redemptions (
        promotion_id, program_id, offer_version_id, order_id, member_id, discount_cents
      ) values (promo_id, target_program_id, target_offer_version_id, order_id, target_member_id, discount_amount);
    end if;
  end if;
  return order_id;
end;
$$;
revoke all on function public.create_program_order_reservation(uuid, uuid, uuid, smallint, text, text)
  from public, anon, authenticated;
grant execute on function public.create_program_order_reservation(uuid, uuid, uuid, smallint, text, text)
  to service_role;

create function public.bind_program_checkout_session(
  target_order_id uuid,
  target_expected_revision bigint,
  target_checkout_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_buyer uuid;
  state_row public.program_order_state%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program checkout binding is server managed' using errcode = '42501';
  end if;
  select orders.buyer_id into order_buyer from public.program_orders orders where orders.id = target_order_id;
  if not found or target_expected_revision is null or target_checkout_session_id is null
     or target_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(order_buyer::text, 0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = order_buyer) then
    return false;
  end if;
  select state.* into state_row from public.program_order_state state
  where state.order_id = target_order_id for update;
  if not found then return false; end if;
  if state_row.checkout_session_id = target_checkout_session_id then return true; end if;
  if state_row.revision <> target_expected_revision or state_row.checkout_session_id is not null
     or state_row.billing_state not in ('awaiting_checkout', 'active') then return false; end if;
  insert into public.program_provider_object_claims (provider, object_type, object_id, order_id)
  values ('stripe', 'checkout_session', target_checkout_session_id, target_order_id)
  on conflict (provider, object_type, object_id) do nothing;
  if not exists (
    select 1 from public.program_provider_object_claims claim
    where claim.provider = 'stripe' and claim.object_type = 'checkout_session'
      and claim.object_id = target_checkout_session_id and claim.order_id = target_order_id
      and claim.installment_number is null
  ) then return false; end if;
  update public.program_order_state set checkout_session_id = target_checkout_session_id,
    billing_state = case when billing_state = 'awaiting_checkout' then 'checkout_pending' else billing_state end,
    revision = revision + 1, updated_at = now()
  where order_id = target_order_id;
  update public.program_promotion_reservations set checkout_session_id = target_checkout_session_id,
    revision = revision + 1, updated_at = now()
  where order_id = target_order_id and state = 'reserved';
  return true;
end;
$$;
revoke all on function public.bind_program_checkout_session(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.bind_program_checkout_session(uuid, bigint, text) to service_role;

create function public.record_program_installment_payment(
  target_order_id uuid,
  target_installment_number smallint,
  target_expected_revision bigint,
  target_provider_event_id text,
  target_payment_intent_id text,
  target_invoice_id text,
  target_charge_id text,
  target_provider_status text,
  target_gross_settled_cents integer,
  target_provider_refunded_cents integer,
  target_currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_buyer uuid;
  order_row public.program_orders%rowtype;
  state_row public.program_order_state%rowtype;
  installment public.program_order_installments%rowtype;
  existing_event public.program_payment_events%rowtype;
  cleared integer := 0;
  row_payment record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program payment records are server managed' using errcode = '42501';
  end if;
  if target_order_id is null or target_installment_number is null or target_expected_revision is null
     or target_provider_event_id is null or target_provider_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     or (target_invoice_id is not null and target_invoice_id !~ '^in_[A-Za-z0-9_]+$')
     or (target_charge_id is not null and target_charge_id !~ '^ch_[A-Za-z0-9_]+$')
     or target_provider_status is null
     or target_provider_status not in ('unpaid', 'requires_payment_method', 'requires_action', 'processing', 'succeeded', 'failed', 'canceled')
     or target_currency is distinct from 'usd' or target_gross_settled_cents is null
     or target_provider_refunded_cents is null or target_gross_settled_cents < 0
     or target_provider_refunded_cents < 0 then
    return false;
  end if;
  select orders.buyer_id into order_buyer from public.program_orders orders where orders.id = target_order_id;
  if not found then return false; end if;
  -- Serialize different installments for the same buyer/order before aggregate stage recomputation.
  perform pg_advisory_xact_lock(hashtextextended(order_buyer::text, 0));
  select state.* into state_row from public.program_order_state state
  where state.order_id = target_order_id for update;
  if not found then return false; end if;
  select terms.* into installment from public.program_order_installments terms
  where terms.order_id = target_order_id and terms.installment_number = target_installment_number
  for update;
  if not found then return false; end if;
  select event.* into existing_event from public.program_payment_events event
  where event.provider_event_id = target_provider_event_id;
  if found then
    return existing_event.event_kind = 'payment_snapshot' and existing_event.order_id = target_order_id
      and existing_event.installment_number = target_installment_number
      and existing_event.provider_object_type = 'payment_intent'
      and existing_event.provider_object_id = target_payment_intent_id
      and existing_event.provider_invoice_id is not distinct from target_invoice_id
      and existing_event.provider_charge_id is not distinct from target_charge_id
      and existing_event.provider_status = target_provider_status
      and existing_event.amount_cents = target_gross_settled_cents
      and existing_event.provider_refunded_cents = target_provider_refunded_cents
      and existing_event.currency = target_currency;
  end if;
  if installment.revision <> target_expected_revision
     or target_gross_settled_cents > installment.due_cents
     or target_provider_refunded_cents > target_gross_settled_cents
     or (target_provider_status = 'succeeded' and target_gross_settled_cents <> installment.due_cents)
     or (target_provider_status <> 'succeeded' and target_gross_settled_cents <> 0) then
    return false;
  end if;

  begin
    insert into public.program_payment_intent_claims (payment_intent_id, order_id, installment_number)
    values (target_payment_intent_id, target_order_id, target_installment_number)
    on conflict (payment_intent_id) do nothing;
    if not exists (select 1 from public.program_payment_intent_claims claim
      where claim.payment_intent_id = target_payment_intent_id and claim.order_id = target_order_id
        and claim.installment_number = target_installment_number) then
      raise exception 'PaymentIntent is already bound to a different order or installment' using errcode = '23505';
    end if;
    if target_invoice_id is not null then
      insert into public.program_provider_object_claims (
        provider, object_type, object_id, canonical_payment_intent_id, order_id, installment_number
      ) values ('stripe', 'invoice', target_invoice_id, target_payment_intent_id, target_order_id, target_installment_number)
      on conflict (provider, object_type, object_id) do nothing;
      if not exists (select 1 from public.program_provider_object_claims claim
        where claim.provider = 'stripe' and claim.object_type = 'invoice' and claim.object_id = target_invoice_id
          and claim.canonical_payment_intent_id = target_payment_intent_id and claim.order_id = target_order_id
          and claim.installment_number = target_installment_number) then
        raise exception 'Invoice is already bound to a different PaymentIntent or order' using errcode = '23505';
      end if;
    end if;
    if target_charge_id is not null then
      insert into public.program_provider_object_claims (
        provider, object_type, object_id, canonical_payment_intent_id, order_id, installment_number
      ) values ('stripe', 'charge', target_charge_id, target_payment_intent_id, target_order_id, target_installment_number)
      on conflict (provider, object_type, object_id) do nothing;
      if not exists (select 1 from public.program_provider_object_claims claim
        where claim.provider = 'stripe' and claim.object_type = 'charge' and claim.object_id = target_charge_id
          and claim.canonical_payment_intent_id = target_payment_intent_id and claim.order_id = target_order_id
          and claim.installment_number = target_installment_number) then
        raise exception 'Charge is already bound to a different PaymentIntent or order' using errcode = '23505';
      end if;
    end if;
    select orders.* into order_row from public.program_orders orders where orders.id = target_order_id;
    insert into public.program_payment_events (
      provider_event_id, event_kind, order_id, installment_number,
      provider_object_type, provider_object_id, provider_status, provider_invoice_id, provider_charge_id,
      amount_cents, provider_refunded_cents, currency, accepted_revision
    ) values (
      target_provider_event_id, 'payment_snapshot', target_order_id, target_installment_number,
      'payment_intent', target_payment_intent_id, target_provider_status, target_invoice_id, target_charge_id,
      target_gross_settled_cents, target_provider_refunded_cents, target_currency, target_expected_revision + 1
    );
    update public.program_order_installments terms
    set provider_status = target_provider_status,
        gross_settled_cents = target_gross_settled_cents,
        provider_refunded_cents = greatest(terms.provider_refunded_cents, target_provider_refunded_cents),
        revision = terms.revision + 1,
        updated_at = now()
    where terms.order_id = target_order_id and terms.installment_number = target_installment_number;

    for row_payment in
      select terms.installment_number, terms.due_cents, terms.net_settled_cents, terms.provider_status
      from public.program_order_installments terms where terms.order_id = target_order_id
      order by terms.installment_number
    loop
      exit when row_payment.installment_number <> cleared + 1
        or row_payment.provider_status <> 'succeeded' or row_payment.net_settled_cents < row_payment.due_cents;
      cleared := cleared + 1;
    end loop;
    update public.program_order_state state
    set billing_state = case
          when state.billing_state in ('cancel_requested', 'canceled', 'closed') then state.billing_state
          when cleared = order_row.installment_count and order_row.installment_count > 0 then 'paid'
          when cleared > 0 then 'active'
          else state.billing_state
        end,
        access_started_on = case
          when target_installment_number = 1 and target_provider_status = 'succeeded'
            and (select terms.net_settled_cents = terms.due_cents
                 from public.program_order_installments terms
                 where terms.order_id = target_order_id and terms.installment_number = 1)
            then coalesce(state.access_started_on, (now() at time zone 'America/New_York')::date)
          else state.access_started_on
        end,
        revision = state.revision + 1, updated_at = now()
    where state.order_id = target_order_id;
    if target_installment_number = 1 and target_provider_status = 'succeeded'
       and (select terms.net_settled_cents = terms.due_cents from public.program_order_installments terms
            where terms.order_id = target_order_id and terms.installment_number = 1)
       and order_row.promotion_id is not null then
      update public.program_promotion_reservations reservation
      set state = 'redeemed', revision = revision + 1, updated_at = now()
      where reservation.order_id = target_order_id and reservation.state = 'reserved';
      insert into public.program_promotion_redemptions (
        promotion_id, program_id, offer_version_id, order_id, member_id, discount_cents
      ) select order_row.promotion_id, order_row.program_id, order_row.offer_version_id,
               order_row.id, order_row.buyer_id, order_row.discount_cents
        where not exists (select 1 from public.program_promotion_redemptions redemption where redemption.order_id = target_order_id);
    end if;
  exception when unique_violation or check_violation then
    return false;
  end;
  return true;
end;
$$;
revoke all on function public.record_program_installment_payment(uuid, smallint, bigint, text, text, text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.record_program_installment_payment(uuid, smallint, bigint, text, text, text, text, text, integer, integer, text)
  to service_role;
create function public.record_program_refund_marker(
  target_order_id uuid,
  target_installment_number smallint,
  target_expected_revision bigint,
  target_provider_event_id text,
  target_provider_refund_id text,
  target_payment_intent_id text,
  target_provider_charge_id text,
  target_amount_cents integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_buyer uuid;
  order_row public.program_orders%rowtype;
  state_row public.program_order_state%rowtype;
  installment public.program_order_installments%rowtype;
  existing_event public.program_payment_events%rowtype;
  existing_marker public.program_refund_markers%rowtype;
  refund_total integer;
  cleared integer := 0;
  row_payment record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program refund records are server managed' using errcode = '42501';
  end if;
  if target_order_id is null or target_installment_number is null or target_expected_revision is null
     or target_provider_event_id is null or target_provider_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or target_provider_refund_id is null or target_provider_refund_id !~ '^re_[A-Za-z0-9_]+$'
     or target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     or target_provider_charge_id is null or target_provider_charge_id !~ '^ch_[A-Za-z0-9_]+$'
     or target_amount_cents is null or target_amount_cents < 1 then return false; end if;
  select orders.buyer_id into order_buyer from public.program_orders orders where orders.id = target_order_id;
  if not found then return false; end if;
  -- Every financial mutation uses buyer advisory -> order state -> installment lock order.
  perform pg_advisory_xact_lock(hashtextextended(order_buyer::text, 0));
  select state.* into state_row from public.program_order_state state
  where state.order_id = target_order_id for update;
  if not found then return false; end if;
  select terms.* into installment from public.program_order_installments terms
  where terms.order_id = target_order_id and terms.installment_number = target_installment_number
  for update;
  if not found then return false; end if;
  select event.* into existing_event from public.program_payment_events event
  where event.provider_event_id = target_provider_event_id;
  if found then
    select marker.* into existing_marker from public.program_refund_markers marker
    where marker.provider_event_id = target_provider_event_id;
    return existing_event.event_kind = 'refund_marker'
      and existing_event.order_id = target_order_id
      and existing_event.installment_number = target_installment_number
      and existing_event.provider_object_type = 'payment_intent'
      and existing_event.provider_object_id = target_payment_intent_id
      and existing_event.provider_charge_id = target_provider_charge_id
      and existing_event.amount_cents = target_amount_cents
      and existing_marker.order_id = target_order_id
      and existing_marker.installment_number = target_installment_number
      and existing_marker.provider_refund_id = target_provider_refund_id
      and existing_marker.provider_payment_intent_id = target_payment_intent_id
      and existing_marker.provider_charge_id = target_provider_charge_id
      and existing_marker.amount_cents = target_amount_cents;
  end if;
  if installment.revision <> target_expected_revision then return false; end if;
  if exists (select 1 from public.program_refund_markers marker
             where marker.provider_refund_id = target_provider_refund_id) then return false; end if;
  select coalesce(sum(marker.amount_cents), 0)::integer + target_amount_cents into refund_total
  from public.program_refund_markers marker
  where marker.order_id = target_order_id and marker.installment_number = target_installment_number;
  if refund_total > installment.due_cents then return false; end if;
  select orders.* into order_row from public.program_orders orders where orders.id = target_order_id;

  begin
    -- Claim the canonical PaymentIntent first, including refund-first events. The charge alias
    -- then has a composite FK to this exact PI/order/installment tuple.
    insert into public.program_payment_intent_claims (payment_intent_id, order_id, installment_number)
    values (target_payment_intent_id, target_order_id, target_installment_number)
    on conflict (payment_intent_id) do nothing;
    if not exists (select 1 from public.program_payment_intent_claims claim
      where claim.payment_intent_id = target_payment_intent_id and claim.order_id = target_order_id
        and claim.installment_number = target_installment_number) then
      raise exception 'PaymentIntent is already bound to a different order or installment' using errcode = '23505';
    end if;
    insert into public.program_provider_object_claims (
      provider, object_type, object_id, canonical_payment_intent_id, order_id, installment_number
    ) values ('stripe', 'charge', target_provider_charge_id, target_payment_intent_id,
              target_order_id, target_installment_number)
    on conflict (provider, object_type, object_id) do nothing;
    if not exists (
      select 1 from public.program_provider_object_claims claim
      where claim.provider = 'stripe' and claim.object_type = 'charge'
        and claim.object_id = target_provider_charge_id
        and claim.canonical_payment_intent_id = target_payment_intent_id
        and claim.order_id = target_order_id and claim.installment_number = target_installment_number
    ) then
      raise exception 'Charge is already bound to a different PaymentIntent or order' using errcode = '23505';
    end if;
    insert into public.program_payment_events (
      provider_event_id, event_kind, order_id, installment_number,
      provider_object_type, provider_object_id, provider_status, provider_charge_id,
      amount_cents, accepted_revision
    ) values (
      target_provider_event_id, 'refund_marker', target_order_id, target_installment_number,
      'payment_intent', target_payment_intent_id, 'refund_marker', target_provider_charge_id,
      target_amount_cents, target_expected_revision + 1
    );
    insert into public.program_refund_markers (
      provider_refund_id, provider_charge_id, provider_payment_intent_id,
      provider_event_id, order_id, installment_number, amount_cents
    ) values (
      target_provider_refund_id, target_provider_charge_id, target_payment_intent_id,
      target_provider_event_id, target_order_id, target_installment_number, target_amount_cents
    );
    update public.program_order_installments terms
    set refund_marker_cents = refund_total, revision = terms.revision + 1, updated_at = now()
    where terms.order_id = target_order_id and terms.installment_number = target_installment_number;

    for row_payment in
      select terms.installment_number, terms.due_cents, terms.net_settled_cents, terms.provider_status
      from public.program_order_installments terms where terms.order_id = target_order_id
      order by terms.installment_number
    loop
      exit when row_payment.installment_number <> cleared + 1
        or row_payment.provider_status <> 'succeeded' or row_payment.net_settled_cents < row_payment.due_cents;
      cleared := cleared + 1;
    end loop;
    update public.program_order_state state
    set billing_state = case
          when state.billing_state in ('cancel_requested', 'canceled', 'closed') then state.billing_state
          when order_row.installment_count > 0 and cleared = order_row.installment_count then 'paid'
          when cleared > 0 then 'active'
          when state.billing_state in ('active', 'paid') then 'awaiting_checkout'
          else state.billing_state
        end,
        revision = state.revision + 1, updated_at = now()
    where state.order_id = target_order_id;
  exception when unique_violation or check_violation or foreign_key_violation then
    return false;
  end;
  return true;
end;
$$;
revoke all on function public.record_program_refund_marker(uuid, smallint, bigint, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.record_program_refund_marker(uuid, smallint, bigint, text, text, text, text, integer)
  to service_role;

create function public.release_program_promotion_reservation(
  target_order_id uuid,
  target_expected_revision bigint,
  target_checkout_session_id text,
  target_terminal_state text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.program_order_state%rowtype;
  order_buyer uuid;
  installment_row record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program promotion reservations are server managed' using errcode = '42501';
  end if;
  if target_expected_revision is null or target_terminal_state is null
     or target_terminal_state not in ('expired', 'complete_unpaid') then return false; end if;
  select orders.buyer_id into order_buyer from public.program_orders orders where orders.id = target_order_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(order_buyer::text, 0));
  -- Match payment/refund order: state first, then installment rows.
  select state.* into state_row from public.program_order_state state
  where state.order_id = target_order_id for update;
  if not found then return false; end if;
  for installment_row in
    select installment.installment_number
    from public.program_order_installments installment
    where installment.order_id = target_order_id
    order by installment.installment_number
    for update
  loop
    null;
  end loop;
  if state_row.revision <> target_expected_revision
     or state_row.checkout_session_id is distinct from target_checkout_session_id
     or target_checkout_session_id is null then return false; end if;
  if exists (select 1 from public.program_order_installments installment
    where installment.order_id = target_order_id and installment.net_settled_cents > 0) then return false; end if;
  if not exists (select 1 from public.program_promotion_reservations reservation
    where reservation.order_id = target_order_id and reservation.state = 'reserved'
      and reservation.checkout_session_id = target_checkout_session_id) then return false; end if;
  update public.program_promotion_reservations reservation
  set state = 'released', revision = revision + 1, updated_at = now()
  where reservation.order_id = target_order_id and reservation.state = 'reserved'
    and reservation.checkout_session_id = target_checkout_session_id;
  update public.program_order_state state
  set billing_state = 'closed', revision = revision + 1, updated_at = now()
  where state.order_id = target_order_id;
  return true;
end;
$$;
revoke all on function public.release_program_promotion_reservation(uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.release_program_promotion_reservation(uuid, bigint, text, text)
  to service_role;

create function private.program_order_lesson_access_for_member(
  target_order_id uuid,
  target_member_id uuid,
  target_eastern_today date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.program_orders%rowtype;
  program_row public.programs%rowtype;
  cleared integer := 0;
  paid_ceiling integer;
  timeline_ceiling integer;
  lesson_ceiling integer;
  row_payment record;
  actual_lesson_count integer;
  state_row public.program_order_state%rowtype;
begin
  if target_order_id is null or target_member_id is null or target_eastern_today is null
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = target_member_id)
     or not private.has_role(target_member_id, 'member'::public.user_role)
     or not private.has_platform_tier(target_member_id, 'regular') then
    return null;
  end if;
  select orders.* into order_row from public.program_orders orders
  where orders.id = target_order_id and orders.buyer_id = target_member_id;
  if not found then return null; end if;
  select program.* into program_row from public.programs program
  where program.id = order_row.program_id and program.published
    and program.platform_owned = order_row.platform_owned
    and (program.platform_owned or (
      program.coach_id = order_row.seller_profile_id and exists (
        select 1 from public.coach_members cm
        where cm.coach_id = program.coach_id and cm.member_id = target_member_id
      )
    ));
  if not found then return null; end if;
  if not exists (
    select 1 from public.program_offer_versions offer
    where offer.program_id = order_row.program_id and offer.id = order_row.offer_version_id
      and offer.offer_kind = 'paid' and offer.content_version_id = order_row.content_version_id
  ) then return null; end if;
  if order_row.zero_total_grant_reason = 'promotion_100_percent' and not exists (
    select 1 from public.program_promotion_redemptions redemption
    where redemption.order_id = target_order_id and redemption.member_id = target_member_id
      and redemption.promotion_id = order_row.promotion_id
  ) then return null; end if;
  select state.* into state_row from public.program_order_state state
  where state.order_id = target_order_id;
  if not found or state_row.access_started_on is null then return null; end if;
  select count(*)::integer into actual_lesson_count
  from public.program_content_version_lessons lesson
  where lesson.program_id = order_row.program_id and lesson.content_version_id = order_row.content_version_id;
  if actual_lesson_count <> order_row.lesson_count then return null; end if;
  if order_row.zero_total_grant_reason = 'promotion_100_percent' then
    paid_ceiling := order_row.lesson_count;
  else
    for row_payment in
      select installment.installment_number, installment.due_cents,
        installment.net_settled_cents, installment.provider_status
      from public.program_order_installments installment
      where installment.order_id = target_order_id
      order by installment.installment_number
    loop
      exit when row_payment.installment_number <> cleared + 1
        or row_payment.provider_status <> 'succeeded'
        or row_payment.net_settled_cents < row_payment.due_cents;
      cleared := cleared + 1;
    end loop;
    paid_ceiling := private.program_paid_lesson_ceiling(
      order_row.lesson_count, order_row.installment_count, cleared
    );
  end if;
  select coalesce(max(lesson.lesson_ordinal), 0)::integer into timeline_ceiling
  from public.program_content_version_lessons lesson
  where lesson.program_id = order_row.program_id
    and lesson.content_version_id = order_row.content_version_id
    and lesson.timeline_day_number <= greatest((target_eastern_today - state_row.access_started_on + 1), 0);
  lesson_ceiling := least(paid_ceiling, timeline_ceiling);
  return jsonb_build_object(
    'order_id', order_row.id,
    'program_id', order_row.program_id,
    'content_version_id', order_row.content_version_id,
    'cleared_installments', cleared,
    'fully_funded', coalesce(order_row.zero_total_grant_reason = 'promotion_100_percent', false)
      or cleared = order_row.installment_count,
    'paid_lesson_ceiling', paid_ceiling,
    'timeline_lesson_ceiling', timeline_ceiling,
    'lesson_ceiling', lesson_ceiling,
    'lesson_ids', coalesce((
      select jsonb_agg(lesson.id order by lesson.lesson_ordinal)
      from public.program_content_version_lessons lesson
      where lesson.program_id = order_row.program_id
        and lesson.content_version_id = order_row.content_version_id
        and lesson.lesson_ordinal <= lesson_ceiling
        and lesson.timeline_day_number <= greatest((target_eastern_today - state_row.access_started_on + 1), 0)
    ), '[]'::jsonb),
    'lesson_ordinals', coalesce((
      select jsonb_agg(lesson.lesson_ordinal order by lesson.lesson_ordinal)
      from public.program_content_version_lessons lesson
      where lesson.program_id = order_row.program_id
        and lesson.content_version_id = order_row.content_version_id
        and lesson.lesson_ordinal <= lesson_ceiling
        and lesson.timeline_day_number <= greatest((target_eastern_today - state_row.access_started_on + 1), 0)
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function private.program_order_lesson_access_for_member(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function private.program_order_lesson_access_for_member(uuid, uuid, date)
  to service_role;

create function public.get_my_program_order_lesson_access(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then return null; end if;
  return private.program_order_lesson_access_for_member(
    target_order_id, auth.uid(), (now() at time zone 'America/New_York')::date
  );
end;
$$;
revoke all on function public.get_my_program_order_lesson_access(uuid) from public, anon;
grant execute on function public.get_my_program_order_lesson_access(uuid) to authenticated;

create function public.get_my_program_order_summaries()
returns table (
  order_id uuid,
  program_id uuid,
  program_title text,
  payment_plan text,
  currency text,
  list_price_cents integer,
  discount_cents integer,
  effective_total_cents integer,
  installment_count smallint,
  cleared_installments smallint,
  lesson_count smallint,
  fully_funded boolean,
  created_at timestamptz,
  billing_state text
)
language sql
stable
security definer
set search_path = ''
as $$
  with own_orders as (
    select orders.*, program.title, state.billing_state
    from public.program_orders orders
    join public.programs program on program.id = orders.program_id
    join public.program_order_state state on state.order_id = orders.id
    where auth.role() = 'authenticated' and orders.buyer_id = auth.uid()
  ), progress as (
    select orders.id,
      (select count(*)::smallint
       from public.program_order_installments paid
       where paid.order_id = orders.id
         and paid.provider_status = 'succeeded' and paid.net_settled_cents = paid.due_cents
         and paid.installment_number < coalesce((
           select min(missing.installment_number)
           from public.program_order_installments missing
           where missing.order_id = orders.id
             and (missing.provider_status <> 'succeeded' or missing.net_settled_cents < missing.due_cents)
         ), orders.installment_count + 1)
      ) as cleared
    from own_orders orders
  )
  select orders.id, orders.program_id, orders.title, orders.payment_plan, orders.currency,
    orders.list_price_cents, orders.discount_cents, orders.effective_total_cents,
    orders.installment_count, progress.cleared, orders.lesson_count,
    (coalesce(orders.zero_total_grant_reason = 'promotion_100_percent', false)
      or progress.cleared = orders.installment_count),
    orders.created_at,
    case orders.billing_state
      when 'awaiting_checkout' then 'awaiting_payment'
      when 'checkout_pending' then 'awaiting_payment'
      when 'active' then 'partially_paid'
      when 'cancel_requested' then 'closed'
      when 'canceled' then 'closed'
      else orders.billing_state
    end
  from own_orders orders join progress on progress.id = orders.id
  order by orders.created_at desc, orders.id;
$$;
revoke all on function public.get_my_program_order_summaries() from public, anon;
grant execute on function public.get_my_program_order_summaries() to authenticated;
