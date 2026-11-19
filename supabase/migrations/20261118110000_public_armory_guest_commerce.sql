-- Public Armory projection, server-owned Checkout snapshots, and guest paid-download claims.
-- All payment/fulfillment writes remain service-only; the public view exposes only listed items.

alter table public.armory_items
  add column printful_sku text,
  add column printful_sync_variant_id text,
  add column printful_variant_mappings jsonb not null default '[]'::jsonb;

-- Preview rows were an intentionally separate, not-for-sale kind in a pending migration. Support
-- that kind directly on the current pre-preview host shape without applying or recording the
-- unrelated historical migration.
alter table public.armory_items drop constraint armory_items_kind_check;
alter table public.armory_items add constraint armory_items_kind_check
  check (kind in ('link', 'download', 'paid', 'product', 'preview'));
alter table public.armory_items drop constraint armory_items_gear_ships;
alter table public.armory_items add constraint armory_items_gear_ships
  check (category <> 'gear' or kind in ('link', 'product', 'preview'));
alter table public.armory_items drop constraint if exists armory_items_preview_check;
alter table public.armory_items add constraint armory_items_preview_check
  check (
    kind <> 'preview'
    or (
      price_cents is not null
      and price_cents between 100 and 10000000
      and file_path is null
      and file_name is null
      and buy_url is null
    )
  );

create function private.valid_armory_printful_mappings(target jsonb, allowed_options text[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  mapping jsonb;
  mapping_option text;
  mapping_sku text;
  mapping_variant text;
  seen text[] := array[]::text[];
begin
  if target is null or jsonb_typeof(target) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(target) > 100 then return false; end if;

  for mapping in select value from jsonb_array_elements(target) as entries(value) loop
    if jsonb_typeof(mapping) <> 'object' then return false; end if;
    if jsonb_typeof(mapping -> 'option') is distinct from 'string'
      or jsonb_typeof(mapping -> 'sku') is distinct from 'string'
      or (
        mapping ? 'sync_variant_id'
        and jsonb_typeof(mapping -> 'sync_variant_id') not in ('string', 'null')
      )
    then
      return false;
    end if;
    mapping_option := nullif(btrim(mapping ->> 'option'), '');
    mapping_sku := nullif(btrim(mapping ->> 'sku'), '');
    mapping_variant := nullif(btrim(mapping ->> 'sync_variant_id'), '');
    if mapping_option is null or char_length(mapping_option) > 20
      or mapping_sku is null or char_length(mapping_sku) > 128
      or not (mapping_option = any(coalesce(allowed_options, array[]::text[])))
      or mapping_option <> coalesce(mapping ->> 'option', '')
      or mapping_sku <> coalesce(mapping ->> 'sku', '')
      or lower(mapping_option) = any(seen)
    then
      return false;
    end if;
    if mapping_variant is not null then
      if mapping_variant !~ '^[0-9]{1,19}$' then return false; end if;
      if mapping_variant::numeric < 1 or mapping_variant::numeric > 9223372036854775807 then return false; end if;
    end if;
    seen := array_append(seen, lower(mapping_option));
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_armory_printful_mappings(jsonb, text[]) from public, anon, authenticated;
grant execute on function private.valid_armory_printful_mappings(jsonb, text[]) to authenticated, service_role;

alter table public.armory_items
  add constraint armory_items_printful_sku_check
    check (printful_sku is null or (printful_sku = btrim(printful_sku) and char_length(printful_sku) between 1 and 128)),
  add constraint armory_items_printful_sync_variant_check
    check (printful_sync_variant_id is null or (
      printful_sync_variant_id ~ '^[0-9]{1,19}$'
      and printful_sync_variant_id::numeric between 1 and 9223372036854775807
    )),
  add constraint armory_items_printful_mapping_shape_check
    check (private.valid_armory_printful_mappings(printful_variant_mappings, sizes)),
  add constraint armory_items_printful_product_only_check
    check (
      (kind in ('product', 'preview') and category in ('gear', 'accessories'))
      or (printful_sku is null and printful_sync_variant_id is null and printful_variant_mappings = '[]'::jsonb)
    ),
  add constraint armory_items_printful_size_mapping_check
    check (
      (cardinality(sizes) = 0 and printful_variant_mappings = '[]'::jsonb)
      or (
        cardinality(sizes) > 0
        and (
          (printful_variant_mappings = '[]'::jsonb and printful_sku is null and printful_sync_variant_id is null)
          or (
            printful_variant_mappings <> '[]'::jsonb
            and printful_sku is null and printful_sync_variant_id is null
            and jsonb_array_length(printful_variant_mappings) = cardinality(sizes)
          )
        )
      )
    );

grant insert (printful_sku, printful_sync_variant_id, printful_variant_mappings)
  on public.armory_items to authenticated;
grant update (printful_sku, printful_sync_variant_id, printful_variant_mappings)
  on public.armory_items to authenticated;

-- Checkout uses a service-only snapshot query before the intent RPC. Keep this grant column-scoped
-- so browser roles still read only the public catalog projection.
grant select (
  id, coach_id, kind, category, title, price_cents, file_path, file_name, sizes,
  shipping_cents, visible_to_all, printful_sku, printful_sync_variant_id,
  printful_variant_mappings, updated_at
) on public.armory_items to service_role;

-- Anonymous readers receive a strict projection. Hidden inventory, legacy rows, Premium rows,
-- free downloads, private file paths, and fulfillment/provider identifiers never appear here.
create view public.public_armory_catalog
with (security_barrier = true)
as
select
  item.id,
  item.coach_id,
  case
    when seller.role::text = 'admin' then 'GYMX2'
    when public_profile.coach_id is not null then seller.display_name
    else 'Coach'
  end as seller_label,
  item.kind,
  item.category,
  item.title,
  item.description,
  item.price_cents,
  item.buy_url,
  item.sizes,
  item.shipping_cents,
  item.image_path,
  item.made_to_order,
  item.delivery_min_weeks,
  item.delivery_max_weeks,
  item.created_at
from public.armory_items as item
join public.profiles as seller on seller.id = item.coach_id
left join public.coach_profiles_public as public_profile on public_profile.coach_id = item.coach_id
where item.visible_to_all
  and item.category in ('ebook', 'gear', 'accessories', 'program')
  and item.kind in ('link', 'paid', 'product', 'preview')
  and (
    item.kind in ('link', 'preview')
    or (item.price_cents is not null and item.price_cents >= 100)
  );
revoke all on public.public_armory_catalog from public, anon, authenticated;
grant select on public.public_armory_catalog to anon, authenticated;

-- Private immutable snapshots let the webhook verify what the server offered even if the item
-- changes while Checkout is open. They are never readable or writable from a browser session.
create table public.armory_checkout_intents (
  id uuid primary key,
  item_id uuid not null,
  member_id uuid references public.profiles (id) on delete set null,
  guest_email text,
  seller_id uuid,
  item_title text not null check (char_length(item_title) between 1 and 120),
  item_kind text not null check (item_kind in ('paid', 'product')),
  item_category text not null check (item_category in (
    'ebook', 'gear', 'accessories', 'program', 'supplements', 'doctor_network', 'other'
  )),
  locale text not null default 'en' check (locale in ('en', 'es')),
  price_cents integer not null check (price_cents between 100 and 10000000),
  shipping_cents integer not null default 0 check (shipping_cents between 0 and 100000),
  fee_cents integer not null check (fee_cents between 0 and 10100000),
  currency text not null default 'usd' check (currency = 'usd'),
  size text check (char_length(size) <= 40),
  buyer_was_guest boolean not null default false,
  file_path text,
  file_name text,
  printful_sku text check (printful_sku is null or char_length(printful_sku) between 1 and 128),
  printful_sync_variant_id text check (printful_sync_variant_id is null or (
    printful_sync_variant_id ~ '^[0-9]{1,19}$'
    and printful_sync_variant_id::numeric between 1 and 9223372036854775807
  )),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'failed')),
  guest_confirmation_sent_at timestamptz,
  guest_confirmation_claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (buyer_was_guest and member_id is null and guest_email is not null)
    or (not buyer_was_guest and guest_email is null)
  ),
  check (guest_email is null or (guest_email = lower(btrim(guest_email)) and char_length(guest_email) between 3 and 320)),
  check ((file_path is null) = (file_name is null)),
  check (item_kind = 'paid' or (file_path is null and file_name is null)),
  check (not buyer_was_guest or item_category in ('ebook', 'gear', 'accessories', 'program')),
  check ((item_kind = 'product') or (shipping_cents = 0 and size is null and printful_sku is null and printful_sync_variant_id is null))
);
create unique index armory_checkout_intents_session_idx
  on public.armory_checkout_intents (stripe_session_id)
  where stripe_session_id is not null;
create index armory_checkout_intents_created_idx
  on public.armory_checkout_intents (created_at desc);
alter table public.armory_checkout_intents enable row level security;
revoke all on public.armory_checkout_intents from public, anon, authenticated;
grant select, insert, update, delete on public.armory_checkout_intents to service_role;

-- The item lock serializes checkout snapshot creation with seller edits/deletes. A stale quote
-- fails before Stripe is called; a successful insert is visible to file-retention checks before
-- the seller can replace or remove the item file.
create function public.create_armory_checkout_intent(
  target_intent_id uuid,
  target_item_id uuid,
  target_member_id uuid,
  target_guest_email text,
  target_locale text,
  target_size text,
  target_fee_cents integer,
  target_item_updated_at timestamptz,
  target_item_price_cents integer,
  target_item_shipping_cents integer,
  target_item_title text,
  target_item_kind text,
  target_item_category text,
  target_file_path text,
  target_file_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_item public.armory_items%rowtype;
  buyer_role text;
  expected_shipping integer;
  expected_fee integer;
  selected_printful_sku text;
  selected_sync_variant_id text;
begin
  if target_intent_id is null or target_item_id is null
    or target_locale is null or target_locale not in ('en', 'es')
    or target_item_updated_at is null
  then
    return false;
  end if;

  select item.* into locked_item
  from public.armory_items as item
  where item.id = target_item_id
  for update;
  if not found then return false; end if;

  expected_shipping := case when locked_item.kind = 'product' then locked_item.shipping_cents else 0 end;
  if locked_item.updated_at is distinct from target_item_updated_at
    or locked_item.price_cents is distinct from target_item_price_cents
    or expected_shipping is distinct from target_item_shipping_cents
    or locked_item.title is distinct from target_item_title
    or locked_item.kind is distinct from target_item_kind
    or locked_item.category is distinct from target_item_category
    or locked_item.file_path is distinct from target_file_path
    or locked_item.file_name is distinct from target_file_name
    or locked_item.kind not in ('paid', 'product')
    or locked_item.price_cents is null
    or locked_item.price_cents < 100
    or target_fee_cents is null
  then
    return false;
  end if;

  if target_member_id is null then
    if not locked_item.visible_to_all
      or locked_item.category not in ('ebook', 'gear', 'accessories', 'program')
      or nullif(lower(btrim(coalesce(target_guest_email, ''))), '') is null
      or char_length(btrim(target_guest_email)) not between 3 and 320
      or position('@' in btrim(target_guest_email)) < 2
      or position('.' in split_part(btrim(target_guest_email), '@', 2)) < 2
    then
      return false;
    end if;
  else
    if target_guest_email is not null then return false; end if;
    select profile.role into buyer_role
    from public.profiles as profile
    where profile.id = target_member_id;
    if not found or locked_item.coach_id = target_member_id then return false; end if;
    if not locked_item.visible_to_all
      and buyer_role <> 'admin'
      and not exists (
        select 1
        from public.coach_members as link
        where link.coach_id = locked_item.coach_id
          and link.member_id = target_member_id
      )
    then
      return false;
    end if;
    if locked_item.category in ('supplements', 'doctor_network')
      and not private.has_platform_tier(target_member_id, 'premium')
    then
      return false;
    end if;
  end if;

  if cardinality(locked_item.sizes) = 0 then
    if target_size is not null then return false; end if;
  elsif target_size is null or not (target_size = any(locked_item.sizes)) then
    return false;
  end if;

  if locked_item.kind = 'product' then
    if cardinality(locked_item.sizes) = 0 then
      selected_printful_sku := locked_item.printful_sku;
      selected_sync_variant_id := locked_item.printful_sync_variant_id;
    elsif locked_item.printful_variant_mappings <> '[]'::jsonb then
      select mapping.value ->> 'sku', nullif(mapping.value ->> 'sync_variant_id', '')
      into selected_printful_sku, selected_sync_variant_id
      from jsonb_array_elements(locked_item.printful_variant_mappings) as mapping(value)
      where mapping.value ->> 'option' = target_size
      limit 1;
      if selected_printful_sku is null then return false; end if;
    end if;
  end if;

  select case
    when seller.role = 'admin' then locked_item.price_cents + expected_shipping
    else round(locked_item.price_cents::numeric * 0.10)::integer
  end into expected_fee
  from public.profiles as seller
  where seller.id = locked_item.coach_id;
  if not found or target_fee_cents is distinct from expected_fee then return false; end if;

  insert into public.armory_checkout_intents (
    id, item_id, member_id, guest_email, seller_id, item_title, item_kind, item_category,
    locale, price_cents, shipping_cents, fee_cents, currency, size, buyer_was_guest,
    file_path, file_name, printful_sku, printful_sync_variant_id
  ) values (
    target_intent_id, locked_item.id, target_member_id,
    case when target_member_id is null then lower(btrim(target_guest_email)) else null end,
    locked_item.coach_id, locked_item.title, locked_item.kind, locked_item.category,
    target_locale, locked_item.price_cents, expected_shipping, expected_fee, 'usd', target_size,
    target_member_id is null,
    case when locked_item.kind = 'paid' then locked_item.file_path else null end,
    case when locked_item.kind = 'paid' then locked_item.file_name else null end,
    selected_printful_sku, selected_sync_variant_id
  );
  return true;
end;
$$;
revoke all on function public.create_armory_checkout_intent(
  uuid, uuid, uuid, text, text, text, integer, timestamptz, integer, integer, text, text,
  text, text, text
) from public, anon, authenticated;
grant execute on function public.create_armory_checkout_intent(
  uuid, uuid, uuid, text, text, text, integer, timestamptz, integer, integer, text, text,
  text, text, text
) to service_role;

alter table public.purchases
  add column checkout_intent_id uuid,
  add column item_category text,
  add column printful_sku text,
  add column printful_sync_variant_id text,
  add constraint purchases_checkout_intent_id_fkey
    foreign key (checkout_intent_id)
    references public.armory_checkout_intents (id)
    on delete restrict;
alter table public.purchases
  add constraint purchases_printful_snapshot_check
    check (
      (printful_sku is null or char_length(printful_sku) between 1 and 128)
      and (printful_sync_variant_id is null or (
        printful_sync_variant_id ~ '^[0-9]{1,19}$'
        and printful_sync_variant_id::numeric between 1 and 9223372036854775807
      ))
    );
create unique index purchases_checkout_intent_idx
  on public.purchases (checkout_intent_id)
  where checkout_intent_id is not null;
grant select, insert, update on public.purchases to service_role;

-- A refund marker survives a charge.refunded webhook that arrives before checkout.session.completed.
-- The shared transaction lock serializes the marker with order creation for the same PaymentIntent.
create table public.armory_payment_refunds (
  stripe_payment_intent_id text primary key,
  stripe_charge_id text not null,
  refunded_at timestamptz not null default now()
);
alter table public.armory_payment_refunds enable row level security;
revoke all on public.armory_payment_refunds from public, anon, authenticated;
grant select, insert on public.armory_payment_refunds to service_role;

-- The signed Checkout response or signed Stripe webhook may bind first. The unique session ID
-- and null-or-same predicate make a lost response safe to reconcile without replacing a session.
create function public.bind_armory_checkout_session(target_intent_id uuid, target_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_intent_id is null or nullif(target_session_id, '') is null then
    return false;
  end if;
  update public.armory_checkout_intents
  set stripe_session_id = target_session_id, updated_at = now()
  where id = target_intent_id
    and (stripe_session_id is null or stripe_session_id = target_session_id);
  return found;
end;
$$;
revoke all on function public.bind_armory_checkout_session(uuid, text) from public, anon, authenticated;
grant execute on function public.bind_armory_checkout_session(uuid, text) to service_role;

create function public.record_armory_checkout_purchase(
  target_intent_id uuid,
  target_session_id text,
  target_payment_intent_id text,
  target_amount_cents integer,
  target_shipping_cents integer,
  target_currency text,
  target_guest_email text,
  target_shipping_name text,
  target_shipping_address jsonb
)
returns table (purchase_id uuid, inserted boolean, refunded boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  intent public.armory_checkout_intents%rowtype;
  refund_time timestamptz;
  purchase_row public.purchases%rowtype;
  expected_shipping integer;
  live_item_id uuid;
begin
  if target_intent_id is null or nullif(target_session_id, '') is null
    or nullif(target_payment_intent_id, '') is null
    or target_currency is distinct from 'usd'
    or target_amount_cents is null or target_amount_cents < 0
    or target_shipping_cents is null
  then
    return;
  end if;

  select * into intent
  from public.armory_checkout_intents as candidate
  where candidate.id = target_intent_id
    and candidate.stripe_session_id = target_session_id
  for update;
  if not found then return; end if;
  expected_shipping := case when intent.item_kind = 'product' then intent.shipping_cents else 0 end;
  if target_shipping_cents is distinct from expected_shipping
    or target_amount_cents is distinct from intent.price_cents + expected_shipping
    or (intent.buyer_was_guest and lower(btrim(coalesce(target_guest_email, ''))) is distinct from intent.guest_email)
    or (not intent.buyer_was_guest and target_guest_email is not null)
  then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('gymx2-armory-pi:' || target_payment_intent_id, 1));

  select marker.refunded_at into refund_time
  from public.armory_payment_refunds as marker
  where marker.stripe_payment_intent_id = target_payment_intent_id;

  select * into purchase_row
  from public.purchases as existing
  where existing.stripe_session_id = target_session_id
  for update;
  if found then
    return query select purchase_row.id, false, purchase_row.refunded_at is not null;
    return;
  end if;

  -- Preserve the immutable intent identity even when the catalog item was deleted while
  -- Checkout was open. Lock a still-live catalog row so deletion cannot race the FK insert;
  -- a later delete can then null purchases.item_id without affecting the linked intent.
  select item.id into live_item_id
  from public.armory_items as item
  where item.id = intent.item_id
  for key share;
  if not found then live_item_id := null; end if;

  insert into public.purchases (
    item_id, member_id, seller_id, item_title, amount_cents, fee_cents, currency,
    stripe_session_id, size, shipping_cents, shipping_name, shipping_address,
    fulfillment_status, refunded_at, checkout_intent_id, item_category,
    printful_sku, printful_sync_variant_id
  ) values (
    live_item_id, intent.member_id, intent.seller_id, intent.item_title,
    target_amount_cents, intent.fee_cents, 'usd', target_session_id,
    intent.size, expected_shipping,
    case when intent.item_kind = 'product' then left(target_shipping_name, 200) else null end,
    case when intent.item_kind = 'product' then target_shipping_address else null end,
    case
      when intent.item_kind = 'product' and refund_time is not null then 'cancelled'
      when intent.item_kind = 'product' then 'to_ship'
      else 'not_needed'
    end,
    refund_time,
    intent.id, intent.item_category,
    intent.printful_sku, intent.printful_sync_variant_id
  ) returning * into purchase_row;

  update public.armory_checkout_intents
  set status = 'paid', stripe_payment_intent_id = target_payment_intent_id, updated_at = now()
  where id = intent.id;

  return query select purchase_row.id, true, purchase_row.refunded_at is not null;
end;
$$;

create function public.mark_armory_payment_refunded(
  target_payment_intent_id text,
  target_charge_id text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_purchase_id uuid;
begin
  if nullif(target_payment_intent_id, '') is null or nullif(target_charge_id, '') is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('gymx2-armory-pi:' || target_payment_intent_id, 1));
  insert into public.armory_payment_refunds (stripe_payment_intent_id, stripe_charge_id)
  values (target_payment_intent_id, target_charge_id)
  on conflict (stripe_payment_intent_id) do nothing;
  select p.id into first_purchase_id
  from public.purchases as p
  join public.armory_checkout_intents as intent on intent.id = p.checkout_intent_id
  where intent.stripe_payment_intent_id = target_payment_intent_id
  order by p.created_at
  limit 1;
  return first_purchase_id;
end;
$$;

revoke all on function public.record_armory_checkout_purchase(uuid, text, text, integer, integer, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.mark_armory_payment_refunded(text, text) from public, anon, authenticated;
grant execute on function public.record_armory_checkout_purchase(uuid, text, text, integer, integer, text, text, text, jsonb) to service_role;
grant execute on function public.mark_armory_payment_refunded(text, text) to service_role;

create function public.claim_armory_guest_confirmation(target_purchase_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.armory_checkout_intents as intent
  set guest_confirmation_claimed_at = now()
  where intent.id = (
      select purchase.checkout_intent_id
      from public.purchases as purchase
      where purchase.id = target_purchase_id
        and purchase.refunded_at is null
    )
    and intent.buyer_was_guest
    and intent.member_id is null
    and intent.guest_email is not null
    and intent.status = 'paid'
    and intent.guest_confirmation_sent_at is null
    and (
      intent.guest_confirmation_claimed_at is null
      or intent.guest_confirmation_claimed_at < now() - interval '10 minutes'
    );
  return found;
end;
$$;

create function public.finish_armory_guest_confirmation(target_purchase_id uuid, sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.armory_checkout_intents as intent
  set guest_confirmation_sent_at = case when sent then now() else null end,
      guest_confirmation_claimed_at = null
  where intent.id = (
      select purchase.checkout_intent_id
      from public.purchases as purchase
      where purchase.id = target_purchase_id
    )
    and intent.guest_confirmation_claimed_at is not null;
$$;

revoke all on function public.claim_armory_guest_confirmation(uuid) from public, anon, authenticated;
revoke all on function public.finish_armory_guest_confirmation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_armory_guest_confirmation(uuid) to service_role;
grant execute on function public.finish_armory_guest_confirmation(uuid, boolean) to service_role;

