-- GYMX2 platform memberships are separate from coach plans and their Connect fees.
-- Only signed Stripe webhooks or a service-role test grant can write entitlement rows.

create table public.platform_memberships (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('regular', 'premium')),
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  status text not null check (
    status in (
      'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due',
      'paused', 'trialing', 'unpaid'
    )
  ),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  last_event_created bigint,
  last_event_id text,
  state_revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((last_event_created is null) = (last_event_id is null))
);

create index platform_memberships_member_created_idx
  on public.platform_memberships (member_id, created_at desc);
create index platform_memberships_member_status_idx
  on public.platform_memberships (member_id, status, current_period_end desc);
create unique index platform_memberships_one_active_per_member_idx
  on public.platform_memberships (member_id)
  where status = 'active';

create trigger platform_memberships_set_updated_at
before update on public.platform_memberships
for each row execute function public.set_updated_at();

alter table public.platform_memberships enable row level security;
create policy "People can see their own platform memberships"
on public.platform_memberships for select to authenticated
using (member_id = (select auth.uid()) or (select private.is_admin()));
revoke all on public.platform_memberships from public, anon, authenticated;
grant select on public.platform_memberships to authenticated;
grant select, insert, update, delete on public.platform_memberships to service_role;

-- Account deletion leaves a permanent tombstone because an in-flight Stripe Checkout URL may
-- complete after the profile is removed. It intentionally has no profile FK.
create table public.platform_membership_deletion_locks (
  member_id uuid primary key,
  locked_at timestamptz not null default now()
);
alter table public.platform_membership_deletion_locks enable row level security;
revoke all on public.platform_membership_deletion_locks from public, anon, authenticated;
grant select, insert, update, delete on public.platform_membership_deletion_locks to service_role;

create function public.lock_platform_membership_account_for_deletion(
  target_member_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));
  insert into public.platform_membership_deletion_locks (member_id)
  values (target_member_id)
  on conflict (member_id) do nothing;
  return true;
end;
$$;
revoke all on function public.lock_platform_membership_account_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.lock_platform_membership_account_for_deletion(uuid) to service_role;

-- Manual access for explicitly approved QA users has no Stripe identifiers or invoice rows.
-- Rows are append-only grant records; revocation marks a row so the audit trail remains.
create table public.platform_test_entitlements (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('regular', 'premium')),
  source text not null default 'manual_test' check (source = 'manual_test'),
  grant_reason text not null check (char_length(grant_reason) between 1 and 500),
  granted_by uuid not null,
  granted_at timestamptz not null default now(),
  revoked_by uuid,
  revoked_at timestamptz
);

create index platform_test_entitlements_member_idx
  on public.platform_test_entitlements (member_id, granted_at desc);
create unique index platform_test_entitlements_one_active_grant_idx
  on public.platform_test_entitlements (member_id)
  where revoked_at is null;

alter table public.platform_test_entitlements enable row level security;
revoke all on public.platform_test_entitlements from public, anon, authenticated;
grant select, insert, update, delete on public.platform_test_entitlements to service_role;

-- Checkout reservations serialize repeated clicks and let retries reuse Stripe's idempotency key.
create table public.platform_checkout_attempts (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  tier text not null check (tier in ('regular', 'premium')),
  request_id uuid not null unique,
  stripe_session_id text unique,
  stripe_customer_id text,
  customer_email text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.platform_checkout_attempts enable row level security;
revoke all on public.platform_checkout_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.platform_checkout_attempts to service_role;

-- Exposed only to the service role. A profile can have one pending checkout at a time.
create function public.reserve_platform_checkout(
  target_member_id uuid,
  target_tier text,
  target_customer_id text default null,
  target_customer_email text default null
)
returns table (
  outcome text,
  request_id uuid,
  stripe_session_id text,
  expires_at timestamptz,
  existing_tier text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending public.platform_checkout_attempts%rowtype;
  new_request_id uuid;
  new_expiry timestamptz;
begin
  if target_tier not in ('regular', 'premium') then
    raise exception 'Invalid platform tier';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));

  if exists (
    select 1 from public.platform_membership_deletion_locks pdl
    where pdl.member_id = target_member_id
  ) then
    return query select 'account_deleting'::text, null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.platform_memberships pm
    where pm.member_id = target_member_id
      and pm.status not in ('canceled', 'incomplete_expired')
  ) then
    return query select 'subscription_pending'::text, null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  if private.has_platform_tier(target_member_id, target_tier) then
    return query select 'already_entitled'::text, null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  select * into pending
  from public.platform_checkout_attempts pca
  where pca.member_id = target_member_id
  for update;

  if found then
    -- An expired reservation cannot be discarded here: its Stripe session may have completed and
    -- charged while webhook delivery was delayed. The server must retrieve and verify that exact
    -- session, then release this request only after confirming expiry or reconciling completion.
    return query
      select 'pending'::text, pending.request_id, pending.stripe_session_id,
             pending.expires_at, pending.tier;
    return;
  end if;

  new_request_id := gen_random_uuid();
  -- Leave one hour of headroom below Stripe's 24-hour Checkout ceiling so creation latency cannot
  -- produce a session that outlives the reservation that authorizes it.
  new_expiry := now() + interval '23 hours';
  insert into public.platform_checkout_attempts (
    member_id, tier, request_id, stripe_customer_id, customer_email, expires_at
  ) values (
    target_member_id, target_tier, new_request_id, target_customer_id,
    target_customer_email, new_expiry
  );

  return query
    select 'reserved'::text, new_request_id, null::text, new_expiry, target_tier;
end;
$$;

create function public.attach_platform_checkout_session(
  target_member_id uuid,
  target_request_id uuid,
  target_session_id text,
  target_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));
  if exists (
    select 1 from public.platform_membership_deletion_locks pdl
    where pdl.member_id = target_member_id
  ) then
    return false;
  end if;
  update public.platform_checkout_attempts
  set stripe_session_id = target_session_id,
      expires_at = target_expires_at
  where member_id = target_member_id
    and request_id = target_request_id
    and expires_at > now()
    and target_expires_at > now()
    and target_expires_at <= expires_at
    and (stripe_session_id is null or stripe_session_id = target_session_id);
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

create function public.release_platform_checkout_session(target_session_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member_id uuid;
begin
  select pca.member_id into target_member_id
  from public.platform_checkout_attempts pca
  where pca.stripe_session_id = target_session_id;
  if target_member_id is null then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));
  delete from public.platform_checkout_attempts
  where member_id = target_member_id
    and stripe_session_id = target_session_id;
end;
$$;

create function public.release_platform_checkout_attempt(
  target_member_id uuid,
  target_request_id uuid,
  target_session_id text default null,
  target_require_session_match boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));
  delete from public.platform_checkout_attempts
  where member_id = target_member_id
    and request_id = target_request_id
    and (
      not target_require_session_match
      or stripe_session_id is null
      or stripe_session_id = target_session_id
    );
  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

create function public.complete_platform_checkout(target_session_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.platform_checkout_attempts
  where stripe_session_id = target_session_id;
$$;

-- Webhooks and reconciliations both retrieve Stripe's current object, then use a DB revision read
-- before that retrieval as a compare-and-swap. Stripe event.created is audit data only; deliveries
-- can arrive out of order, so an older event that retrieves current state must not be discarded.
create function public.sync_platform_membership(
  target_member_id uuid,
  target_tier text,
  target_subscription_id text,
  target_customer_id text,
  target_price_id text,
  target_status text,
  target_current_period_end timestamptz,
  target_cancel_at_period_end boolean,
  target_event_created bigint,
  target_event_id text,
  target_checkout_request_id uuid,
  target_expected_revision bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_member_id uuid;
  saved_event_created bigint;
  saved_revision bigint;
begin
  if target_tier not in ('regular', 'premium') then
    raise exception 'Invalid platform tier';
  end if;
  if target_status not in (
    'active', 'canceled', 'incomplete', 'incomplete_expired', 'past_due',
    'paused', 'trialing', 'unpaid'
  ) then
    raise exception 'Invalid platform subscription status';
  end if;
  if target_current_period_end is null
    or (target_event_created is null) <> (target_event_id is null)
    or target_event_created < 0
    or target_expected_revision < 0
  then
    raise exception 'Invalid platform subscription state';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_member_id::text, 0));
  if exists (
    select 1 from public.platform_membership_deletion_locks pdl
    where pdl.member_id = target_member_id
  ) or not exists (
    select 1 from public.profiles p where p.id = target_member_id
  ) then
    return 'deleting';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_subscription_id, 1));

  select pm.member_id, pm.last_event_created, pm.state_revision
    into saved_member_id, saved_event_created, saved_revision
  from public.platform_memberships pm
  where pm.stripe_subscription_id = target_subscription_id
  for update;

  if found and saved_member_id <> target_member_id then
    raise exception 'Platform subscription belongs to a different account';
  end if;
  if (found and target_expected_revision is distinct from saved_revision)
    or (not found and target_expected_revision is not null)
  then
    return 'conflict';
  end if;
  insert into public.platform_memberships (
    member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id,
    status, current_period_end, cancel_at_period_end, last_event_created, last_event_id,
    state_revision
  ) values (
    target_member_id, target_tier, target_subscription_id, target_customer_id,
    target_price_id, target_status, target_current_period_end,
    target_cancel_at_period_end, target_event_created, target_event_id, 1
  )
  on conflict (stripe_subscription_id) do update set
    tier = excluded.tier,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_price_id = excluded.stripe_price_id,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    last_event_created = case
      when excluded.last_event_created is null then public.platform_memberships.last_event_created
      when public.platform_memberships.last_event_created is null then excluded.last_event_created
      else greatest(public.platform_memberships.last_event_created, excluded.last_event_created)
    end,
    last_event_id = case
      when excluded.last_event_created is not null
        and (public.platform_memberships.last_event_created is null
          or excluded.last_event_created >= public.platform_memberships.last_event_created)
        then excluded.last_event_id
      else public.platform_memberships.last_event_id
    end,
    state_revision = public.platform_memberships.state_revision + 1,
    updated_at = now()
  where public.platform_memberships.member_id = excluded.member_id;

  if target_checkout_request_id is not null then
    delete from public.platform_checkout_attempts pca
    where pca.member_id = target_member_id
      and pca.request_id = target_checkout_request_id;
  end if;
  return 'applied';
end;
$$;

revoke all on function public.reserve_platform_checkout(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.attach_platform_checkout_session(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.release_platform_checkout_session(text) from public, anon, authenticated;
revoke all on function public.release_platform_checkout_attempt(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.complete_platform_checkout(text) from public, anon, authenticated;
revoke all on function public.sync_platform_membership(uuid, text, text, text, text, text, timestamptz, boolean, bigint, text, uuid, bigint) from public, anon, authenticated;
revoke all on function public.lock_platform_membership_account_for_deletion(uuid) from public, anon, authenticated;
grant execute on function public.reserve_platform_checkout(uuid, text, text, text) to service_role;
grant execute on function public.attach_platform_checkout_session(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.release_platform_checkout_session(text) to service_role;
grant execute on function public.release_platform_checkout_attempt(uuid, uuid, text, boolean) to service_role;
grant execute on function public.complete_platform_checkout(text) to service_role;
grant execute on function public.sync_platform_membership(uuid, text, text, text, text, text, timestamptz, boolean, bigint, text, uuid, bigint) to service_role;
grant execute on function public.lock_platform_membership_account_for_deletion(uuid) to service_role;

create function private.has_platform_tier(target_member_id uuid, minimum_tier text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.role() = 'authenticated'
      and target_member_id is distinct from (select auth.uid())
      and not (select private.is_admin()) then false
    when exists (
      select 1 from public.platform_membership_deletion_locks pdl
      where pdl.member_id = target_member_id
    ) then false
    when minimum_tier = 'regular' then exists (
      select 1
      from public.platform_memberships pm
      where pm.member_id = target_member_id
        and pm.status = 'active'
        and pm.current_period_end > now()
    ) or exists (
      select 1
      from public.platform_test_entitlements pte
      where pte.member_id = target_member_id
        and pte.tier in ('regular', 'premium')
        and pte.revoked_at is null
    )
    when minimum_tier = 'premium' then exists (
      select 1
      from public.platform_memberships pm
      where pm.member_id = target_member_id
        and pm.tier = 'premium'
        and pm.status = 'active'
        and pm.current_period_end > now()
    ) or exists (
      select 1
      from public.platform_test_entitlements pte
      where pte.member_id = target_member_id
        and pte.tier = 'premium'
        and pte.revoked_at is null
    )
    else false
  end;
$$;
revoke all on function private.has_platform_tier(uuid, text) from public;
grant execute on function private.has_platform_tier(uuid, text) to authenticated, service_role;

-- Keep pre-existing Other items intact. New catalog rows use the current categories; premium rows
-- are hidden from non-Premium buyers even when the seller marked them visible to everyone.
alter table public.armory_items
  drop constraint armory_items_category_check;
alter table public.armory_items
  add constraint armory_items_category_check
  check (category in (
    'ebook', 'gear', 'accessories', 'program', 'supplements', 'doctor_network', 'other'
  ));

alter table public.armory_items
  add column made_to_order boolean not null default false,
  add column delivery_min_weeks smallint,
  add column delivery_max_weeks smallint;
alter table public.armory_items
  add constraint armory_items_delivery_window_check
  check (
    (made_to_order
      and delivery_min_weeks is not null
      and delivery_max_weeks is not null
      and delivery_min_weeks between 1 and 52
      and delivery_max_weeks between delivery_min_weeks and 52)
    or (not made_to_order and delivery_min_weeks is null and delivery_max_weeks is null)
  );
grant insert (made_to_order, delivery_min_weeks, delivery_max_weeks)
  on public.armory_items to authenticated;
grant update (made_to_order, delivery_min_weeks, delivery_max_weeks)
  on public.armory_items to authenticated;

drop policy "People can see the Armory items open to them" on public.armory_items;
create policy "People with a platform plan can see eligible Armory items"
on public.armory_items for select to authenticated
using (
  coach_id = (select auth.uid())
  or (
    ((select private.is_admin()) or visible_to_all or exists (
      select 1 from public.coach_members cm
      where cm.coach_id = armory_items.coach_id
        and cm.member_id = (select auth.uid())
    ))
    and (
      not (select private.has_role((select auth.uid()), 'member'))
      or (select private.has_platform_tier((select auth.uid()), 'regular'))
    )
    and (
      category not in ('supplements', 'doctor_network')
      or (select private.has_platform_tier((select auth.uid()), 'premium'))
    )
    and (
      category <> 'other'
      or (select private.is_admin())
    )
  )
  -- A prior, unrefunded paid download remains accessible after a platform plan ends.
  or (
    kind = 'paid'
    and exists (
      select 1 from public.purchases p
      where p.item_id = armory_items.id
        and p.member_id = (select auth.uid())
        and p.refunded_at is null
    )
  )
);
