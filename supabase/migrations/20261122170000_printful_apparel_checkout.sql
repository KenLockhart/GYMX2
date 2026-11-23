-- Separate, guest-capable Printful apparel commerce. Existing managed Armory
-- identities stay display-only previews and retain their checkout fence.

create table private.printful_apparel_sales_state (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'legacy_manual'
    check (mode in ('legacy_manual', 'cutover', 'printful_apparel_only')),
  sales_enabled boolean not null default false,
  fulfillment_enabled boolean not null default false,
  refund_policy text check (refund_policy is null or refund_policy = 'admin_review'),
  changed_by uuid,
  updated_at timestamptz not null default now(),
  check (not sales_enabled or (mode = 'printful_apparel_only' and fulfillment_enabled and refund_policy is not null))
);
insert into private.printful_apparel_sales_state (singleton) values (true);

create table private.printful_apparel_products (
  product_id uuid primary key references private.printful_catalog_products(id) on delete restrict,
  item_id uuid not null unique references private.printful_managed_items(item_id) on delete restrict,
  classification text not null default 'unclassified'
    check (classification in ('unclassified', 'apparel')),
  enabled boolean not null default false,
  approval_version bigint not null default 1 check (approval_version > 0),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((enabled and classification = 'apparel' and approved_by is not null and approved_at is not null)
      or not enabled)
);

create table private.printful_apparel_approved_variants (
  product_id uuid not null references private.printful_apparel_products(product_id) on delete cascade,
  variant_id uuid not null references private.printful_catalog_variants(id) on delete restrict,
  approval_version bigint not null check (approval_version > 0),
  store_id text not null check (store_id = '19050731'),
  external_product_id text not null check (private.valid_printful_catalog_id(external_product_id)),
  sync_variant_id text not null check (private.valid_printful_catalog_id(sync_variant_id)),
  provider_external_variant_id text not null check (char_length(provider_external_variant_id) between 1 and 128),
  catalog_variant_id text not null check (private.valid_printful_catalog_id(catalog_variant_id)),
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  production_cost_cents integer not null check (production_cost_cents between 0 and 10000000),
  production_cost_observed_at timestamptz not null,
  production_cost_evidence_sha256 text not null check (production_cost_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  primary key (product_id, variant_id),
  unique (store_id, sync_variant_id)
);

create table private.printful_apparel_orders (
  id uuid primary key,
  store_id text not null default '19050731' check (store_id = '19050731'),
  product_id uuid not null references private.printful_catalog_products(id) on delete restrict,
  item_id uuid not null references private.printful_managed_items(item_id) on delete restrict,
  variant_id uuid not null references private.printful_catalog_variants(id) on delete restrict,
  approval_version bigint not null check (approval_version > 0),
  catalog_revision bigint not null check (catalog_revision > 0),
  external_product_id text not null check (private.valid_printful_catalog_id(external_product_id)),
  sync_variant_id text not null check (private.valid_printful_catalog_id(sync_variant_id)),
  provider_external_variant_id text not null check (char_length(provider_external_variant_id) between 1 and 128),
  catalog_variant_id text not null check (private.valid_printful_catalog_id(catalog_variant_id)),
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  design_identity_fingerprint text not null check (design_identity_fingerprint ~ '^[0-9a-f]{64}$'),
  item_title text not null check (char_length(item_title) between 1 and 120),
  variant_label text not null check (char_length(variant_label) between 1 and 200),
  variant_color text check (variant_color is null or char_length(variant_color) <= 80),
  variant_size text check (variant_size is null or char_length(variant_size) <= 80),
  quantity smallint not null default 1 check (quantity = 1),
  guest_email text not null check (guest_email = lower(btrim(guest_email)) and char_length(guest_email) between 3 and 320),
  quoted_address jsonb not null check (jsonb_typeof(quoted_address) = 'object'),
  final_stripe_address jsonb check (final_stripe_address is null or jsonb_typeof(final_stripe_address) = 'object'),
  quote_address_sha256 text not null check (quote_address_sha256 ~ '^[0-9a-f]{64}$'),
  status_token_sha256 text not null check (status_token_sha256 ~ '^[0-9a-f]{64}$'),
  status_token_expires_at timestamptz not null,
  customer_price_cents integer not null check (customer_price_cents between 100 and 10000000),
  customer_shipping_cents integer not null default 0 check (customer_shipping_cents = 0),
  currency text not null default 'usd' check (currency = 'usd'),
  quote_source text not null default 'printful-order-estimate' check (quote_source = 'printful-order-estimate'),
  quote_currency text not null check (quote_currency = 'USD'),
  quote_subtotal_cents integer not null check (quote_subtotal_cents between 0 and 100000000),
  quote_discount_cents integer not null check (quote_discount_cents between 0 and 100000000),
  quote_shipping_cents integer not null check (quote_shipping_cents between 0 and 100000000),
  quote_tax_cents integer not null check (quote_tax_cents between 0 and 100000000),
  quote_vat_cents integer not null check (quote_vat_cents between 0 and 100000000),
  quote_additional_fee_cents integer not null check (quote_additional_fee_cents between 0 and 100000000),
  quote_fulfillment_fee_cents integer not null check (quote_fulfillment_fee_cents between 0 and 100000000),
  quote_digitization_cents integer not null check (quote_digitization_cents between 0 and 100000000),
  quote_total_cents integer not null check (quote_total_cents between 1 and 100000000),
  quote_cost_facts_complete boolean not null check (quote_cost_facts_complete),
  quote_created_at timestamptz not null,
  quote_expires_at timestamptz not null,
  final_quote_currency text check (final_quote_currency is null or final_quote_currency = 'USD'),
  final_quote_source text check (final_quote_source is null or final_quote_source = 'printful-order-estimate'),
  final_quote_subtotal_cents integer check (final_quote_subtotal_cents between 0 and 100000000),
  final_quote_discount_cents integer check (final_quote_discount_cents between 0 and 100000000),
  final_quote_shipping_cents integer check (final_quote_shipping_cents between 0 and 100000000),
  final_quote_tax_cents integer check (final_quote_tax_cents between 0 and 100000000),
  final_quote_vat_cents integer check (final_quote_vat_cents between 0 and 100000000),
  final_quote_additional_fee_cents integer check (final_quote_additional_fee_cents between 0 and 100000000),
  final_quote_fulfillment_fee_cents integer check (final_quote_fulfillment_fee_cents between 0 and 100000000),
  final_quote_digitization_cents integer check (final_quote_digitization_cents between 0 and 100000000),
  final_quote_total_cents integer check (final_quote_total_cents between 1 and 100000000),
  final_quote_cost_facts_complete boolean not null default false,
  final_quote_created_at timestamptz,
  stripe_session_id text unique,
  stripe_session_expires_at timestamptz not null default (now() + interval '40 minutes'),
  stripe_payment_intent_id text unique,
  stripe_event_id text,
  stripe_paid_cents integer check (stripe_paid_cents between 1 and 100000000),
  stripe_net_revenue_cents integer check (stripe_net_revenue_cents between 0 and 100000000),
  stripe_livemode boolean,
  provider_external_id text not null unique check (provider_external_id ~ '^[0-9a-f]{32}$'),
  provider_order_id text check (provider_order_id is null or private.valid_printful_catalog_id(provider_order_id)),
  provider_status text check (provider_status is null or char_length(provider_status) <= 40),
  provider_shipments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(provider_shipments) = 'array' and jsonb_array_length(provider_shipments) <= 20),
  provider_cost_exception_code text check (provider_cost_exception_code is null or provider_cost_exception_code in (
    'provider_cost_facts_unverified','provider_cost_changed','provider_cost_above_cap','provider_cost_above_net'
  )),
  status text not null default 'quoted' check (status in (
    'quoted', 'checkout_open', 'checkout_expired', 'paid_waiting_net', 'paid_waiting_address_quote',
    'queued', 'leased', 'create_unknown', 'draft_created', 'quote_pending', 'confirm_unknown',
    'confirmed', 'partial', 'fulfilled', 'definitive_unfulfilled', 'refund_pending', 'refunded',
    'test_mode_blocked', 'late_paid_blocked', 'resolution_hold'
  )),
  last_safe_error_code text check (last_safe_error_code is null or char_length(last_safe_error_code) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((stripe_session_id is null and status = 'quoted') or stripe_session_id is not null or status <> 'checkout_open'),
  check (stripe_payment_intent_id is null or stripe_paid_cents is not null),
  check ((final_quote_total_cents is null) = (final_quote_currency is null)),
  check ((final_quote_total_cents is null) = (final_quote_source is null)),
  check (final_quote_cost_facts_complete = false or final_quote_total_cents is not null),
  check (quote_total_cents > 0),
  check (final_quote_total_cents is null or final_quote_total_cents > 0)
);
create index printful_apparel_orders_status_idx on private.printful_apparel_orders (status, created_at);
create index printful_apparel_orders_product_idx on private.printful_apparel_orders (product_id, created_at desc);

create table private.printful_apparel_fulfillment_outbox (
  order_id uuid primary key references private.printful_apparel_orders(id) on delete restrict,
  status text not null default 'awaiting_payment' check (status in (
    'awaiting_payment', 'awaiting_net', 'awaiting_address_quote', 'queued', 'leased',
    'create_unknown', 'draft_created', 'quote_pending', 'confirm_unknown', 'confirmed',
    'partial', 'fulfilled', 'definitive_unfulfilled', 'refund_pending', 'refunded', 'test_mode_blocked', 'resolution_hold'
  )),
  attempts integer not null default 0 check (attempts between 0 and 1000),
  lease_owner uuid,
  lease_generation bigint not null default 0 check (lease_generation >= 0),
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lease_owner is null) = (lease_expires_at is null))
);
create index printful_apparel_outbox_ready_idx on private.printful_apparel_fulfillment_outbox (next_attempt_at, order_id)
  where status in ('awaiting_net', 'awaiting_address_quote', 'queued', 'create_unknown', 'draft_created', 'quote_pending', 'confirm_unknown', 'confirmed', 'partial');

create table private.printful_apparel_action_ledger (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.printful_apparel_orders(id) on delete restrict,
  action_key text not null check (char_length(action_key) between 1 and 120),
  lease_generation bigint not null check (lease_generation > 0),
  action_kind text not null check (action_kind in ('estimate', 'create', 'reconcile', 'confirm', 'cancel', 'refund', 'status_poll')),
  state text not null check (state in ('started', 'succeeded', 'unknown', 'failed')),
  provider_order_id text check (provider_order_id is null or private.valid_printful_catalog_id(provider_order_id)),
  safe_result_code text check (safe_result_code is null or char_length(safe_result_code) <= 64),
  request_sha256 text check (request_sha256 is null or request_sha256 ~ '^[0-9a-f]{64}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (order_id, action_key),
  check ((state = 'started' and finished_at is null) or (state <> 'started' and finished_at is not null))
);

-- A signed Stripe refund/dispute can arrive before the paid Checkout event has
-- bound its PaymentIntent. Retain that risk fact by the private order identity so
-- a delayed paid/net event cannot make fulfillment eligible again.
create table private.printful_apparel_payment_risk_holds (
  event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9_]{8,240}$'),
  order_id uuid not null references private.printful_apparel_orders(id) on delete restrict,
  stripe_session_id text not null check (stripe_session_id ~ '^cs_[A-Za-z0-9_]{8,240}$'),
  stripe_payment_intent_id text not null check (stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]{8,240}$'),
  risk_type text not null check (risk_type in ('refund','dispute')),
  created_at timestamptz not null default now()
);
create index printful_apparel_payment_risk_order_idx
  on private.printful_apparel_payment_risk_holds (order_id, stripe_payment_intent_id);

create table private.printful_apparel_legacy_payment_resolutions (
  id uuid primary key default gen_random_uuid(),
  checkout_intent_id uuid,
  stripe_session_id text not null unique,
  stripe_payment_intent_id text unique,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency = 'usd'),
  reason_code text not null check (reason_code in ('physical_paid_after_auto_only_cutover', 'legacy_physical_without_intent')),
  status text not null default 'resolution_hold' check (status in ('resolution_hold', 'refund_pending', 'refunded', 'closed')),
  last_safe_error_code text check (last_safe_error_code is null or char_length(last_safe_error_code) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on private.printful_apparel_sales_state, private.printful_apparel_products,
  private.printful_apparel_approved_variants,
  private.printful_apparel_orders, private.printful_apparel_fulfillment_outbox,
  private.printful_apparel_action_ledger, private.printful_apparel_payment_risk_holds,
  private.printful_apparel_legacy_payment_resolutions
  from public, anon, authenticated;
grant select, insert, update, delete on private.printful_apparel_sales_state,
  private.printful_apparel_products, private.printful_apparel_approved_variants, private.printful_apparel_orders,
  private.printful_apparel_fulfillment_outbox, private.printful_apparel_action_ledger,
  private.printful_apparel_payment_risk_holds,
  private.printful_apparel_legacy_payment_resolutions to service_role;

create or replace function public.is_printful_apparel_auto_only()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select state.mode in ('cutover', 'printful_apparel_only')
    from private.printful_apparel_sales_state state where state.singleton), true)
$$;
revoke all on function public.is_printful_apparel_auto_only() from public, anon, authenticated;
grant execute on function public.is_printful_apparel_auto_only() to service_role;

create or replace function private.guard_printful_only_physical_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_mode text;
begin
  if new.item_kind <> 'product'
    or tg_op = 'UPDATE' and old.item_kind = 'product' and new.status <> 'pending' then return new; end if;
  select state.mode into checkout_mode from private.printful_apparel_sales_state state where state.singleton for share;
  if checkout_mode is distinct from 'legacy_manual' then
    raise exception 'Manual physical checkout is paused during the Printful-only cutover' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_printful_only_physical_checkout() from public, anon, authenticated, service_role;
create trigger printful_only_armory_checkout_guard
before insert on public.armory_checkout_intents
for each row execute function private.guard_printful_only_physical_checkout();

create or replace function private.guard_printful_only_legacy_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  checkout_mode text;
begin
  if new.fulfillment_status <> 'to_ship' then return new; end if;
  if tg_op = 'UPDATE' and old.fulfillment_status = 'to_ship' then return new; end if;
  select state.mode into checkout_mode from private.printful_apparel_sales_state state where state.singleton for share;
  if checkout_mode is distinct from 'legacy_manual' then
    raise exception 'Manual physical purchase insertion is paused during the Printful-only cutover' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_printful_only_legacy_purchase() from public, anon, authenticated, service_role;
create trigger printful_only_legacy_purchase_guard
before insert or update on public.purchases
for each row execute function private.guard_printful_only_legacy_purchase();

create or replace function public.begin_printful_apparel_cutover(target_admin_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  state private.printful_apparel_sales_state%rowtype;
  pending_count integer;
begin
  select profile.role into role_name from public.profiles profile where profile.id = target_admin_id;
  if role_name is distinct from 'admin' then raise exception 'Admin required' using errcode = '42501'; end if;
  select * into state from private.printful_apparel_sales_state where singleton for update;
  if not found then raise exception 'Apparel sales state is missing' using errcode = 'P0001'; end if;
  select count(*)::integer into pending_count from public.armory_checkout_intents intent
    where intent.item_kind = 'product' and intent.status = 'pending';
  update private.printful_apparel_sales_state
    set mode = 'cutover', sales_enabled = false, fulfillment_enabled = false,
      changed_by = target_admin_id, updated_at = now()
    where singleton and mode = 'legacy_manual';
  if not found and not exists (select 1 from private.printful_apparel_sales_state where singleton and mode = 'cutover') then
    raise exception 'Printful auto-only mode cannot be silently reversed' using errcode = '23514';
  end if;
  return pending_count;
end;
$$;
revoke all on function public.begin_printful_apparel_cutover(uuid) from public, anon, authenticated;
grant execute on function public.begin_printful_apparel_cutover(uuid) to service_role;

create or replace function public.finish_printful_apparel_cutover(target_admin_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  state private.printful_apparel_sales_state%rowtype;
begin
  select profile.role into role_name from public.profiles profile where profile.id = target_admin_id;
  if role_name is distinct from 'admin' then raise exception 'Admin required' using errcode = '42501'; end if;
  select * into state from private.printful_apparel_sales_state where singleton for update;
  if not found then return false; end if;
  if state.mode = 'printful_apparel_only' then return true; end if;
  if state.mode <> 'cutover' then return false; end if;
  if exists (select 1 from public.armory_checkout_intents intent
      where intent.item_kind = 'product' and intent.status = 'pending') then return false; end if;
  if exists (select 1 from private.printful_apparel_legacy_payment_resolutions resolution
      where resolution.status = 'resolution_hold') then return false; end if;
  update private.printful_apparel_sales_state
    set mode = 'printful_apparel_only', changed_by = target_admin_id, updated_at = now()
    where singleton and mode = 'cutover';
  return found;
end;
$$;
revoke all on function public.finish_printful_apparel_cutover(uuid) from public, anon, authenticated;
grant execute on function public.finish_printful_apparel_cutover(uuid) to service_role;

create or replace function public.set_printful_apparel_product_approval(
  target_product_id uuid,
  target_admin_id uuid,
  target_enabled boolean,
  target_apparel_attestation boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
  product private.printful_catalog_products%rowtype;
  managed_item_id uuid;
  draft private.printful_armory_drafts%rowtype;
  new_version bigint;
  current_revision bigint;
  approved_variant_count integer;
begin
  select profile.role into role_name from public.profiles profile where profile.id = target_admin_id;
  if role_name is distinct from 'admin' then raise exception 'Admin required' using errcode = '42501'; end if;
  select catalog.* into product from private.printful_catalog_products catalog
    where catalog.id = target_product_id and catalog.store_id = '19050731' for update;
  if not found then raise exception 'Product not staged' using errcode = 'P0001'; end if;
  select managed.item_id into managed_item_id from private.printful_managed_items managed
    where managed.product_id = product.id;
  if managed_item_id is null then raise exception 'Private preview is required' using errcode = 'P0001'; end if;
  select private_draft.* into draft from private.printful_armory_drafts private_draft
    where private_draft.item_id = managed_item_id for update;
  if target_enabled and (
    not target_apparel_attestation or draft.item_id is null or draft.published_at is null or
    draft.curation_approved_at is null or not draft.visible_to_all or draft.image_path is null
  ) then raise exception 'Published public apparel preview is required' using errcode = 'P0001'; end if;
  insert into private.printful_apparel_products (
    product_id, item_id, classification, enabled, approval_version, approved_by, approved_at
  ) values (
    product.id, managed_item_id, case when target_enabled then 'apparel' else 'unclassified' end,
    target_enabled, 1, case when target_enabled then target_admin_id else null end,
    case when target_enabled then now() else null end
  ) on conflict (product_id) do update set
    item_id = excluded.item_id,
    classification = excluded.classification,
    enabled = excluded.enabled,
    approval_version = private.printful_apparel_products.approval_version + 1,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at,
    updated_at = now()
  returning approval_version into new_version;
  delete from private.printful_apparel_approved_variants where product_id = product.id;
  if target_enabled then
    select revision into current_revision
      from private.printful_catalog_sync_state where singleton for share;
    insert into private.printful_apparel_approved_variants (
      product_id, variant_id, approval_version, store_id, external_product_id,
      sync_variant_id, provider_external_variant_id, catalog_variant_id,
      configuration_fingerprint, production_cost_cents, production_cost_observed_at,
      production_cost_evidence_sha256
    )
    select product.id, variant.id, new_version, variant.store_id, product.external_product_id,
      variant.external_variant_id, variant.provider_external_id, variant.catalog_variant_id,
      variant.configuration_fingerprint, variant.production_cost_min_cents,
      variant.production_cost_observed_at, variant.production_cost_evidence_sha256
    from private.printful_catalog_variants variant
    where variant.product_id = product.id and variant.store_id = '19050731'
      and variant.last_seen_revision = current_revision
      and variant.synced and variant.ignored is false and variant.available
      and variant.availability_status = 'active' and variant.configuration_complete
      and variant.catalog_variant_id is not null and variant.provider_external_id is not null
      and variant.production_cost_min_cents is not null
      and variant.production_cost_min_cents = variant.production_cost_max_cents
      and variant.production_cost_currency = 'USD'
      and variant.production_cost_source = 'admin-reviewed-printful-ui'
      and variant.production_cost_observed_at > now() - interval '24 hours'
      and variant.production_cost_configuration_fingerprint = variant.configuration_fingerprint
      and variant.production_cost_evidence_sha256 is not null;
    get diagnostics approved_variant_count = row_count;
    if approved_variant_count = 0 then
      raise exception 'A current scalar Printful cost review is required' using errcode = 'P0001';
    end if;
  end if;
  return new_version;
end;
$$;
revoke all on function public.set_printful_apparel_product_approval(uuid, uuid, boolean, boolean) from public, anon, authenticated;
grant execute on function public.set_printful_apparel_product_approval(uuid, uuid, boolean, boolean) to service_role;

create or replace function public.get_printful_apparel_admin_approvals()
returns table (product_id uuid, classification text, enabled boolean, approval_version bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select approval.product_id, approval.classification, approval.enabled, approval.approval_version
  from private.printful_apparel_products approval
$$;
revoke all on function public.get_printful_apparel_admin_approvals() from public, anon, authenticated;
grant execute on function public.get_printful_apparel_admin_approvals() to service_role;

create or replace function public.set_printful_apparel_sales_enabled(
  target_admin_id uuid,
  target_enabled boolean,
  target_refund_policy text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_name text;
begin
  select profile.role into role_name from public.profiles profile where profile.id = target_admin_id;
  if role_name is distinct from 'admin' then raise exception 'Admin required' using errcode = '42501'; end if;
  if target_enabled then
    if target_refund_policy is distinct from 'admin_review' then
      raise exception 'Refund policy selection is required' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.printful_apparel_sales_state state
      where state.singleton and state.mode = 'printful_apparel_only') then
      raise exception 'Printful-only cutover is not complete' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.printful_apparel_products product where product.enabled) then
      raise exception 'No explicitly approved apparel products' using errcode = 'P0001';
    end if;
  end if;
  update private.printful_apparel_sales_state
    set sales_enabled = target_enabled,
      fulfillment_enabled = target_enabled,
      refund_policy = case when target_enabled then target_refund_policy else refund_policy end,
      changed_by = target_admin_id, updated_at = now()
    where singleton and mode = 'printful_apparel_only';
  return found;
end;
$$;
revoke all on function public.set_printful_apparel_sales_enabled(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.set_printful_apparel_sales_enabled(uuid, boolean, text) to service_role;

create or replace function public.list_printful_apparel_catalog()
returns table (
  product_id uuid,
  title text,
  description text,
  image_path text,
  price_cents integer,
  shipping_cents integer,
  variants jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select product.id, draft.title, draft.description, draft.image_path, draft.price_cents, 0,
    jsonb_agg(jsonb_build_object(
      'id', variant.id,
      'name', coalesce(nullif(concat_ws(' · ', nullif(variant.color, ''), nullif(variant.size, '')), ''), variant.provider_name),
      'color', variant.color,
      'size', variant.size,
      'available', true
    ) order by variant.color nulls first, variant.size nulls first, variant.id)
  from private.printful_apparel_sales_state state
  join private.printful_apparel_products approved on approved.enabled and approved.classification = 'apparel'
  join private.printful_catalog_products product on product.id = approved.product_id and product.store_id = '19050731'
  join private.printful_managed_items managed on managed.product_id = product.id and managed.item_id = approved.item_id
  join private.printful_armory_drafts draft on draft.item_id = managed.item_id
  join private.printful_catalog_sync_state sync on sync.singleton
  join private.printful_catalog_variants variant on variant.product_id = product.id
  join private.printful_apparel_approved_variants approved_variant
    on approved_variant.product_id = product.id and approved_variant.variant_id = variant.id
    and approved_variant.approval_version = approved.approval_version
    and approved_variant.store_id = variant.store_id
    and approved_variant.external_product_id = product.external_product_id
    and approved_variant.sync_variant_id = variant.external_variant_id
    and approved_variant.provider_external_variant_id = variant.provider_external_id
    and approved_variant.catalog_variant_id = variant.catalog_variant_id
    and approved_variant.configuration_fingerprint = variant.configuration_fingerprint
    and approved_variant.production_cost_cents = variant.production_cost_min_cents
    and approved_variant.production_cost_observed_at = variant.production_cost_observed_at
    and approved_variant.production_cost_evidence_sha256 = variant.production_cost_evidence_sha256
    and variant.store_id = '19050731' and variant.last_seen_revision = sync.revision
    and variant.synced and variant.ignored is false and variant.available
    and variant.availability_status = 'active' and variant.configuration_complete
    and variant.catalog_variant_id is not null
    and variant.production_cost_min_cents = variant.production_cost_max_cents
    and variant.production_cost_currency = 'USD'
    and variant.production_cost_source = 'admin-reviewed-printful-ui'
    and variant.production_cost_configuration_fingerprint = variant.configuration_fingerprint
  where state.singleton and state.mode = 'printful_apparel_only'
    and state.sales_enabled and state.fulfillment_enabled
    and product.ignored is false and draft.published_at is not null
    and draft.curation_approved_at is not null and draft.visible_to_all and draft.image_path is not null
  group by product.id, draft.title, draft.description, draft.image_path, draft.price_cents
$$;
revoke all on function public.list_printful_apparel_catalog() from public;
grant execute on function public.list_printful_apparel_catalog() to anon, authenticated, service_role;

create or replace function public.get_printful_apparel_checkout_context(target_product_id uuid, target_variant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  sales private.printful_apparel_sales_state%rowtype;
  sync private.printful_catalog_sync_state%rowtype;
  product private.printful_catalog_products%rowtype;
  approved private.printful_apparel_products%rowtype;
  managed private.printful_managed_items%rowtype;
  draft private.printful_armory_drafts%rowtype;
  variant private.printful_catalog_variants%rowtype;
begin
  select * into sales from private.printful_apparel_sales_state where singleton;
  select * into sync from private.printful_catalog_sync_state where singleton;
  select * into product from private.printful_catalog_products
    where id = target_product_id and store_id = '19050731';
  if not found then return null; end if;
  select * into approved from private.printful_apparel_products where product_id = product.id;
  if not found then return null; end if;
  select * into managed from private.printful_managed_items
    where product_id = product.id and item_id = approved.item_id;
  if not found then return null; end if;
  select * into draft from private.printful_armory_drafts where item_id = managed.item_id;
  if not found then return null; end if;
  select * into variant from private.printful_catalog_variants
    where id = target_variant_id and product_id = product.id and store_id = '19050731';
  if not found then return null; end if;
  return jsonb_build_object(
    'state', jsonb_build_object('mode', sales.mode, 'salesEnabled', sales.sales_enabled,
      'fulfillmentEnabled', sales.fulfillment_enabled, 'refundPolicy', sales.refund_policy),
    'revision', sync.revision,
    'product', jsonb_build_object('id', product.id, 'storeId', product.store_id,
      'externalProductId', product.external_product_id, 'ignored', product.ignored,
      'lastSeenRevision', product.last_seen_revision),
    'approval', jsonb_build_object('productId', approved.product_id, 'itemId', approved.item_id,
      'classification', approved.classification, 'enabled', approved.enabled,
      'approvalVersion', approved.approval_version),
    'variant', jsonb_build_object('id', variant.id, 'productId', variant.product_id,
      'storeId', variant.store_id, 'syncVariantId', variant.external_variant_id,
      'providerExternalId', variant.provider_external_id, 'catalogVariantId', variant.catalog_variant_id,
      'providerName', variant.provider_name, 'color', variant.color, 'size', variant.size,
      'synced', variant.synced, 'ignored', variant.ignored, 'availabilityStatus', variant.availability_status,
      'available', variant.available, 'configurationFingerprint', variant.configuration_fingerprint,
      'configurationComplete', variant.configuration_complete,
      'approvedForSale', exists (
        select 1 from private.printful_apparel_approved_variants approved_variant
        where approved_variant.product_id = product.id and approved_variant.variant_id = variant.id
          and approved_variant.approval_version = approved.approval_version
          and approved_variant.store_id = variant.store_id
          and approved_variant.external_product_id = product.external_product_id
          and approved_variant.sync_variant_id = variant.external_variant_id
          and approved_variant.provider_external_variant_id = variant.provider_external_id
          and approved_variant.catalog_variant_id = variant.catalog_variant_id
          and approved_variant.configuration_fingerprint = variant.configuration_fingerprint
          and approved_variant.production_cost_cents = variant.production_cost_min_cents
          and approved_variant.production_cost_observed_at = variant.production_cost_observed_at
          and approved_variant.production_cost_evidence_sha256 = variant.production_cost_evidence_sha256
      ),
      'productionCostMinCents', variant.production_cost_min_cents,
      'productionCostMaxCents', variant.production_cost_max_cents,
      'productionCostCurrency', variant.production_cost_currency,
      'productionCostSource', variant.production_cost_source,
      'productionCostObservedAt', variant.production_cost_observed_at,
      'productionCostConfigurationFingerprint', variant.production_cost_configuration_fingerprint,
      'lastSeenRevision', variant.last_seen_revision),
    'draft', jsonb_build_object('title', draft.title, 'description', draft.description,
      'imagePath', draft.image_path, 'priceCents', draft.price_cents, 'shippingCents', draft.shipping_cents,
      'visibleToAll', draft.visible_to_all, 'curationApprovedAt', draft.curation_approved_at,
      'publishedAt', draft.published_at)
  );
end;
$$;
revoke all on function public.get_printful_apparel_checkout_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_printful_apparel_checkout_context(uuid, uuid) to service_role;

create or replace function public.create_printful_apparel_checkout_intent(
  target_order_id uuid,
  target_product_id uuid,
  target_variant_id uuid,
  target_catalog_revision bigint,
  target_approval_version bigint,
  target_email text,
  target_address jsonb,
  target_address_sha256 text,
  target_status_token_sha256 text,
  target_status_token_expires_at timestamptz,
  target_quote jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  state private.printful_apparel_sales_state%rowtype;
  existing_order private.printful_apparel_orders%rowtype;
  product private.printful_catalog_products%rowtype;
  approved private.printful_apparel_products%rowtype;
  managed private.printful_managed_items%rowtype;
  draft private.printful_armory_drafts%rowtype;
  variant private.printful_catalog_variants%rowtype;
  current_revision bigint;
  email text := lower(btrim(coalesce(target_email, '')));
  address jsonb;
  quote_currency text;
  subtotal_cents integer;
  discount_cents integer;
  shipping_cents integer;
  tax_cents integer;
  vat_cents integer;
  additional_fee_cents integer;
  fulfillment_fee_cents integer;
  digitization_cents integer;
  total_cents integer;
  created_at timestamptz;
  expires_at timestamptz;
begin
  if target_order_id is null or target_product_id is null or target_variant_id is null
    or target_catalog_revision is null or target_approval_version is null
    or target_address_sha256 is null or target_address_sha256 !~ '^[0-9a-f]{64}$'
    or target_status_token_sha256 is null or target_status_token_sha256 !~ '^[0-9a-f]{64}$'
    or target_status_token_expires_at <= now()
  then raise exception 'Invalid apparel checkout request' using errcode = '22023'; end if;
  if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(email) > 320 then
    raise exception 'Invalid guest email' using errcode = '22023';
  end if;
  if target_address is null or jsonb_typeof(target_address) is distinct from 'object'
    or not (target_address ?& array['name','address1','city','stateCode','countryCode','zip'])
    or upper(btrim(coalesce(target_address ->> 'countryCode', ''))) <> 'US'
    or char_length(btrim(coalesce(target_address ->> 'name', ''))) not between 1 and 200
    or char_length(btrim(coalesce(target_address ->> 'address1', ''))) not between 1 and 200
    or char_length(btrim(coalesce(target_address ->> 'city', ''))) not between 1 and 100
    or upper(btrim(coalesce(target_address ->> 'stateCode', ''))) !~ '^[A-Z]{2}$'
    or upper(btrim(coalesce(target_address ->> 'zip', ''))) !~ '^[A-Z0-9 -]{3,20}$'
  then raise exception 'A supported US shipping address is required' using errcode = '22023'; end if;
  address := jsonb_build_object(
    'name', btrim(target_address ->> 'name'), 'address1', btrim(target_address ->> 'address1'),
    'address2', btrim(coalesce(target_address ->> 'address2', '')), 'city', btrim(target_address ->> 'city'),
    'stateCode', upper(btrim(target_address ->> 'stateCode')), 'countryCode', 'US',
    'zip', upper(btrim(target_address ->> 'zip')),
    'phone', nullif(btrim(coalesce(target_address ->> 'phone', '')), ''), 'email', email
  );

  -- Repeated guest submits recover the same stable Stripe request even if the listing
  -- changed after the first attempt or Stripe created a session before its response was lost.
  select * into existing_order from private.printful_apparel_orders where id = target_order_id for update;
  if found then
    if existing_order.product_id = target_product_id and existing_order.variant_id = target_variant_id
      and existing_order.guest_email = email
      and existing_order.quote_address_sha256 = target_address_sha256
      and existing_order.status_token_sha256 = target_status_token_sha256
      and existing_order.status in ('quoted', 'checkout_open', 'checkout_expired') then
      return target_order_id;
    end if;
    raise exception 'Checkout request identity changed' using errcode = '23505';
  end if;

  select * into state from private.printful_apparel_sales_state where singleton for update;
  if state.mode <> 'printful_apparel_only' or not state.sales_enabled or not state.fulfillment_enabled
    or state.refund_policy is null then raise exception 'Printful apparel checkout is disabled' using errcode = 'P0001'; end if;
  select revision into current_revision from private.printful_catalog_sync_state where singleton for share;
  if current_revision is distinct from target_catalog_revision then raise exception 'Catalog revision changed' using errcode = '40001'; end if;
  select * into product from private.printful_catalog_products where id = target_product_id and store_id = '19050731' for share;
  if not found or product.ignored is distinct from false or product.last_seen_revision <> current_revision then
    raise exception 'Product is not currently available' using errcode = 'P0001';
  end if;
  select * into approved from private.printful_apparel_products where product_id = product.id for share;
  if not found or not approved.enabled or approved.classification <> 'apparel'
    or approved.approval_version <> target_approval_version then raise exception 'Apparel approval changed' using errcode = '40001'; end if;
  select * into managed from private.printful_managed_items where product_id = product.id;
  select * into draft from private.printful_armory_drafts where item_id = managed.item_id for share;
  if not found or draft.published_at is null or draft.curation_approved_at is null
    or not draft.visible_to_all or draft.image_path is null then raise exception 'Published apparel copy is unavailable' using errcode = 'P0001'; end if;
  select * into variant from private.printful_catalog_variants
    where id = target_variant_id and product_id = product.id and store_id = '19050731' for share;
  if not found or variant.last_seen_revision <> current_revision or not variant.synced
    or variant.ignored is distinct from false or not variant.available or variant.availability_status <> 'active'
    or not variant.configuration_complete or variant.catalog_variant_id is null
    or variant.provider_external_id is null
    or variant.production_cost_min_cents is null or variant.production_cost_min_cents <> variant.production_cost_max_cents
    or variant.production_cost_currency <> 'USD' or variant.production_cost_source <> 'admin-reviewed-printful-ui'
    or variant.production_cost_configuration_fingerprint is distinct from variant.configuration_fingerprint
  then raise exception 'Selected apparel variant is not sale-ready' using errcode = 'P0001'; end if;

  if not exists (
    select 1 from private.printful_apparel_approved_variants approved_variant
    where approved_variant.product_id = product.id and approved_variant.variant_id = variant.id
      and approved_variant.approval_version = approved.approval_version
      and approved_variant.store_id = variant.store_id
      and approved_variant.external_product_id = product.external_product_id
      and approved_variant.sync_variant_id = variant.external_variant_id
      and approved_variant.provider_external_variant_id = variant.provider_external_id
      and approved_variant.catalog_variant_id = variant.catalog_variant_id
      and approved_variant.configuration_fingerprint = variant.configuration_fingerprint
      and approved_variant.production_cost_cents = variant.production_cost_min_cents
      and approved_variant.production_cost_observed_at = variant.production_cost_observed_at
      and approved_variant.production_cost_evidence_sha256 = variant.production_cost_evidence_sha256
  ) then raise exception 'Selected variant is outside the approved product manifest' using errcode = '40001'; end if;

  if target_quote is null or jsonb_typeof(target_quote) is distinct from 'object'
    or not (target_quote ?& array[
      'currency','source','complete','variantId','configurationFingerprint','designIdentityFingerprint',
      'catalogRevision','approvalVersion','addressSha256','address','createdAt','expiresAt',
      'subtotalCents','discountCents','shippingCents','taxCents','vatCents',
      'additionalFeeCents','fulfillmentFeeCents','digitizationCents','totalCents'
    ])
    or jsonb_typeof(target_quote -> 'complete') is distinct from 'boolean'
    or jsonb_typeof(target_quote -> 'currency') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'source') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'variantId') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'configurationFingerprint') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'designIdentityFingerprint') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'catalogRevision') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'approvalVersion') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'addressSha256') is distinct from 'string'
    or target_quote ->> 'currency' is distinct from 'USD'
    or target_quote ->> 'source' is distinct from 'printful-order-estimate'
    or target_quote ->> 'complete' is distinct from 'true'
    or jsonb_typeof(target_quote -> 'address') is distinct from 'object'
    or jsonb_typeof(target_quote -> 'createdAt') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'expiresAt') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'subtotalCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'discountCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'shippingCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'taxCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'vatCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'additionalFeeCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'fulfillmentFeeCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'digitizationCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'totalCents') is distinct from 'number'
  then raise exception 'Complete USD quote required' using errcode = 'P0001'; end if;
  if coalesce(target_quote ->> 'variantId', '') <> target_variant_id::text
    or coalesce(target_quote ->> 'configurationFingerprint', '') <> variant.configuration_fingerprint
    or coalesce(target_quote ->> 'designIdentityFingerprint', '') !~ '^[0-9a-f]{64}$'
    or coalesce(target_quote ->> 'catalogRevision', '') <> current_revision::text
    or coalesce(target_quote ->> 'approvalVersion', '') <> approved.approval_version::text
    or coalesce(target_quote ->> 'addressSha256', '') <> target_address_sha256 then
    raise exception 'Quote binding changed' using errcode = '40001';
  end if;
  if (target_quote ->> 'address')::jsonb is distinct from address then
    raise exception 'Quote address does not match checkout' using errcode = '40001';
  end if;
  if target_quote is null or jsonb_typeof(target_quote) <> 'object'
    or (target_quote ->> 'createdAt') is null or (target_quote ->> 'expiresAt') is null then
    raise exception 'Quote timestamps are required' using errcode = '22023';
  end if;
  created_at := (target_quote ->> 'createdAt')::timestamptz;
  expires_at := (target_quote ->> 'expiresAt')::timestamptz;
  if created_at > now() or created_at < now() - interval '10 minutes' or expires_at <= now()
    or expires_at > created_at + interval '45 minutes' then raise exception 'Quote expired' using errcode = 'P0001'; end if;

  quote_currency := target_quote ->> 'currency';
  if (target_quote ->> 'subtotalCents') is null or (target_quote ->> 'subtotalCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'discountCents') is null or (target_quote ->> 'discountCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'shippingCents') is null or (target_quote ->> 'shippingCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'taxCents') is null or (target_quote ->> 'taxCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'vatCents') is null or (target_quote ->> 'vatCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'additionalFeeCents') is null or (target_quote ->> 'additionalFeeCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'fulfillmentFeeCents') is null or (target_quote ->> 'fulfillmentFeeCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'digitizationCents') is null or (target_quote ->> 'digitizationCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'totalCents') is null or (target_quote ->> 'totalCents') !~ '^[1-9][0-9]{0,8}$'
  then raise exception 'Malformed quote cost facts' using errcode = '22023'; end if;
  subtotal_cents := (target_quote ->> 'subtotalCents')::integer;
  discount_cents := (target_quote ->> 'discountCents')::integer;
  shipping_cents := (target_quote ->> 'shippingCents')::integer;
  tax_cents := (target_quote ->> 'taxCents')::integer;
  vat_cents := (target_quote ->> 'vatCents')::integer;
  additional_fee_cents := (target_quote ->> 'additionalFeeCents')::integer;
  fulfillment_fee_cents := (target_quote ->> 'fulfillmentFeeCents')::integer;
  digitization_cents := (target_quote ->> 'digitizationCents')::integer;
  total_cents := (target_quote ->> 'totalCents')::integer;
  insert into private.printful_apparel_orders (
    id, product_id, item_id, variant_id, approval_version, catalog_revision,
    external_product_id, sync_variant_id, provider_external_variant_id, catalog_variant_id, configuration_fingerprint, design_identity_fingerprint,
    item_title, variant_label, variant_color, variant_size, guest_email, quoted_address,
    quote_address_sha256, status_token_sha256, status_token_expires_at,
    customer_price_cents, quote_currency, quote_subtotal_cents, quote_discount_cents,
    quote_shipping_cents, quote_tax_cents, quote_vat_cents, quote_additional_fee_cents,
    quote_fulfillment_fee_cents, quote_digitization_cents, quote_total_cents,
    quote_cost_facts_complete, quote_created_at, quote_expires_at, provider_external_id
  ) values (
    target_order_id, product.id, managed.item_id, variant.id, approved.approval_version, current_revision,
    product.external_product_id, variant.external_variant_id, variant.provider_external_id, variant.catalog_variant_id, variant.configuration_fingerprint,
    target_quote ->> 'designIdentityFingerprint',
    draft.title, variant.provider_name, variant.color, variant.size, email, address,
    target_address_sha256, target_status_token_sha256, target_status_token_expires_at,
    draft.price_cents, quote_currency, subtotal_cents, discount_cents, shipping_cents,
    tax_cents, vat_cents, additional_fee_cents, fulfillment_fee_cents, digitization_cents,
    total_cents, true, created_at, expires_at, replace(target_order_id::text, '-', '')
  );
  insert into private.printful_apparel_fulfillment_outbox (order_id, status)
  values (target_order_id, 'awaiting_payment');
  return target_order_id;
end;
$$;
revoke all on function public.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb) to service_role;

create or replace function public.bind_printful_apparel_checkout_session(target_order_id uuid, target_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_order private.printful_apparel_orders%rowtype;
begin
  if target_session_id !~ '^cs_[A-Za-z0-9_]{8,240}$' then return false; end if;
  select * into current_order from private.printful_apparel_orders where id = target_order_id for update;
  if not found then return false; end if;
  if current_order.stripe_session_id is not null then return current_order.stripe_session_id = target_session_id; end if;
  if current_order.status <> 'quoted' then return false; end if;
  update private.printful_apparel_orders set stripe_session_id = target_session_id, status = 'checkout_open', updated_at = now()
    where id = target_order_id and stripe_session_id is null;
  update private.printful_apparel_fulfillment_outbox set status = 'awaiting_payment', updated_at = now()
    where order_id = target_order_id;
  return found;
end;
$$;
revoke all on function public.bind_printful_apparel_checkout_session(uuid, text) from public, anon, authenticated;
grant execute on function public.bind_printful_apparel_checkout_session(uuid, text) to service_role;

create or replace function public.get_printful_apparel_checkout_session_state(target_order_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', order_row.status,
    'sessionId', order_row.stripe_session_id,
    'expiresAt', order_row.stripe_session_expires_at,
    'email', order_row.guest_email,
    'priceCents', order_row.customer_price_cents,
    'productTitle', order_row.item_title,
    'variantLabel', order_row.variant_label
  )
  from private.printful_apparel_orders order_row where order_row.id = target_order_id
$$;
revoke all on function public.get_printful_apparel_checkout_session_state(uuid) from public, anon, authenticated;
grant execute on function public.get_printful_apparel_checkout_session_state(uuid) to service_role;

create or replace function public.fail_printful_apparel_checkout(target_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.printful_apparel_orders set status = 'checkout_expired', updated_at = now()
    where id = target_order_id and status = 'quoted' and stripe_session_id is null;
  if not found then return false; end if;
  update private.printful_apparel_fulfillment_outbox set status = 'awaiting_payment', updated_at = now()
    where order_id = target_order_id;
  return true;
end;
$$;
revoke all on function public.fail_printful_apparel_checkout(uuid) from public, anon, authenticated;
grant execute on function public.fail_printful_apparel_checkout(uuid) to service_role;

create or replace function public.expire_printful_apparel_checkout(target_order_id uuid, target_session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status text;
begin
  select status into current_status from private.printful_apparel_orders
    where id = target_order_id and stripe_session_id = target_session_id for update;
  if not found then return false; end if;
  if current_status = 'checkout_expired' then return true; end if;
  if current_status <> 'checkout_open' then return false; end if;
  update private.printful_apparel_orders set status = 'checkout_expired', updated_at = now()
    where id = target_order_id;
  update private.printful_apparel_fulfillment_outbox set status = 'awaiting_payment', updated_at = now()
    where order_id = target_order_id;
  return true;
end;
$$;
revoke all on function public.expire_printful_apparel_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.expire_printful_apparel_checkout(uuid, text) to service_role;

create or replace function public.record_printful_apparel_paid(
  target_order_id uuid,
  target_session_id text,
  target_payment_intent_id text,
  target_event_id text,
  target_paid_cents integer,
  target_net_revenue_cents integer,
  target_currency text,
  target_guest_email text,
  target_stripe_address jsonb,
  target_livemode boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
  normalized_address jsonb;
  net integer;
  next_status text;
  risk_held boolean := false;
  allow_address_recovery boolean := false;
begin
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found then return 'not_found'; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found or target_session_id is null or target_session_id !~ '^cs_[A-Za-z0-9_]{8,240}$' then return 'not_found'; end if;
  if order_row.stripe_session_id is null and order_row.status = 'quoted' then
    update private.printful_apparel_orders set stripe_session_id = target_session_id, updated_at = now()
      where id = target_order_id and stripe_session_id is null and status = 'quoted';
    if not found then return 'not_found'; end if;
    order_row.stripe_session_id := target_session_id;
  elsif order_row.stripe_session_id is distinct from target_session_id then
    return 'not_found';
  end if;
  if order_row.stripe_payment_intent_id is not null then
    if order_row.stripe_payment_intent_id is distinct from target_payment_intent_id
      or order_row.stripe_paid_cents is distinct from target_paid_cents then return 'payment_conflict'; end if;
    if order_row.status = 'paid_waiting_address_quote' and order_row.final_stripe_address is null then
      allow_address_recovery := true;
    else
      return order_row.status;
    end if;
  end if;
  if order_row.status not in ('quoted', 'checkout_open', 'checkout_expired', 'paid_waiting_net', 'paid_waiting_address_quote') then return 'invalid_state'; end if;
  if target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[A-Za-z0-9_]{8,240}$'
    or target_event_id is null or target_event_id !~ '^evt_[A-Za-z0-9_]{8,240}$'
    or target_paid_cents is null or target_paid_cents is distinct from order_row.customer_price_cents
    or target_net_revenue_cents is not null and (
      target_net_revenue_cents < 0 or target_net_revenue_cents > target_paid_cents)
    or lower(coalesce(target_currency, '')) <> 'usd'
    or lower(btrim(coalesce(target_guest_email, ''))) is distinct from order_row.guest_email
  then return 'payment_mismatch'; end if;
  select exists(select 1 from private.printful_apparel_payment_risk_holds risk
    where risk.order_id = target_order_id and risk.stripe_payment_intent_id = target_payment_intent_id)
    into risk_held;
  if allow_address_recovery and order_row.status <> 'paid_waiting_address_quote' then
    return 'invalid_state';
  end if;
  if target_livemode is distinct from true then
    update private.printful_apparel_orders set
      stripe_payment_intent_id = target_payment_intent_id, stripe_event_id = target_event_id,
      stripe_paid_cents = target_paid_cents, stripe_livemode = false,
      status = 'test_mode_blocked', updated_at = now()
      where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set status = 'test_mode_blocked', updated_at = now()
      where order_id = target_order_id;
    return 'test_mode_blocked';
  end if;
  if target_stripe_address is null or jsonb_typeof(target_stripe_address) is distinct from 'object'
    or not (target_stripe_address ?& array['name','address1','city','stateCode','countryCode','zip'])
    or upper(btrim(coalesce(target_stripe_address ->> 'countryCode', ''))) <> 'US'
    or char_length(btrim(coalesce(target_stripe_address ->> 'name', ''))) not between 1 and 200
    or char_length(btrim(coalesce(target_stripe_address ->> 'address1', ''))) not between 1 and 200
    or char_length(btrim(coalesce(target_stripe_address ->> 'city', ''))) not between 1 and 100
    or upper(btrim(coalesce(target_stripe_address ->> 'stateCode', ''))) !~ '^[A-Z]{2}$'
    or upper(btrim(coalesce(target_stripe_address ->> 'zip', ''))) !~ '^[A-Z0-9 -]{3,20}$'
  then
    update private.printful_apparel_orders set status = case when risk_held then 'resolution_hold' else 'paid_waiting_address_quote' end,
      stripe_payment_intent_id = target_payment_intent_id, stripe_event_id = target_event_id,
      stripe_paid_cents = target_paid_cents, stripe_livemode = true,
      stripe_net_revenue_cents = coalesce(target_net_revenue_cents, order_row.stripe_net_revenue_cents),
      last_safe_error_code = case when risk_held then 'stripe_payment_risk_requires_review' else 'shipping_address_unverified' end,
      updated_at = now()
      where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set status = case when risk_held then 'resolution_hold' else 'awaiting_address_quote' end, updated_at = now()
      where order_id = target_order_id;
    return case when risk_held then 'resolution_hold' else 'paid_waiting_address_quote' end;
  end if;
  normalized_address := jsonb_build_object(
    'name', btrim(target_stripe_address ->> 'name'),
    'address1', btrim(target_stripe_address ->> 'address1'),
    'address2', btrim(coalesce(target_stripe_address ->> 'address2', '')),
    'city', btrim(target_stripe_address ->> 'city'),
    'stateCode', upper(btrim(target_stripe_address ->> 'stateCode')),
    'countryCode', 'US', 'zip', upper(btrim(target_stripe_address ->> 'zip')),
    'phone', nullif(btrim(coalesce(target_stripe_address ->> 'phone', '')), ''),
    'email', order_row.guest_email
  );
  net := coalesce(target_net_revenue_cents, order_row.stripe_net_revenue_cents);
  next_status := case
    when risk_held then 'resolution_hold'
    when normalized_address is distinct from order_row.quoted_address then 'paid_waiting_address_quote'
    when net is null then 'paid_waiting_net'
    else 'queued'
  end;
  update private.printful_apparel_orders set
    stripe_payment_intent_id = target_payment_intent_id, stripe_event_id = target_event_id,
    stripe_paid_cents = target_paid_cents, stripe_net_revenue_cents = net,
    stripe_livemode = true, final_stripe_address = normalized_address,
    status = next_status, last_safe_error_code = case
      when risk_held then 'stripe_payment_risk_requires_review'
      when next_status = 'queued' then null else next_status end,
    updated_at = now()
    where id = target_order_id;
  update private.printful_apparel_fulfillment_outbox set
    status = case next_status when 'queued' then 'queued' when 'paid_waiting_net' then 'awaiting_net'
      when 'resolution_hold' then 'resolution_hold' else 'awaiting_address_quote' end,
    next_attempt_at = now(), updated_at = now()
    where order_id = target_order_id;
  return next_status;
end;
$$;
revoke all on function public.record_printful_apparel_paid(uuid, text, text, text, integer, integer, text, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_printful_apparel_paid(uuid, text, text, text, integer, integer, text, text, jsonb, boolean) to service_role;

create or replace function public.bind_printful_apparel_final_quote(
  target_order_id uuid,
  target_quote jsonb,
  target_address_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
  total integer;
begin
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found then return false; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found or order_row.status not in (
    'paid_waiting_net', 'paid_waiting_address_quote', 'queued', 'draft_created', 'quote_pending', 'confirm_unknown'
  ) or exists(select 1 from private.printful_apparel_payment_risk_holds risk
    where risk.order_id = target_order_id and risk.stripe_payment_intent_id = order_row.stripe_payment_intent_id)
  then return false; end if;
  if target_quote is null or jsonb_typeof(target_quote) is distinct from 'object'
    or target_address_sha256 is null or target_address_sha256 !~ '^[0-9a-f]{64}$' then return false; end if;
  if not (target_quote ?& array[
      'currency','source','complete','variantId','configurationFingerprint','designIdentityFingerprint',
      'catalogRevision','approvalVersion','addressSha256','address','createdAt','expiresAt',
      'subtotalCents','discountCents','shippingCents','taxCents','vatCents',
      'additionalFeeCents','fulfillmentFeeCents','digitizationCents','totalCents'
    ])
    or jsonb_typeof(target_quote -> 'complete') is distinct from 'boolean'
    or jsonb_typeof(target_quote -> 'address') is distinct from 'object'
    or jsonb_typeof(target_quote -> 'currency') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'source') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'variantId') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'configurationFingerprint') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'designIdentityFingerprint') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'catalogRevision') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'approvalVersion') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'addressSha256') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'createdAt') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'expiresAt') is distinct from 'string'
    or jsonb_typeof(target_quote -> 'subtotalCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'discountCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'shippingCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'taxCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'vatCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'additionalFeeCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'fulfillmentFeeCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'digitizationCents') is distinct from 'number'
    or jsonb_typeof(target_quote -> 'totalCents') is distinct from 'number'
    or target_quote ->> 'currency' is distinct from 'USD'
    or target_quote ->> 'source' is distinct from 'printful-order-estimate'
    or target_quote ->> 'complete' is distinct from 'true'
    or target_quote ->> 'variantId' is distinct from order_row.variant_id::text
    or target_quote ->> 'configurationFingerprint' is distinct from order_row.configuration_fingerprint
    or target_quote ->> 'designIdentityFingerprint' is distinct from order_row.design_identity_fingerprint
    or target_quote ->> 'catalogRevision' is distinct from order_row.catalog_revision::text
    or target_quote ->> 'approvalVersion' is distinct from order_row.approval_version::text
    or target_quote ->> 'addressSha256' is distinct from target_address_sha256
    or (target_quote ->> 'address')::jsonb is distinct from order_row.final_stripe_address
  then return false; end if;
  if (target_quote ->> 'createdAt') is null or (target_quote ->> 'expiresAt') is null then return false; end if;
  if (target_quote ->> 'createdAt')::timestamptz > now()
    or (target_quote ->> 'createdAt')::timestamptz < now() - interval '10 minutes'
    or (target_quote ->> 'expiresAt')::timestamptz <= now()
    or (target_quote ->> 'expiresAt')::timestamptz > (target_quote ->> 'createdAt')::timestamptz + interval '10 minutes' then return false; end if;
  if (target_quote ->> 'subtotalCents') is null or (target_quote ->> 'subtotalCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'discountCents') is null or (target_quote ->> 'discountCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'shippingCents') is null or (target_quote ->> 'shippingCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'taxCents') is null or (target_quote ->> 'taxCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'vatCents') is null or (target_quote ->> 'vatCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'additionalFeeCents') is null or (target_quote ->> 'additionalFeeCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'fulfillmentFeeCents') is null or (target_quote ->> 'fulfillmentFeeCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'digitizationCents') is null or (target_quote ->> 'digitizationCents') !~ '^(0|[1-9][0-9]{0,8})$'
    or (target_quote ->> 'totalCents') is null or (target_quote ->> 'totalCents') !~ '^[1-9][0-9]{0,8}$' then return false; end if;
  total := (target_quote ->> 'totalCents')::integer;
  if total > order_row.quote_total_cents
    or order_row.stripe_net_revenue_cents is not null and total > order_row.stripe_net_revenue_cents then return false; end if;
  update private.printful_apparel_orders set
    final_quote_currency = 'USD', final_quote_source = 'printful-order-estimate',
    final_quote_subtotal_cents = (target_quote ->> 'subtotalCents')::integer,
    final_quote_discount_cents = (target_quote ->> 'discountCents')::integer,
    final_quote_shipping_cents = (target_quote ->> 'shippingCents')::integer,
    final_quote_tax_cents = (target_quote ->> 'taxCents')::integer,
    final_quote_vat_cents = (target_quote ->> 'vatCents')::integer,
    final_quote_additional_fee_cents = (target_quote ->> 'additionalFeeCents')::integer,
    final_quote_fulfillment_fee_cents = (target_quote ->> 'fulfillmentFeeCents')::integer,
    final_quote_digitization_cents = (target_quote ->> 'digitizationCents')::integer,
    final_quote_total_cents = total, final_quote_cost_facts_complete = true,
    final_quote_created_at = (target_quote ->> 'createdAt')::timestamptz,
    status = case
      when order_row.status in ('draft_created', 'quote_pending', 'confirm_unknown') then order_row.status
      when order_row.stripe_net_revenue_cents is null then 'paid_waiting_net'
      else 'queued'
    end,
    last_safe_error_code = null, updated_at = now()
    where id = target_order_id;
  update private.printful_apparel_fulfillment_outbox set
    status = case
      when order_row.status in ('draft_created', 'quote_pending', 'confirm_unknown') then order_row.status
      when order_row.stripe_net_revenue_cents is null then 'awaiting_net'
      else 'queued'
    end,
    next_attempt_at = now(), updated_at = now()
    where order_id = target_order_id;
  return true;
end;
$$;
revoke all on function public.bind_printful_apparel_final_quote(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.bind_printful_apparel_final_quote(uuid, jsonb, text) to service_role;

create or replace function public.record_printful_apparel_stripe_net(
  target_order_id uuid,
  target_payment_intent_id text,
  target_paid_cents integer,
  target_net_revenue_cents integer,
  target_currency text,
  target_livemode boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
  next_status text;
begin
  if target_order_id is null or target_payment_intent_id is null
    or target_payment_intent_id !~ '^pi_[A-Za-z0-9_]{8,240}$'
    or target_paid_cents is null or target_paid_cents < 1
    or target_net_revenue_cents is null or target_net_revenue_cents < 0
    or target_net_revenue_cents > target_paid_cents
    or lower(coalesce(target_currency, '')) <> 'usd' or target_livemode is distinct from true then
    return 'invalid_net_facts';
  end if;
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found then return 'not_found'; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found then return 'not_found'; end if;
  if order_row.stripe_payment_intent_id is distinct from target_payment_intent_id
    or order_row.stripe_paid_cents is distinct from target_paid_cents
    or order_row.stripe_livemode is distinct from true then return 'payment_mismatch'; end if;
  if order_row.stripe_net_revenue_cents is not null then
    if order_row.stripe_net_revenue_cents = target_net_revenue_cents then return order_row.status; end if;
    return 'net_conflict';
  end if;
  if order_row.status = 'resolution_hold' or exists(select 1 from private.printful_apparel_payment_risk_holds risk
      where risk.order_id = target_order_id and risk.stripe_payment_intent_id = target_payment_intent_id) then
    update private.printful_apparel_orders set stripe_net_revenue_cents = target_net_revenue_cents,
      status = 'resolution_hold', updated_at = now() where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set status = 'resolution_hold',
      lease_owner = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
      where order_id = target_order_id;
    return 'resolution_hold';
  end if;
  if order_row.status not in ('paid_waiting_net', 'paid_waiting_address_quote') then return 'invalid_state'; end if;
  next_status := case
    when order_row.status = 'paid_waiting_address_quote' then 'paid_waiting_address_quote'
    else 'queued'
  end;
  update private.printful_apparel_orders set
    stripe_net_revenue_cents = target_net_revenue_cents,
    status = next_status, last_safe_error_code = null, updated_at = now()
    where id = target_order_id;
  update private.printful_apparel_fulfillment_outbox set
    status = case next_status when 'queued' then 'queued' when 'paid_waiting_address_quote' then 'awaiting_address_quote' else 'awaiting_net' end,
    next_attempt_at = now(), updated_at = now()
    where order_id = target_order_id;
  return next_status;
end;
$$;
revoke all on function public.record_printful_apparel_stripe_net(uuid, text, integer, integer, text, boolean) from public, anon, authenticated;
grant execute on function public.record_printful_apparel_stripe_net(uuid, text, integer, integer, text, boolean) to service_role;

create or replace function public.claim_printful_apparel_fulfillment_jobs(target_worker_id uuid, target_lease_seconds integer)
returns table (
  order_id uuid,
  lease_generation bigint,
  lease_expires_at timestamptz,
  status text,
  provider_external_id text,
  provider_order_id text,
  sync_variant_id text,
  external_product_id text,
  provider_external_variant_id text,
  catalog_variant_id text,
  variant_id uuid,
  configuration_fingerprint text,
  design_identity_fingerprint text,
  item_title text,
  variant_label text,
  quantity integer,
  guest_email text,
  address jsonb,
  customer_price_cents integer,
  stripe_net_revenue_cents integer,
  quote_total_cents integer,
  final_quote_total_cents integer,
  stripe_payment_intent_id text,
  stripe_session_id text,
  stripe_paid_cents integer,
  stripe_livemode boolean,
  final_stripe_address jsonb,
  quote_expires_at timestamptz,
  approval_version bigint,
  catalog_revision bigint,
  stripe_event_id text,
  final_stripe_address_verified boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate uuid;
begin
  if target_worker_id is null or target_lease_seconds not between 30 and 300 then
    raise exception 'Invalid fulfillment lease' using errcode = '22023';
  end if;
  if not exists (select 1 from private.printful_apparel_sales_state state
      where state.singleton and state.mode = 'printful_apparel_only' and state.fulfillment_enabled) then
    return;
  end if;
  select job.order_id into candidate
  from private.printful_apparel_fulfillment_outbox job
  join private.printful_apparel_orders order_row on order_row.id = job.order_id
  where job.status in ('awaiting_net', 'awaiting_address_quote', 'queued', 'create_unknown', 'draft_created', 'quote_pending', 'confirm_unknown', 'confirmed', 'partial')
    and job.next_attempt_at <= now()
    and (job.lease_expires_at is null or job.lease_expires_at <= now())
    and order_row.status in ('paid_waiting_net', 'paid_waiting_address_quote', 'queued', 'create_unknown', 'draft_created', 'quote_pending', 'confirm_unknown', 'confirmed', 'partial')
  order by job.next_attempt_at, job.order_id
  for update of job skip locked limit 1;
  if candidate is null then return; end if;
  update private.printful_apparel_fulfillment_outbox job set
    lease_owner = target_worker_id, lease_generation = job.lease_generation + 1,
    lease_expires_at = now() + make_interval(secs => target_lease_seconds),
    attempts = least(job.attempts + 1, 1000), updated_at = now()
  where job.order_id = candidate;
  return query select order_row.id, job.lease_generation, job.lease_expires_at, order_row.status,
    order_row.provider_external_id, order_row.provider_order_id, order_row.sync_variant_id,
    order_row.external_product_id, order_row.provider_external_variant_id,
    order_row.catalog_variant_id, order_row.variant_id, order_row.configuration_fingerprint,
    order_row.design_identity_fingerprint,
    order_row.item_title, order_row.variant_label, order_row.quantity::integer, order_row.guest_email,
    coalesce(order_row.final_stripe_address, order_row.quoted_address), order_row.customer_price_cents,
    order_row.stripe_net_revenue_cents, order_row.quote_total_cents, order_row.final_quote_total_cents,
    order_row.stripe_payment_intent_id, order_row.stripe_session_id, order_row.stripe_paid_cents,
    order_row.stripe_livemode, order_row.final_stripe_address, order_row.quote_expires_at,
    order_row.approval_version, order_row.catalog_revision, order_row.stripe_event_id,
    order_row.final_stripe_address is not null
  from private.printful_apparel_orders order_row
  join private.printful_apparel_fulfillment_outbox job on job.order_id = order_row.id
  where order_row.id = candidate;
end;
$$;
revoke all on function public.claim_printful_apparel_fulfillment_jobs(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_printful_apparel_fulfillment_jobs(uuid, integer) to service_role;

create or replace function public.record_printful_apparel_action(
  target_order_id uuid,
  target_worker_id uuid,
  target_lease_generation bigint,
  target_action_key text,
  target_action_kind text,
  target_action_state text,
  target_safe_code text,
  target_provider_order_id text,
  target_request_sha256 text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
  action_row private.printful_apparel_action_ledger%rowtype;
begin
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found or job.lease_owner is distinct from target_worker_id
    or job.lease_generation is distinct from target_lease_generation or job.lease_expires_at <= now() then return false; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found then return false; end if;
  if target_action_kind is null or target_action_kind not in ('estimate','create','reconcile','confirm','cancel','refund','status_poll')
    or target_action_state is null or target_action_state not in ('started','succeeded','unknown','failed')
    or target_action_key is null or char_length(target_action_key) not between 1 and 120
    or target_request_sha256 is null or target_request_sha256 !~ '^[0-9a-f]{64}$'
    or target_provider_order_id is not null and not private.valid_printful_catalog_id(target_provider_order_id) then
    raise exception 'Invalid action ledger entry' using errcode = '22023';
  end if;
  if target_action_state = 'started' and (
      target_action_kind = 'create' and (order_row.status <> 'queued' or order_row.provider_order_id is not null)
      or target_action_kind = 'confirm' and (
        order_row.status not in ('draft_created','quote_pending')
        or order_row.provider_order_id is null
        or target_provider_order_id is distinct from order_row.provider_order_id
      )
    ) then return false; end if;
  if target_action_state = 'started' and target_action_kind in ('create','confirm') and exists(
    select 1 from private.printful_apparel_payment_risk_holds risk
    where risk.order_id = target_order_id and risk.stripe_payment_intent_id = order_row.stripe_payment_intent_id
  ) then return false; end if;
  select * into action_row from private.printful_apparel_action_ledger
    where order_id = target_order_id and action_key = target_action_key;
  if action_row.id is null then
    if target_action_state <> 'started' then raise exception 'Action must be journaled before provider call' using errcode = '23514'; end if;
    insert into private.printful_apparel_action_ledger (
      order_id, action_key, lease_generation, action_kind, state,
      provider_order_id, safe_result_code, request_sha256
    ) values (
      target_order_id, target_action_key, target_lease_generation, target_action_kind, 'started',
      null, null, target_request_sha256
    );
    if target_action_kind in ('create','confirm') then
      update private.printful_apparel_orders set
        status = case target_action_kind when 'create' then 'create_unknown' else 'confirm_unknown' end,
        last_safe_error_code = case target_action_kind when 'create' then 'create_outcome_unknown' else 'confirm_outcome_unknown' end,
        updated_at = now()
        where id = target_order_id;
      update private.printful_apparel_fulfillment_outbox set
        status = case target_action_kind when 'create' then 'create_unknown' else 'confirm_unknown' end,
        updated_at = now()
        where order_id = target_order_id;
    end if;
  else
    if action_row.action_kind is distinct from target_action_kind
      or action_row.request_sha256 is distinct from target_request_sha256
      or action_row.lease_generation is distinct from target_lease_generation
      or action_row.state is distinct from 'started'
      or target_action_state = 'started'
      or action_row.provider_order_id is not null and target_provider_order_id is not null
        and action_row.provider_order_id is distinct from target_provider_order_id then
      return false;
    end if;
    update private.printful_apparel_action_ledger set
      state = target_action_state,
      provider_order_id = coalesce(target_provider_order_id, provider_order_id),
      safe_result_code = target_safe_code,
      finished_at = now()
    where id = action_row.id and state = 'started' and lease_generation = target_lease_generation;
    if not found then return false; end if;
  end if;
  return true;
end;
$$;
revoke all on function public.record_printful_apparel_action(uuid, uuid, bigint, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_printful_apparel_action(uuid, uuid, bigint, text, text, text, text, text, text) to service_role;

create or replace function public.update_printful_apparel_fulfillment_state(
  target_order_id uuid,
  target_worker_id uuid,
  target_lease_generation bigint,
  target_order_status text,
  target_job_status text,
  target_provider_order_id text,
  target_provider_status text,
  target_provider_shipments jsonb,
  target_safe_error_code text,
  target_next_attempt_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
begin
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found or job.lease_owner is distinct from target_worker_id
    or job.lease_generation is distinct from target_lease_generation
    or job.lease_expires_at is null or job.lease_expires_at <= now() then return false; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found then return false; end if;
  if target_order_status is null or target_order_status not in ('create_unknown','draft_created','quote_pending','confirm_unknown','confirmed','partial','fulfilled','definitive_unfulfilled','refund_pending','refunded','resolution_hold')
    or target_job_status not in ('queued','create_unknown','draft_created','quote_pending','confirm_unknown','confirmed','partial','fulfilled','definitive_unfulfilled','refund_pending','refunded','resolution_hold')
    or target_safe_error_code is not null and char_length(target_safe_error_code) > 64
    or (target_provider_shipments is not null and (jsonb_typeof(target_provider_shipments) <> 'array' or jsonb_array_length(target_provider_shipments) > 20)) then
    raise exception 'Invalid Printful order transition' using errcode = '22023';
  end if;
  if target_job_status is distinct from target_order_status
    or order_row.status = 'resolution_hold' and target_order_status <> 'resolution_hold'
    or order_row.provider_order_id is not null and target_provider_order_id is not null
      and order_row.provider_order_id is distinct from target_provider_order_id then
    raise exception 'Printful order identity or hold is immutable' using errcode = '23514';
  end if;
  if not (case order_row.status
    when 'queued' then target_order_status in ('create_unknown','definitive_unfulfilled','resolution_hold')
    when 'create_unknown' then target_order_status in ('create_unknown','draft_created','quote_pending','confirmed','partial','fulfilled','definitive_unfulfilled','resolution_hold')
    when 'draft_created' then target_order_status in ('draft_created','quote_pending','confirm_unknown','confirmed','partial','fulfilled','definitive_unfulfilled','resolution_hold')
    when 'quote_pending' then target_order_status in ('quote_pending','draft_created','confirm_unknown','confirmed','partial','fulfilled','definitive_unfulfilled','resolution_hold')
    when 'confirm_unknown' then target_order_status in ('confirm_unknown','confirmed','partial','fulfilled','definitive_unfulfilled','resolution_hold')
    when 'confirmed' then target_order_status in ('confirmed','partial','fulfilled','resolution_hold')
    when 'partial' then target_order_status in ('partial','fulfilled','resolution_hold')
    when 'fulfilled' then target_order_status in ('fulfilled','resolution_hold')
    when 'definitive_unfulfilled' then target_order_status in ('definitive_unfulfilled','refund_pending','resolution_hold')
    when 'refund_pending' then target_order_status in ('refund_pending','refunded','resolution_hold')
    when 'refunded' then target_order_status in ('refunded','resolution_hold')
    when 'resolution_hold' then target_order_status = 'resolution_hold'
    else false
  end) then
    raise exception 'Illegal Printful fulfillment state transition' using errcode = '23514';
  end if;
  update private.printful_apparel_orders set
    status = target_order_status,
    provider_order_id = coalesce(target_provider_order_id, provider_order_id),
    provider_status = target_provider_status,
    provider_shipments = coalesce(target_provider_shipments, provider_shipments),
    last_safe_error_code = target_safe_error_code,
    updated_at = now()
    where id = target_order_id;
  update private.printful_apparel_fulfillment_outbox set
    status = target_job_status,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = coalesce(target_next_attempt_at, now()), updated_at = now()
    where order_id = target_order_id;
  return true;
end;
$$;
revoke all on function public.update_printful_apparel_fulfillment_state(uuid, uuid, bigint, text, text, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.update_printful_apparel_fulfillment_state(uuid, uuid, bigint, text, text, text, text, jsonb, text, timestamptz) to service_role;

create or replace function public.record_printful_apparel_post_confirm_cost_exception(
  target_order_id uuid,
  target_worker_id uuid,
  target_lease_generation bigint,
  target_safe_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
begin
  if target_safe_code not in ('provider_cost_facts_unverified','provider_cost_changed','provider_cost_above_cap','provider_cost_above_net') then
    return false;
  end if;
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found or job.lease_owner is distinct from target_worker_id
    or job.lease_generation is distinct from target_lease_generation
    or job.lease_expires_at is null or job.lease_expires_at <= now() then return false; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found or order_row.status not in (
    'create_unknown','draft_created','quote_pending','confirm_unknown','confirmed','partial','fulfilled'
  ) then return false; end if;
  update private.printful_apparel_orders set
    provider_cost_exception_code = coalesce(provider_cost_exception_code, target_safe_code), updated_at = now()
    where id = target_order_id;
  return true;
end;
$$;
revoke all on function public.record_printful_apparel_post_confirm_cost_exception(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.record_printful_apparel_post_confirm_cost_exception(uuid, uuid, bigint, text) to service_role;

create or replace function public.record_printful_apparel_legacy_paid_resolution(
  target_checkout_intent_id uuid,
  target_session_id text,
  target_payment_intent_id text,
  target_amount_cents integer,
  target_currency text,
  target_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolution_id uuid;
  current_mode text;
  existing_resolution private.printful_apparel_legacy_payment_resolutions%rowtype;
begin
  select mode into current_mode from private.printful_apparel_sales_state where singleton for share;
  if current_mode is null or current_mode not in ('cutover', 'printful_apparel_only') then
    raise exception 'Printful-only cutover is not active' using errcode = 'P0001';
  end if;
  if target_session_id is null or target_session_id !~ '^cs_[A-Za-z0-9_]{8,240}$'
    or target_amount_cents is null or target_amount_cents not between 1 and 100000000
    or target_currency is null or lower(target_currency) <> 'usd'
    or target_payment_intent_id is not null and target_payment_intent_id !~ '^pi_[A-Za-z0-9_]{8,240}$'
    or target_reason_code is null
    or target_reason_code not in ('physical_paid_after_auto_only_cutover','legacy_physical_without_intent') then
    raise exception 'Invalid legacy payment resolution' using errcode = '22023';
  end if;
  select * into existing_resolution
    from private.printful_apparel_legacy_payment_resolutions
    where stripe_session_id = target_session_id for update;
  if found then
    if existing_resolution.checkout_intent_id is distinct from target_checkout_intent_id
      or existing_resolution.stripe_payment_intent_id is distinct from target_payment_intent_id
      or existing_resolution.amount_cents is distinct from target_amount_cents
      or existing_resolution.reason_code is distinct from target_reason_code then
      raise exception 'Legacy payment resolution identity conflict' using errcode = '23505';
    end if;
    return existing_resolution.id;
  end if;
  insert into private.printful_apparel_legacy_payment_resolutions (
    checkout_intent_id, stripe_session_id, stripe_payment_intent_id,
    amount_cents, currency, reason_code
  ) values (
    target_checkout_intent_id, target_session_id, target_payment_intent_id,
    target_amount_cents, 'usd', target_reason_code
  ) on conflict (stripe_session_id) do update set updated_at = now()
    where private.printful_apparel_legacy_payment_resolutions.checkout_intent_id is not distinct from excluded.checkout_intent_id
      and private.printful_apparel_legacy_payment_resolutions.stripe_payment_intent_id is not distinct from excluded.stripe_payment_intent_id
      and private.printful_apparel_legacy_payment_resolutions.amount_cents = excluded.amount_cents
      and private.printful_apparel_legacy_payment_resolutions.reason_code = excluded.reason_code
    returning id into resolution_id;
  if resolution_id is null then raise exception 'Legacy payment resolution identity conflict' using errcode = '23505'; end if;
  if target_checkout_intent_id is not null then
    update public.armory_checkout_intents set status = 'failed', updated_at = now()
      where id = target_checkout_intent_id and item_kind = 'product' and status = 'pending';
  end if;
  return resolution_id;
end;
$$;
revoke all on function public.record_printful_apparel_legacy_paid_resolution(uuid, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_printful_apparel_legacy_paid_resolution(uuid, text, text, integer, text, text) to service_role;

create or replace function public.get_printful_apparel_fulfillment_context(
  target_order_id uuid,
  target_worker_id uuid,
  target_lease_generation bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row private.printful_apparel_orders%rowtype;
  job private.printful_apparel_fulfillment_outbox%rowtype;
  product private.printful_catalog_products%rowtype;
  variant private.printful_catalog_variants%rowtype;
  approval private.printful_apparel_products%rowtype;
  sales private.printful_apparel_sales_state%rowtype;
begin
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for share;
  if not found or job.lease_owner is distinct from target_worker_id
    or job.lease_generation is distinct from target_lease_generation or job.lease_expires_at <= now() then return null; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for share;
  if not found then return null; end if;
  select * into product from private.printful_catalog_products where id = order_row.product_id for share;
  select * into variant from private.printful_catalog_variants where id = order_row.variant_id for share;
  select * into approval from private.printful_apparel_products where product_id = order_row.product_id for share;
  select * into sales from private.printful_apparel_sales_state where singleton for share;
  if not found then return null; end if;
  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', order_row.id, 'status', order_row.status, 'storeId', order_row.store_id,
      'productId', order_row.product_id, 'itemId', order_row.item_id, 'variantId', order_row.variant_id,
      'approvalVersion', order_row.approval_version, 'catalogRevision', order_row.catalog_revision,
      'externalProductId', order_row.external_product_id, 'syncVariantId', order_row.sync_variant_id,
      'catalogVariantId', order_row.catalog_variant_id,
      'providerExternalVariantId', order_row.provider_external_variant_id,
      'configurationFingerprint', order_row.configuration_fingerprint,
      'designIdentityFingerprint', order_row.design_identity_fingerprint,
      'providerExternalId', order_row.provider_external_id, 'providerOrderId', order_row.provider_order_id,
      'stripePaymentIntentId', order_row.stripe_payment_intent_id, 'stripePaidCents', order_row.stripe_paid_cents,
      'stripeNetRevenueCents', order_row.stripe_net_revenue_cents, 'stripeLivemode', order_row.stripe_livemode,
      'quoteTotalCents', order_row.quote_total_cents, 'finalQuoteTotalCents', order_row.final_quote_total_cents,
      'address', coalesce(order_row.final_stripe_address, order_row.quoted_address),
      'customerPriceCents', order_row.customer_price_cents
    ),
    'approval', jsonb_build_object(
      'enabled', approval.enabled, 'classification', approval.classification,
      'version', approval.approval_version
    ),
    'catalog', jsonb_build_object(
      'storeId', product.store_id, 'externalProductId', product.external_product_id,
      'revision', product.last_seen_revision, 'ignored', product.ignored,
      'variantId', variant.id, 'syncVariantId', variant.external_variant_id,
      'externalVariantId', variant.provider_external_id, 'catalogVariantId', variant.catalog_variant_id,
      'synced', variant.synced, 'ignoredVariant', variant.ignored,
      'availabilityStatus', variant.availability_status,
      'configurationFingerprint', variant.configuration_fingerprint,
      'configurationComplete', variant.configuration_complete
    ),
    'sales', jsonb_build_object('mode', sales.mode, 'fulfillmentEnabled', sales.fulfillment_enabled)
  );
end;
$$;
revoke all on function public.get_printful_apparel_fulfillment_context(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.get_printful_apparel_fulfillment_context(uuid, uuid, bigint) to service_role;

create or replace function public.defer_printful_apparel_fulfillment_job(
  target_order_id uuid,
  target_worker_id uuid,
  target_lease_generation bigint,
  target_safe_error_code text,
  target_delay_seconds integer,
  target_hold boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
begin
  select * into job from private.printful_apparel_fulfillment_outbox where order_id = target_order_id for update;
  if not found or job.lease_owner is distinct from target_worker_id
    or job.lease_generation is distinct from target_lease_generation or job.lease_expires_at <= now() then return false; end if;
  if target_delay_seconds not between 15 and 3600 or target_safe_error_code is null
    or target_safe_error_code !~ '^[a-z0-9_]{1,64}$' then raise exception 'Invalid retry instruction' using errcode = '22023'; end if;
  if target_hold then
    update private.printful_apparel_orders set status = 'resolution_hold',
      last_safe_error_code = target_safe_error_code, updated_at = now()
      where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set status = 'resolution_hold',
      lease_owner = null, lease_expires_at = null, next_attempt_at = now() + make_interval(secs => target_delay_seconds),
      updated_at = now() where order_id = target_order_id;
  else
    update private.printful_apparel_orders set last_safe_error_code = target_safe_error_code, updated_at = now()
      where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set lease_owner = null, lease_expires_at = null,
      next_attempt_at = now() + make_interval(secs => target_delay_seconds), updated_at = now()
      where order_id = target_order_id;
  end if;
  return true;
end;
$$;
revoke all on function public.defer_printful_apparel_fulfillment_job(uuid, uuid, bigint, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.defer_printful_apparel_fulfillment_job(uuid, uuid, bigint, text, integer, boolean) to service_role;

create or replace function public.hold_printful_apparel_refund(
  target_order_id uuid,
  target_session_id text,
  target_payment_intent_id text,
  target_event_id text,
  target_risk_type text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.printful_apparel_fulfillment_outbox%rowtype;
  order_row private.printful_apparel_orders%rowtype;
  existing_risk private.printful_apparel_payment_risk_holds%rowtype;
begin
  if target_order_id is null or target_session_id is null or target_session_id !~ '^cs_[A-Za-z0-9_]{8,240}$'
    or target_payment_intent_id is null or target_payment_intent_id !~ '^pi_[A-Za-z0-9_]{8,240}$'
    or target_event_id is null or target_event_id !~ '^evt_[A-Za-z0-9_]{8,240}$'
    or target_risk_type is null
    or target_risk_type not in ('refund','dispute') then return false; end if;
  select * into job from private.printful_apparel_fulfillment_outbox
    where order_id = target_order_id for update;
  if not found then return false; end if;
  select * into order_row from private.printful_apparel_orders where id = target_order_id for update;
  if not found then return false; end if;
  if order_row.stripe_session_id is null and order_row.status = 'quoted' then
    update private.printful_apparel_orders set stripe_session_id = target_session_id,
      status = 'checkout_open', updated_at = now()
      where id = target_order_id and stripe_session_id is null and status = 'quoted';
    if not found then return false; end if;
    order_row.stripe_session_id := target_session_id;
    order_row.status := 'checkout_open';
  end if;
  if order_row.stripe_session_id is distinct from target_session_id
    or order_row.stripe_payment_intent_id is not null and order_row.stripe_payment_intent_id is distinct from target_payment_intent_id then
    return false;
  end if;
  insert into private.printful_apparel_payment_risk_holds (
    event_id, order_id, stripe_session_id, stripe_payment_intent_id, risk_type
  ) values (target_event_id, target_order_id, target_session_id, target_payment_intent_id, target_risk_type)
  on conflict (event_id) do nothing;
  select * into existing_risk from private.printful_apparel_payment_risk_holds where event_id = target_event_id;
  if not found or existing_risk.order_id is distinct from target_order_id
    or existing_risk.stripe_session_id is distinct from target_session_id
    or existing_risk.stripe_payment_intent_id is distinct from target_payment_intent_id
    or existing_risk.risk_type is distinct from target_risk_type then return false; end if;
  if order_row.stripe_payment_intent_id is not null or order_row.stripe_paid_cents is not null then
    update private.printful_apparel_orders set status = 'resolution_hold',
      last_safe_error_code = 'stripe_payment_risk_requires_review', updated_at = now()
      where id = target_order_id;
    update private.printful_apparel_fulfillment_outbox set status = 'resolution_hold',
      lease_owner = null, lease_expires_at = null, next_attempt_at = now(), updated_at = now()
      where order_id = target_order_id;
  end if;
  return true;
end;
$$;
revoke all on function public.hold_printful_apparel_refund(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.hold_printful_apparel_refund(uuid, text, text, text, text) to service_role;

create or replace function public.get_printful_apparel_order_status(
  target_order_id uuid,
  target_status_token_sha256 text
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'status', case
      when order_row.status in ('fulfilled') then 'fulfilled'
      when order_row.status in ('partial') then 'partially_shipped'
      when order_row.status in ('confirmed') then 'processing'
      when order_row.status in ('refunded') then 'refunded'
      when order_row.status in ('definitive_unfulfilled','refund_pending','resolution_hold','test_mode_blocked') then 'review_required'
      when order_row.status in ('checkout_expired') then 'checkout_expired'
      else 'processing'
    end,
    'title', order_row.item_title,
    'variant', order_row.variant_label,
    'priceCents', order_row.customer_price_cents,
    'shippingCents', order_row.customer_shipping_cents,
    'currency', order_row.currency,
    'updatedAt', order_row.updated_at
  )
  from private.printful_apparel_orders order_row
  where order_row.id = target_order_id
    and target_status_token_sha256 ~ '^[0-9a-f]{64}$'
    and order_row.status_token_sha256 = target_status_token_sha256
    and order_row.status_token_expires_at > now()
$$;
revoke all on function public.get_printful_apparel_order_status(uuid, text) from public, anon, authenticated;
grant execute on function public.get_printful_apparel_order_status(uuid, text) to service_role;

create or replace function public.list_printful_apparel_admin_orders()
returns table (
  order_id uuid,
  order_status text,
  fulfillment_status text,
  provider_status text,
  safe_error_code text,
  provider_cost_exception_code text,
  updated_at timestamptz,
  retry_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select order_row.id,
    order_row.status,
    job.status,
    case when order_row.provider_status in ('draft','failed','inreview','pending','onhold','inprocess','partial','fulfilled','canceled')
      then order_row.provider_status else null end,
    case when order_row.last_safe_error_code ~ '^[a-z0-9_]{1,80}$' then order_row.last_safe_error_code else null end,
    order_row.provider_cost_exception_code,
    order_row.updated_at,
    job.next_attempt_at
  from private.printful_apparel_orders order_row
  join private.printful_apparel_fulfillment_outbox job on job.order_id = order_row.id
  order by order_row.updated_at desc, order_row.id desc
  limit 50;
$$;
revoke all on function public.list_printful_apparel_admin_orders() from public, anon, authenticated;
grant execute on function public.list_printful_apparel_admin_orders() to service_role;
