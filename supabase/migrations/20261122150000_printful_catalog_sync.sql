-- Private, read-only Printful catalog staging. This migration never creates orders or calls Printful.
create or replace function private.valid_printful_catalog_id(target text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if target is null or target !~ '^[1-9][0-9]{0,18}$' then return false; end if;
  return target::numeric <= 9223372036854775807;
exception when others then
  return false;
end;
$$;
revoke all on function private.valid_printful_catalog_id(text) from public, anon, authenticated;

create table private.printful_catalog_sync_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0),
  last_product_count integer not null default 0 check (last_product_count between 0 and 500),
  last_page_count integer not null default 0 check (last_page_count between 0 and 10),
  last_read_started_at timestamptz,
  last_read_completed_at timestamptz,
  last_observed_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.printful_catalog_sync_state (singleton) values (true);

create table private.printful_catalog_products (
  id uuid primary key default gen_random_uuid(),
  store_id text not null check (store_id = '19050731'),
  external_product_id text not null check (private.valid_printful_catalog_id(external_product_id)),
  provider_name text not null check (char_length(provider_name) between 1 and 200),
  ignored boolean,
  observed_variant_count smallint not null default 0 check (observed_variant_count between 0 and 100),
  synced_variant_count smallint not null default 0 check (synced_variant_count between 0 and 100),
  last_seen_revision bigint not null check (last_seen_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, external_product_id)
);

create table private.printful_catalog_variants (
  id uuid primary key default gen_random_uuid(),
  store_id text not null check (store_id = '19050731'),
  product_id uuid not null references private.printful_catalog_products(id) on delete restrict,
  external_variant_id text not null check (private.valid_printful_catalog_id(external_variant_id)),
  provider_external_id text check (provider_external_id is null or char_length(provider_external_id) between 1 and 128),
  catalog_variant_id text check (catalog_variant_id is null or private.valid_printful_catalog_id(catalog_variant_id)),
  provider_name text not null check (char_length(provider_name) between 1 and 200),
  color text check (color is null or char_length(color) <= 80),
  size text check (size is null or char_length(size) <= 80),
  synced boolean not null,
  ignored boolean,
  availability_status text check (availability_status is null or char_length(availability_status) <= 64),
  available boolean not null default false,
  configuration_fingerprint text not null check (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
  configuration_complete boolean not null,
  placement_types text[] not null default '{}',
  option_names text[] not null default '{}',
  production_cost_min_cents integer check (production_cost_min_cents between 0 and 10000000),
  production_cost_max_cents integer check (production_cost_max_cents between 0 and 10000000),
  production_cost_currency text check (production_cost_currency is null or production_cost_currency = 'USD'),
  production_cost_source text check (production_cost_source is null or production_cost_source = 'admin-reviewed-printful-ui'),
  production_cost_raw_price text check (production_cost_raw_price is null or char_length(production_cost_raw_price) between 1 and 64),
  production_cost_observed_at timestamptz,
  production_cost_configuration_fingerprint text check (
    production_cost_configuration_fingerprint is null or production_cost_configuration_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  production_cost_evidence_sha256 text check (production_cost_evidence_sha256 is null or production_cost_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  -- Historical reviewer identity is audit text, not a deletion-blocking FK.
  production_cost_reviewed_by uuid,
  last_seen_revision bigint not null check (last_seen_revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, external_variant_id),
  check ((production_cost_min_cents is null) = (production_cost_max_cents is null)),
  check (
    (production_cost_min_cents is null and production_cost_currency is null
      and production_cost_source is null and production_cost_observed_at is null
      and production_cost_raw_price is null
      and production_cost_configuration_fingerprint is null
      and production_cost_evidence_sha256 is null and production_cost_reviewed_by is null)
    or
    (production_cost_min_cents is not null and production_cost_max_cents is not null
      and production_cost_min_cents <= production_cost_max_cents
      and production_cost_currency = 'USD'
      and production_cost_source = 'admin-reviewed-printful-ui'
      and production_cost_raw_price is not null
      and production_cost_observed_at is not null
      and production_cost_configuration_fingerprint is not null
      and production_cost_evidence_sha256 is not null
      and production_cost_reviewed_by is not null)
  )
);
create index printful_catalog_variants_product_idx on private.printful_catalog_variants (product_id, size, color);

create table private.printful_managed_items (
  -- Permanent origin tombstone. It deliberately has no profile or Armory FK.
  item_id uuid primary key,
  product_id uuid not null unique references private.printful_catalog_products(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table private.printful_armory_drafts (
  item_id uuid primary key references private.printful_managed_items(item_id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  image_path text,
  price_cents integer not null check (price_cents between 100 and 10000000),
  shipping_cents integer not null default 0 check (shipping_cents between 0 and 100000),
  sizes text[] not null check (cardinality(sizes) between 1 and 20),
  visible_to_all boolean not null default false,
  curation_approved_at timestamptz,
  curation_approved_by uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (image_path is null or (image_path ~ '^[0-9a-f-]{36}/[-[:alnum:]_.]{1,200}$'))
);

-- RPC-only, transaction-scoped permission consumed by the Armory trigger.
create table private.printful_armory_write_permits (
  item_id uuid primary key,
  transaction_id bigint not null,
  created_at timestamptz not null default now()
);

create table private.printful_cost_review_sessions (
  id uuid primary key default gen_random_uuid(),
  -- A completed audit may outlive its reviewer; unfinished sessions are removed on profile deletion.
  reviewer_id uuid not null,
  base_revision bigint not null check (base_revision >= 1),
  started_at timestamptz not null default now(),
  review_snapshot jsonb not null,
  completed_at timestamptz,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  check ((completed_at is null) = (evidence_sha256 is null))
);

revoke all on private.printful_catalog_sync_state, private.printful_catalog_products,
  private.printful_catalog_variants, private.printful_managed_items,
  private.printful_armory_drafts, private.printful_armory_write_permits,
  private.printful_cost_review_sessions
  from public, anon, authenticated, service_role;

create or replace function private.prevent_printful_completed_cost_review_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.completed_at is not null then
    raise exception 'Completed Printful cost evidence is immutable' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.prevent_printful_completed_cost_review_mutation() from public, anon, authenticated, service_role;
create trigger printful_completed_cost_review_immutable
before update or delete on private.printful_cost_review_sessions
for each row execute function private.prevent_printful_completed_cost_review_mutation();

create or replace function private.cleanup_printful_profile_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.printful_cost_review_sessions
  where reviewer_id = old.id and completed_at is null;
  return old;
end;
$$;
revoke all on function private.cleanup_printful_profile_before_delete() from public, anon, authenticated, service_role;
create trigger printful_profile_delete_cleanup
before delete on public.profiles
for each row execute function private.cleanup_printful_profile_before_delete();

create or replace function public.get_printful_catalog_sync_revision()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select revision from private.printful_catalog_sync_state where singleton
$$;
revoke all on function public.get_printful_catalog_sync_revision() from public, anon, authenticated;
grant execute on function public.get_printful_catalog_sync_revision() to service_role;

create or replace function public.apply_printful_catalog_snapshot(
  target_expected_revision bigint,
  target_snapshot jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  next_revision bigint;
  snapshot_read_started_at timestamptz;
  snapshot_read_completed_at timestamptz;
  product_count integer;
  distinct_product_count integer;
  variant_total integer;
  distinct_variant_total integer;
  product_entry jsonb;
  variant_entry jsonb;
  current_product_local_id uuid;
  product_external_id text;
  variant_external_id text;
  product_variant_ids text[];
  all_variant_ids text[] := array[]::text[];
  product_synced_count integer;
  actual_synced_count integer;
  product_ignored boolean;
begin
  if target_expected_revision is null or target_expected_revision < 0
    or target_snapshot is null or pg_column_size(target_snapshot) > 10485760
    or jsonb_typeof(target_snapshot) is distinct from 'object'
    or target_snapshot ->> 'storeId' is distinct from '19050731'
    or target_snapshot ->> 'completeness' is distinct from 'consistent_paginated_read'
    or target_snapshot -> 'atomicProviderSnapshotProven' is distinct from 'false'::jsonb
    or jsonb_typeof(target_snapshot -> 'products') is distinct from 'array'
    or jsonb_typeof(target_snapshot -> 'listTotal') is distinct from 'number'
    or coalesce(target_snapshot ->> 'listTotal', '') !~ '^(0|[1-9][0-9]{0,2})$'
    or jsonb_typeof(target_snapshot -> 'pageCount') is distinct from 'number'
    or coalesce(target_snapshot ->> 'pageCount', '') !~ '^[1-9][0-9]?$'
    or coalesce(target_snapshot ->> 'pageCount', '') not in ('1','2','3','4','5','6','7','8','9','10')
    or jsonb_typeof(target_snapshot -> 'readStartedAt') is distinct from 'string'
    or jsonb_typeof(target_snapshot -> 'readCompletedAt') is distinct from 'string'
  then
    raise exception 'Invalid Printful catalog snapshot' using errcode = '22023';
  end if;

  product_count := jsonb_array_length(target_snapshot -> 'products');
  if product_count > 500 or product_count <> (target_snapshot ->> 'listTotal')::integer then
    raise exception 'Incomplete Printful product list' using errcode = '22023';
  end if;
  select count(*), count(distinct value ->> 'syncProductId')
    into product_count, distinct_product_count
  from jsonb_array_elements(target_snapshot -> 'products') as products(value);
  if product_count <> distinct_product_count then
    raise exception 'Duplicate Printful product identity' using errcode = '22023';
  end if;

  variant_total := 0;
  for product_entry in select value from jsonb_array_elements(target_snapshot -> 'products') as products(value) loop
    if jsonb_typeof(product_entry) is distinct from 'object'
      or jsonb_typeof(product_entry -> 'syncProductId') is distinct from 'string'
      or not private.valid_printful_catalog_id(product_entry ->> 'syncProductId')
      or jsonb_typeof(product_entry -> 'name') is distinct from 'string'
      or char_length(product_entry ->> 'name') not between 1 and 200
      or (jsonb_typeof(product_entry -> 'ignored') is distinct from 'boolean'
        and jsonb_typeof(product_entry -> 'ignored') is distinct from 'null')
      or jsonb_typeof(product_entry -> 'syncedVariantCount') is distinct from 'number'
      or coalesce(product_entry ->> 'syncedVariantCount', '') !~ '^(0|[1-9][0-9]{0,2})$'
      or jsonb_typeof(product_entry -> 'variants') is distinct from 'array'
      or jsonb_array_length(product_entry -> 'variants') > 100
    then
      raise exception 'Invalid Printful product detail' using errcode = '22023';
    end if;

    product_external_id := product_entry ->> 'syncProductId';
    product_ignored := case when jsonb_typeof(product_entry -> 'ignored') = 'boolean'
      then (product_entry ->> 'ignored')::boolean else null end;
    product_variant_ids := array[]::text[];
    product_synced_count := (product_entry ->> 'syncedVariantCount')::integer;
    actual_synced_count := 0;
    for variant_entry in select value from jsonb_array_elements(product_entry -> 'variants') as variants(value) loop
      variant_external_id := variant_entry ->> 'syncVariantId';
      if jsonb_typeof(variant_entry) is distinct from 'object'
        or jsonb_typeof(variant_entry -> 'syncVariantId') is distinct from 'string'
        or not private.valid_printful_catalog_id(variant_external_id)
        or (jsonb_typeof(variant_entry -> 'externalId') is distinct from 'string'
          and jsonb_typeof(variant_entry -> 'externalId') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'externalId') = 'string' and char_length(variant_entry ->> 'externalId') not between 1 and 128)
        or (jsonb_typeof(variant_entry -> 'catalogVariantId') is distinct from 'string'
          and jsonb_typeof(variant_entry -> 'catalogVariantId') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'catalogVariantId') = 'string' and not private.valid_printful_catalog_id(variant_entry ->> 'catalogVariantId'))
        or jsonb_typeof(variant_entry -> 'name') is distinct from 'string'
        or char_length(variant_entry ->> 'name') not between 1 and 200
        or (jsonb_typeof(variant_entry -> 'color') is distinct from 'string'
          and jsonb_typeof(variant_entry -> 'color') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'color') = 'string' and char_length(variant_entry ->> 'color') > 80)
        or (jsonb_typeof(variant_entry -> 'size') is distinct from 'string'
          and jsonb_typeof(variant_entry -> 'size') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'size') = 'string' and char_length(variant_entry ->> 'size') > 80)
        or jsonb_typeof(variant_entry -> 'synced') is distinct from 'boolean'
        or (jsonb_typeof(variant_entry -> 'ignored') is distinct from 'boolean'
          and jsonb_typeof(variant_entry -> 'ignored') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'availabilityStatus') is distinct from 'string'
          and jsonb_typeof(variant_entry -> 'availabilityStatus') is distinct from 'null')
        or (jsonb_typeof(variant_entry -> 'availabilityStatus') = 'string' and char_length(variant_entry ->> 'availabilityStatus') > 64)
        or jsonb_typeof(variant_entry -> 'configurationFingerprint') is distinct from 'string'
        or (variant_entry ->> 'configurationFingerprint') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(variant_entry -> 'configurationComplete') is distinct from 'boolean'
        or jsonb_typeof(variant_entry -> 'placementTypes') is distinct from 'array'
        or jsonb_typeof(variant_entry -> 'optionNames') is distinct from 'array'
        or jsonb_array_length(variant_entry -> 'placementTypes') > 16
        or jsonb_array_length(variant_entry -> 'optionNames') > 64
        or variant_external_id = any(product_variant_ids)
        or variant_external_id = any(all_variant_ids)
      then
        raise exception 'Invalid or duplicate Printful variant identity' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(variant_entry -> 'placementTypes') as values(value)
        where char_length(value) not between 1 and 100
      ) or exists (
        select 1 from jsonb_array_elements_text(variant_entry -> 'optionNames') as values(value)
        where char_length(value) not between 1 and 100
      ) then
        raise exception 'Invalid Printful configuration labels' using errcode = '22023';
      end if;
      product_variant_ids := array_append(product_variant_ids, variant_external_id);
      all_variant_ids := array_append(all_variant_ids, variant_external_id);
      variant_total := variant_total + 1;
      if (variant_entry ->> 'synced')::boolean then actual_synced_count := actual_synced_count + 1; end if;
    end loop;
    if product_synced_count <> actual_synced_count then
      raise exception 'Printful synced-variant count mismatch' using errcode = '22023';
    end if;
  end loop;
  if variant_total > 50000 then
    raise exception 'Printful catalog exceeds the supported variant bound' using errcode = '22023';
  end if;

  begin
    snapshot_read_started_at := (target_snapshot ->> 'readStartedAt')::timestamptz;
    snapshot_read_completed_at := (target_snapshot ->> 'readCompletedAt')::timestamptz;
  exception when others then
    raise exception 'Invalid Printful observation timestamps' using errcode = '22023';
  end;
  if snapshot_read_started_at is null or snapshot_read_completed_at is null
    or snapshot_read_started_at > snapshot_read_completed_at
    or (target_snapshot ->> 'observedAt')::timestamptz is distinct from snapshot_read_completed_at
  then
    raise exception 'Inconsistent Printful observation interval' using errcode = '22023';
  end if;

  select revision into current_revision
  from private.printful_catalog_sync_state
  where singleton
  for update;
  if current_revision is distinct from target_expected_revision then
    raise exception 'Stale Printful catalog read' using errcode = '40001';
  end if;
  next_revision := current_revision + 1;

  if exists (
    select 1
    from jsonb_array_elements(target_snapshot -> 'products') as incoming(product)
    join jsonb_array_elements(incoming.product -> 'variants') as incoming_variant(variant) on true
    join private.printful_catalog_variants existing
      on existing.store_id = '19050731'
      and existing.external_variant_id = incoming_variant.variant ->> 'syncVariantId'
    join private.printful_catalog_products existing_product on existing_product.id = existing.product_id
    where existing_product.external_product_id <> incoming.product ->> 'syncProductId'
  ) then
    raise exception 'Printful variant cannot move to another product' using errcode = '23505';
  end if;

  for product_entry in select value from jsonb_array_elements(target_snapshot -> 'products') as products(value) loop
    product_external_id := product_entry ->> 'syncProductId';
    product_ignored := case when jsonb_typeof(product_entry -> 'ignored') = 'boolean'
      then (product_entry ->> 'ignored')::boolean else null end;
    insert into private.printful_catalog_products (
      store_id, external_product_id, provider_name, ignored, observed_variant_count, synced_variant_count, last_seen_revision
    ) values (
      '19050731', product_external_id, product_entry ->> 'name', product_ignored,
      jsonb_array_length(product_entry -> 'variants')::smallint,
      (product_entry ->> 'syncedVariantCount')::smallint, next_revision
    )
    on conflict (store_id, external_product_id) do update set
      provider_name = excluded.provider_name,
      ignored = excluded.ignored,
      observed_variant_count = excluded.observed_variant_count,
      synced_variant_count = excluded.synced_variant_count,
      last_seen_revision = excluded.last_seen_revision,
      updated_at = now()
    returning id into current_product_local_id;

    product_variant_ids := array[]::text[];
    for variant_entry in select value from jsonb_array_elements(product_entry -> 'variants') as variants(value) loop
      variant_external_id := variant_entry ->> 'syncVariantId';
      product_variant_ids := array_append(product_variant_ids, variant_external_id);
      insert into private.printful_catalog_variants (
        store_id, product_id, external_variant_id, provider_external_id, catalog_variant_id,
        provider_name, color, size, synced, ignored, availability_status, available,
        configuration_fingerprint, configuration_complete, placement_types, option_names, last_seen_revision
      ) values (
        '19050731', current_product_local_id, variant_external_id, nullif(variant_entry ->> 'externalId', ''),
        nullif(variant_entry ->> 'catalogVariantId', ''), variant_entry ->> 'name',
        nullif(variant_entry ->> 'color', ''), nullif(variant_entry ->> 'size', ''),
        (variant_entry ->> 'synced')::boolean,
        case when jsonb_typeof(variant_entry -> 'ignored') = 'boolean' then (variant_entry ->> 'ignored')::boolean else null end,
        nullif(variant_entry ->> 'availabilityStatus', ''),
        (variant_entry ->> 'synced')::boolean
          and (variant_entry -> 'ignored') = 'false'::jsonb
          and variant_entry ->> 'availabilityStatus' = 'active'
          and jsonb_typeof(variant_entry -> 'catalogVariantId') = 'string',
        variant_entry ->> 'configurationFingerprint', (variant_entry ->> 'configurationComplete')::boolean,
        array(select jsonb_array_elements_text(variant_entry -> 'placementTypes')),
        array(select jsonb_array_elements_text(variant_entry -> 'optionNames')), next_revision
      )
      on conflict (store_id, external_variant_id) do update set
        product_id = excluded.product_id,
        provider_external_id = excluded.provider_external_id,
        catalog_variant_id = excluded.catalog_variant_id,
        provider_name = excluded.provider_name,
        color = excluded.color,
        size = excluded.size,
        synced = excluded.synced,
        ignored = excluded.ignored,
        availability_status = excluded.availability_status,
        available = excluded.available,
        production_cost_min_cents = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_min_cents else null end,
        production_cost_max_cents = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_max_cents else null end,
        production_cost_currency = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_currency else null end,
        production_cost_source = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_source else null end,
        production_cost_raw_price = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_raw_price else null end,
        production_cost_observed_at = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_observed_at else null end,
        production_cost_configuration_fingerprint = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_configuration_fingerprint else null end,
        production_cost_evidence_sha256 = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_evidence_sha256 else null end,
        production_cost_reviewed_by = case
          when private.printful_catalog_variants.configuration_fingerprint = excluded.configuration_fingerprint
            and private.printful_catalog_variants.provider_external_id is not distinct from excluded.provider_external_id
          then private.printful_catalog_variants.production_cost_reviewed_by else null end,
        configuration_fingerprint = excluded.configuration_fingerprint,
        configuration_complete = excluded.configuration_complete,
        placement_types = excluded.placement_types,
        option_names = excluded.option_names,
        last_seen_revision = excluded.last_seen_revision,
        updated_at = now();
    end loop;

    update private.printful_catalog_variants
    set available = false, availability_status = 'missing', updated_at = now()
    where product_id = current_product_local_id
      and not (external_variant_id = any(product_variant_ids));
  end loop;

  update private.printful_catalog_sync_state
  set revision = next_revision,
      last_product_count = product_count,
      last_page_count = (target_snapshot ->> 'pageCount')::integer,
      last_read_started_at = snapshot_read_started_at,
      last_read_completed_at = snapshot_read_completed_at,
      last_observed_at = snapshot_read_completed_at,
      updated_at = now()
  where singleton;
  return next_revision;
end;
$$;
revoke all on function public.apply_printful_catalog_snapshot(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.apply_printful_catalog_snapshot(bigint, jsonb) to service_role;

create or replace function private.printful_catalog_snapshot_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with state as (
    select revision, last_product_count, last_page_count, last_read_started_at, last_read_completed_at, last_observed_at
    from private.printful_catalog_sync_state where singleton
  ), products as (
    select p.external_product_id, jsonb_build_object(
      'syncProductId', p.external_product_id,
      'name', p.provider_name,
      'ignored', p.ignored,
      'syncedVariantCount', p.synced_variant_count,
      'variants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'localVariantId', v.id,
          'syncVariantId', v.external_variant_id,
          'externalId', v.provider_external_id,
          'catalogVariantId', v.catalog_variant_id,
          'name', v.provider_name,
          'color', v.color,
          'size', v.size,
          'synced', v.synced,
          'ignored', v.ignored,
          'availabilityStatus', v.availability_status,
          'configurationFingerprint', v.configuration_fingerprint,
          'configurationComplete', v.configuration_complete,
          'placementTypes', to_jsonb(v.placement_types),
          'optionNames', to_jsonb(v.option_names)
        ) order by v.external_variant_id)
        from private.printful_catalog_variants v
        where v.product_id = p.id and v.last_seen_revision = s.revision
      ), '[]'::jsonb)
    ) as product
    from private.printful_catalog_products p
    cross join state s
    where p.last_seen_revision = s.revision
  )
  select jsonb_build_object(
    'storeId', '19050731',
    'storeName', 'GYMX2',
    'storeType', 'native',
    'completeness', 'consistent_paginated_read',
    'atomicProviderSnapshotProven', false,
    'listTotal', s.last_product_count,
    'pageCount', s.last_page_count,
    'readStartedAt', s.last_read_started_at,
    'readCompletedAt', s.last_read_completed_at,
    'observedAt', s.last_observed_at,
    'products', coalesce(jsonb_agg(p.product order by p.external_product_id) filter (where p.product is not null), '[]'::jsonb)
  )
  from state s left join products p on true
  group by s.revision, s.last_product_count, s.last_page_count, s.last_read_started_at, s.last_read_completed_at, s.last_observed_at
$$;
revoke all on function private.printful_catalog_snapshot_json() from public, anon, authenticated, service_role;

create or replace function public.get_printful_catalog_server_snapshot()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.printful_catalog_snapshot_json()
$$;
revoke all on function public.get_printful_catalog_server_snapshot() from public, anon, authenticated;
grant execute on function public.get_printful_catalog_server_snapshot() to service_role;

create or replace function public.get_printful_catalog_admin_snapshot()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with state as (
    select revision, last_product_count, last_page_count, last_observed_at
    from private.printful_catalog_sync_state where singleton
  ), products as (
    select p.id, p.provider_name, p.ignored, p.last_seen_revision,
      p.observed_variant_count, p.synced_variant_count,
      draft.item_id, draft.title as imported_title, draft.description as imported_description,
      draft.image_path as imported_image_path, draft.price_cents as imported_price_cents,
      draft.shipping_cents as imported_shipping_cents, draft.visible_to_all as imported_visible_to_all,
      (item.id is not null) as imported_published,
      (select count(*) from private.printful_catalog_variants current_variant
        where current_variant.product_id = p.id and current_variant.last_seen_revision = s.revision) as current_variant_count,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'localVariantId', v.id,
          'name', v.provider_name,
          'color', v.color,
          'size', v.size,
          'synced', v.synced,
          'ignored', v.ignored,
          'availabilityStatus', v.availability_status,
          'available', v.available,
          'lastSeen', v.last_seen_revision = s.revision,
          'configurationComplete', v.configuration_complete,
          'productionCostMinCents', v.production_cost_min_cents,
          'productionCostMaxCents', v.production_cost_max_cents,
          'productionCostCurrency', v.production_cost_currency,
          'productionCostSource', v.production_cost_source,
          'productionCostObservedAt', v.production_cost_observed_at,
          'productionCostRawPrice', v.production_cost_raw_price,
          'productionCostFresh', v.production_cost_observed_at >= now() - interval '24 hours'
            and v.production_cost_observed_at <= now()
            and v.production_cost_configuration_fingerprint = v.configuration_fingerprint
        ) order by v.provider_name, v.color nulls first, v.size nulls first, v.id)
        from private.printful_catalog_variants v where v.product_id = p.id
      ), '[]'::jsonb) as variants
    from private.printful_catalog_products p
    cross join state s
    left join private.printful_managed_items m on m.product_id = p.id
    left join private.printful_armory_drafts draft on draft.item_id = m.item_id
    left join public.armory_items item on item.id = draft.item_id
  )
  select jsonb_build_object(
    'revision', s.revision,
    'observedAt', s.last_observed_at,
    'productCount', s.last_product_count,
    'pageCount', s.last_page_count,
    'products', coalesce(jsonb_agg(jsonb_build_object(
      'localProductId', p.id,
      'name', p.provider_name,
      'ignored', p.ignored,
      'seenInLatestRead', p.last_seen_revision = s.revision,
      'importedArmoryItemId', p.item_id,
      'importedPublished', p.imported_published,
      'importedTitle', p.imported_title,
      'importedDescription', p.imported_description,
      'importedImagePath', p.imported_image_path,
      'importedPriceCents', p.imported_price_cents,
      'importedShippingCents', p.imported_shipping_cents,
      'importedVisibleToAll', p.imported_visible_to_all,
      'variants', p.variants,
      'canImport', p.last_seen_revision = s.revision
        and p.current_variant_count between 1 and 20
        and p.current_variant_count = p.observed_variant_count
        and p.synced_variant_count = p.observed_variant_count
        and jsonb_array_length(p.variants) >= p.current_variant_count
        and not p.ignored
        and not exists (
          select 1 from private.printful_catalog_variants current_variant
          where current_variant.product_id = p.id and current_variant.last_seen_revision = s.revision
            and (not current_variant.synced
            or current_variant.ignored is distinct from false
            or current_variant.catalog_variant_id is null
            or not current_variant.configuration_complete
            or current_variant.production_cost_min_cents is null
            or current_variant.production_cost_min_cents <> current_variant.production_cost_max_cents
            or current_variant.production_cost_currency <> 'USD'
            or current_variant.production_cost_source <> 'admin-reviewed-printful-ui'
            or current_variant.production_cost_observed_at < now() - interval '24 hours'
            or current_variant.production_cost_observed_at > now()
            or current_variant.production_cost_configuration_fingerprint <> current_variant.configuration_fingerprint)
        )
    ) order by p.provider_name, p.id) filter (where p.id is not null), '[]'::jsonb)
  )
  from state s left join products p on true
  group by s.revision, s.last_observed_at, s.last_product_count, s.last_page_count
$$;
revoke all on function public.get_printful_catalog_admin_snapshot() from public, anon, authenticated;
grant execute on function public.get_printful_catalog_admin_snapshot() to service_role;

create or replace function public.begin_printful_ui_cost_review(target_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  snapshot_value jsonb;
  session_id uuid;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select revision into current_revision from private.printful_catalog_sync_state where singleton;
  snapshot_value := private.printful_catalog_snapshot_json();
  if current_revision < 1 or snapshot_value ->> 'observedAt' is null
    or jsonb_array_length(snapshot_value -> 'products') <> (snapshot_value ->> 'listTotal')::integer
  then
    raise exception 'A complete current Printful read is required first' using errcode = 'P0001';
  end if;
  insert into private.printful_cost_review_sessions (reviewer_id, base_revision, review_snapshot)
  values (target_admin_id, current_revision, snapshot_value)
  returning id into session_id;
  return session_id;
end;
$$;
revoke all on function public.begin_printful_ui_cost_review(uuid) from public, anon, authenticated;
grant execute on function public.begin_printful_ui_cost_review(uuid) to service_role;

create or replace function public.get_printful_ui_cost_review_context(target_session_id uuid, target_admin_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  review private.printful_cost_review_sessions%rowtype;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into review from private.printful_cost_review_sessions
  where id = target_session_id and reviewer_id = target_admin_id;
  if not found or review.completed_at is not null or review.started_at < now() - interval '24 hours' then
    raise exception 'Cost review session is unavailable' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'startedAt', review.started_at,
    'baseRevision', review.base_revision,
    'snapshot', review.review_snapshot
  );
end;
$$;
revoke all on function public.get_printful_ui_cost_review_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_printful_ui_cost_review_context(uuid, uuid) to service_role;

create or replace function public.apply_printful_ui_cost_evidence(
  target_session_id uuid,
  target_admin_id uuid,
  target_expected_revision bigint,
  target_evidence jsonb,
  target_costs jsonb,
  target_evidence_sha256 text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  review private.printful_cost_review_sessions%rowtype;
  current_revision bigint;
  current_read_started_at timestamptz;
  current_read_completed_at timestamptz;
  observed_at timestamptz;
  product_entry jsonb;
  selected_id text;
  row_entry jsonb;
  cost_entry jsonb;
  variant_snapshot jsonb;
  current_variant private.printful_catalog_variants%rowtype;
  v_external_product_id text;
  v_external_variant_id text;
  v_external_id text;
  v_raw_price text;
  price_parts text[];
  expected_min integer;
  expected_max integer;
  applied_count integer := 0;
  expected_count integer := 0;
  seen_variant_keys text[] := array[]::text[];
  seen_product_ids text[] := array[]::text[];
  selected_count integer;
  unique_selected_count integer;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_evidence_sha256 is null or target_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or target_evidence is null or jsonb_typeof(target_evidence) is distinct from 'object'
    or target_costs is null or jsonb_typeof(target_costs) is distinct from 'array'
  then
    raise exception 'Invalid Printful UI cost evidence' using errcode = '22023';
  end if;

  select * into review from private.printful_cost_review_sessions
  where id = target_session_id and reviewer_id = target_admin_id
  for update;
  if not found or review.completed_at is not null or review.started_at < now() - interval '24 hours' then
    raise exception 'Cost review session is unavailable' using errcode = 'P0001';
  end if;
  select revision, last_read_started_at, last_read_completed_at
    into current_revision, current_read_started_at, current_read_completed_at
  from private.printful_catalog_sync_state where singleton for update;
  if current_revision is distinct from target_expected_revision then
    raise exception 'Printful catalog changed during cost review' using errcode = '40001';
  end if;
  if target_evidence ->> 'source' is distinct from 'official_printful_ui_edit_retail_prices'
    or target_evidence ->> 'storeId' is distinct from '19050731'
    or target_evidence ->> 'currency' is distinct from 'USD'
    or coalesce(target_evidence ->> 'currencyContext', '') not like 'USD%'
    or target_evidence -> 'readOnly' is distinct from 'true'::jsonb
    or target_evidence -> 'priceChangesSaved' is distinct from 'false'::jsonb
    or jsonb_typeof(target_evidence -> 'observedAt') is distinct from 'string'
    or jsonb_typeof(target_evidence -> 'products') is distinct from 'array'
    or jsonb_array_length(target_evidence -> 'products') = 0
  then
    raise exception 'UI evidence source, store, or currency is not verified' using errcode = '22023';
  end if;
  begin
    observed_at := (target_evidence ->> 'observedAt')::timestamptz;
  exception when others then
    raise exception 'Invalid UI observation timestamp' using errcode = '22023';
  end;
  if observed_at > now() or observed_at < now() - interval '24 hours'
    or observed_at < review.started_at
  then
    raise exception 'UI cost evidence is outside the review window' using errcode = '22023';
  end if;
  if review.review_snapshot ->> 'readCompletedAt' is null
    or current_read_started_at is null or current_read_completed_at is null
    or observed_at < (review.review_snapshot ->> 'readCompletedAt')::timestamptz
    or observed_at > current_read_started_at
    or current_read_started_at > current_read_completed_at
    or observed_at < (review.review_snapshot ->> 'observedAt')::timestamptz
    or observed_at > current_read_completed_at
    or jsonb_array_length(target_evidence -> 'products') > jsonb_array_length(review.review_snapshot -> 'products')
    or jsonb_array_length(target_costs) > 50000
  then
    raise exception 'UI evidence does not cover the reviewed catalog read' using errcode = '22023';
  end if;

  for product_entry in select value from jsonb_array_elements(target_evidence -> 'products') as products(value) loop
    v_external_product_id := product_entry ->> 'syncProductId';
    if jsonb_typeof(product_entry) is distinct from 'object'
      or not private.valid_printful_catalog_id(v_external_product_id)
      or jsonb_typeof(product_entry -> 'selectedSyncVariantIds') is distinct from 'array'
      or jsonb_typeof(product_entry -> 'priceRows') is distinct from 'array'
      or jsonb_array_length(product_entry -> 'selectedSyncVariantIds') <> jsonb_array_length(product_entry -> 'priceRows')
    then
      raise exception 'Incomplete UI product evidence' using errcode = '22023';
    end if;
    if v_external_product_id = any(seen_product_ids) then
      raise exception 'Duplicate UI product evidence' using errcode = '22023';
    end if;
    seen_product_ids := array_append(seen_product_ids, v_external_product_id);
    select value into variant_snapshot
    from jsonb_array_elements(review.review_snapshot -> 'products') as before_products(value)
    where value ->> 'syncProductId' = v_external_product_id;
    if variant_snapshot is null then
      raise exception 'UI evidence product is not in the reviewed snapshot' using errcode = '22023';
    end if;
    select count(*), count(distinct value)
      into selected_count, unique_selected_count
    from jsonb_array_elements_text(product_entry -> 'selectedSyncVariantIds') as ids(value);
    if selected_count = 0 or selected_count <> unique_selected_count
      or selected_count <> jsonb_array_length(variant_snapshot -> 'variants')
    then
      raise exception 'UI selected variant set is incomplete or ambiguous' using errcode = '22023';
    end if;
    expected_count := expected_count + selected_count;
    for selected_id in select value from jsonb_array_elements_text(product_entry -> 'selectedSyncVariantIds') as ids(value) loop
      if not private.valid_printful_catalog_id(selected_id)
        or not exists (
          select 1 from jsonb_array_elements(variant_snapshot -> 'variants') as before_variants(value)
          where value ->> 'syncVariantId' = selected_id
        )
      then
        raise exception 'Selected UI variant is not in the reviewed snapshot' using errcode = '22023';
      end if;
    end loop;

    for row_entry in select value from jsonb_array_elements(product_entry -> 'priceRows') as rows(value) loop
      v_external_id := row_entry ->> 'externalId';
      v_raw_price := row_entry ->> 'printfulPrice';
      if jsonb_typeof(row_entry) is distinct from 'object'
        or v_external_id is null or char_length(v_external_id) not between 1 and 128
        or v_raw_price !~ E'^\\$[0-9]{1,8}\\.[0-9]{2}(\\s*(?:-|–|—)\\s*\\$[0-9]{1,8}\\.[0-9]{2})?$'
      then
        raise exception 'Invalid UI price row' using errcode = '22023';
      end if;
      select value into variant_snapshot
      from jsonb_array_elements((
        select value -> 'variants' from jsonb_array_elements(review.review_snapshot -> 'products') as before_products(value)
        where value ->> 'syncProductId' = v_external_product_id
      )) as before_variants(value)
      where value ->> 'externalId' = v_external_id;
      if variant_snapshot is null then
        raise exception 'UI external ID does not match a unique catalog variant' using errcode = '22023';
      end if;
      v_external_variant_id := variant_snapshot ->> 'syncVariantId';
      if not (v_external_variant_id = any(array(select jsonb_array_elements_text(product_entry -> 'selectedSyncVariantIds')))) then
        raise exception 'UI row does not belong to the selected variant set' using errcode = '22023';
      end if;
      if (select count(*) from jsonb_array_elements((
          select value -> 'variants' from jsonb_array_elements(review.review_snapshot -> 'products') as before_products(value)
          where value ->> 'syncProductId' = v_external_product_id
        )) as before_variants(value) where value ->> 'externalId' = v_external_id) <> 1
      then
        raise exception 'UI external ID is ambiguous' using errcode = '22023';
      end if;
      price_parts := regexp_match(v_raw_price, E'^\\$([0-9]{1,8})\\.([0-9]{2})(?:\\s*(?:-|–|—)\\s*\\$([0-9]{1,8})\\.([0-9]{2}))?$');
      expected_min := price_parts[1]::integer * 100 + price_parts[2]::integer;
      expected_max := case when price_parts[3] is null then expected_min else price_parts[3]::integer * 100 + price_parts[4]::integer end;
      if expected_max < expected_min or expected_max > 10000000 then
        raise exception 'UI price range is invalid' using errcode = '22023';
      end if;

      select bound.value into cost_entry
      from jsonb_array_elements(target_costs) as bound(value)
      where bound.value ->> 'syncProductId' = v_external_product_id
        and bound.value ->> 'externalId' = v_external_id;
      if cost_entry is null
        or cost_entry ->> 'syncVariantId' is distinct from v_external_variant_id
        or cost_entry ->> 'catalogVariantId' is distinct from variant_snapshot ->> 'catalogVariantId'
        or cost_entry ->> 'productionCostMinCents' is distinct from expected_min::text
        or cost_entry ->> 'productionCostMaxCents' is distinct from expected_max::text
        or cost_entry ->> 'currency' is distinct from 'USD'
        or cost_entry ->> 'source' is distinct from 'admin-reviewed-printful-ui'
        or cost_entry ->> 'observedAt' is distinct from target_evidence ->> 'observedAt'
        or cost_entry ->> 'configurationFingerprint' is distinct from variant_snapshot ->> 'configurationFingerprint'
        or cost_entry ->> 'evidenceSha256' is distinct from target_evidence_sha256
        or cost_entry ->> 'configurationFingerprint' !~ '^[0-9a-f]{64}$'
        or not coalesce((variant_snapshot ->> 'configurationComplete')::boolean, false)
        or jsonb_array_length(variant_snapshot -> 'placementTypes') = 0
      then
        raise exception 'Bound UI cost does not match exact reviewed configuration' using errcode = '22023';
      end if;

      if (v_external_product_id || ':' || v_external_variant_id) = any(seen_variant_keys) then
        raise exception 'Duplicate UI variant cost row' using errcode = '22023';
      end if;
      seen_variant_keys := array_append(seen_variant_keys, v_external_product_id || ':' || v_external_variant_id);
      select v.* into current_variant
      from private.printful_catalog_variants v
      join private.printful_catalog_products p on p.id = v.product_id
      where p.store_id = '19050731' and p.external_product_id = v_external_product_id
        and v.external_variant_id = v_external_variant_id and p.last_seen_revision = current_revision
        and v.last_seen_revision = current_revision
      for update of v;
      if not found or current_variant.provider_external_id is distinct from v_external_id
        or current_variant.configuration_fingerprint is distinct from variant_snapshot ->> 'configurationFingerprint'
        or current_variant.catalog_variant_id is distinct from cost_entry ->> 'catalogVariantId'
        or not current_variant.configuration_complete
      then
        raise exception 'Current Printful configuration changed during UI review' using errcode = '40001';
      end if;
      update private.printful_catalog_variants
      set production_cost_min_cents = expected_min,
          production_cost_max_cents = expected_max,
          production_cost_currency = 'USD',
          production_cost_source = 'admin-reviewed-printful-ui',
          production_cost_raw_price = v_raw_price,
          production_cost_observed_at = observed_at,
          production_cost_configuration_fingerprint = current_variant.configuration_fingerprint,
          production_cost_evidence_sha256 = target_evidence_sha256,
          production_cost_reviewed_by = target_admin_id,
          updated_at = now()
      where id = current_variant.id;
      applied_count := applied_count + 1;
    end loop;
  end loop;
  if expected_count <> jsonb_array_length(target_costs) or applied_count <> expected_count then
    raise exception 'UI cost evidence is missing rows or contains extras' using errcode = '22023';
  end if;
  update private.printful_cost_review_sessions
  set completed_at = now(), evidence_sha256 = target_evidence_sha256
  where id = target_session_id;
  return applied_count;
end;
$$;
revoke all on function public.apply_printful_ui_cost_evidence(uuid, uuid, bigint, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_printful_ui_cost_evidence(uuid, uuid, bigint, jsonb, jsonb, text) to service_role;

create or replace function public.is_printful_managed_item(target_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.printful_managed_items where item_id = target_item_id)
$$;
revoke all on function public.is_printful_managed_item(uuid) from public, anon, authenticated;
grant execute on function public.is_printful_managed_item(uuid) to service_role;

create or replace function private.guard_printful_managed_armory_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_reserved boolean := false;
  new_reserved boolean := false;
begin
  if tg_op = 'UPDATE' then
    select exists (select 1 from private.printful_managed_items where item_id = old.id) into old_reserved;
    select exists (select 1 from private.printful_managed_items where item_id = new.id) into new_reserved;
    if (old_reserved or new_reserved) and old.id is distinct from new.id then
      raise exception 'A Printful-reserved Armory identity cannot be reassigned' using errcode = '23514';
    end if;
    if old_reserved then
      if new.kind <> 'preview' or new.category <> 'gear' then
        raise exception 'Printful-managed Armory identities cannot become sellable items' using errcode = '23514';
      end if;
      if not exists (select 1 from private.printful_armory_write_permits permit
        where permit.item_id = new.id and permit.transaction_id = txid_current()) then
        raise exception 'Managed Printful Armory writes require the private publish/curation RPC' using errcode = '42501';
      end if;
      delete from private.printful_armory_write_permits
      where item_id = new.id and transaction_id = txid_current();
    elsif new_reserved then
      raise exception 'An ordinary Armory item cannot claim a Printful-reserved identity' using errcode = '23514';
    end if;
  elsif tg_op = 'INSERT' then
    select exists (select 1 from private.printful_managed_items where item_id = new.id) into new_reserved;
    if new_reserved then
      if new.kind <> 'preview' or new.category <> 'gear'
        or not exists (select 1 from private.printful_armory_write_permits permit
          where permit.item_id = new.id and permit.transaction_id = txid_current()) then
        raise exception 'A reserved Printful identity can only be published through its private RPC' using errcode = '42501';
      end if;
      delete from private.printful_armory_write_permits
      where item_id = new.id and transaction_id = txid_current();
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_printful_managed_armory_write() from public, anon, authenticated, service_role;
create trigger printful_managed_armory_write_guard
before insert or update on public.armory_items
for each row execute function private.guard_printful_managed_armory_write();

create or replace function private.prevent_printful_managed_checkout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.printful_managed_items where item_id = new.item_id) then
    raise exception 'Printful-managed Armory previews are not available for checkout' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.prevent_printful_managed_checkout() from public, anon, authenticated, service_role;
create trigger printful_managed_checkout_guard
before insert on public.armory_checkout_intents
for each row execute function private.prevent_printful_managed_checkout();

create or replace function public.import_printful_armory_preview(
  target_product_local_id uuid,
  target_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  product private.printful_catalog_products%rowtype;
  reserved_item uuid;
  labels text[];
  variants_total integer;
  eligible_total integer;
  base_price integer;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select revision into current_revision from private.printful_catalog_sync_state where singleton for share;
  select * into product from private.printful_catalog_products where id = target_product_local_id and store_id = '19050731' for update;
  if not found or product.last_seen_revision <> current_revision then
    raise exception 'Refresh this Printful catalog item before import' using errcode = 'P0001';
  end if;
  select managed.item_id into reserved_item
  from private.printful_managed_items managed
  where managed.product_id = product.id
  for update;
  if reserved_item is not null then
    if exists (select 1 from private.printful_armory_drafts draft where draft.item_id = reserved_item) then
      return reserved_item;
    end if;
  end if;
  if product.ignored is distinct from false or product.observed_variant_count not between 1 and 20
    or product.synced_variant_count <> product.observed_variant_count
  then
    raise exception 'This Printful product is not eligible for display-only import' using errcode = 'P0001';
  end if;

  select count(*), count(*) filter (where
      v.last_seen_revision = current_revision
      and v.synced
      and v.ignored is false
      and v.catalog_variant_id is not null
      and v.configuration_complete
      and v.production_cost_min_cents is not null
      and v.production_cost_min_cents = v.production_cost_max_cents
      and v.production_cost_currency = 'USD'
      and v.production_cost_source = 'admin-reviewed-printful-ui'
      and v.production_cost_observed_at >= now() - interval '24 hours'
      and v.production_cost_observed_at <= now()
      and v.production_cost_configuration_fingerprint = v.configuration_fingerprint
      and cardinality(v.placement_types) > 0
  ), max(v.production_cost_max_cents)
  into variants_total, eligible_total, base_price
  from private.printful_catalog_variants v
  where v.product_id = product.id and v.last_seen_revision = current_revision;
  if variants_total <> product.observed_variant_count or eligible_total <> variants_total or base_price is null then
    raise exception 'Exact fresh USD Printful UI prices are required for every current variant' using errcode = 'P0001';
  end if;
  if base_price > 9998000 then
    raise exception 'Printful cost plus the fixed markup exceeds the Armory price limit' using errcode = '22003';
  end if;

  select array_agg(label order by label) into labels from (
    select coalesce(
      nullif(concat_ws(' / ', nullif(v.color, ''), nullif(v.size, '')), ''),
      nullif(v.provider_name, '')
    ) as label
    from private.printful_catalog_variants v
    where v.product_id = product.id and v.last_seen_revision = current_revision
      and v.synced and v.ignored is false and v.catalog_variant_id is not null and v.configuration_complete
  ) choices;
  if labels is null or cardinality(labels) <> variants_total
    or (select count(distinct lower(label)) from unnest(labels) as entries(label)) <> variants_total
    or exists (select 1 from unnest(labels) as entries(label) where label is null or char_length(label) > 200)
  then
    raise exception 'Printful variants need distinct display labels before import' using errcode = 'P0001';
  end if;

  if reserved_item is null then
    loop
      reserved_item := gen_random_uuid();
      exit when not exists (select 1 from public.armory_items item where item.id = reserved_item)
        and not exists (select 1 from private.printful_managed_items managed where managed.item_id = reserved_item);
    end loop;
    insert into private.printful_managed_items (item_id, product_id) values (reserved_item, product.id);
  end if;
  insert into private.printful_armory_drafts (
    item_id, owner_id, title, description, image_path, price_cents, shipping_cents, sizes
  ) values (
    reserved_item, target_admin_id, left(product.provider_name, 120), '', null, base_price + 2000, 0, labels
  );
  return reserved_item;
end;
$$;
revoke all on function public.import_printful_armory_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_printful_armory_preview(uuid, uuid) to service_role;

create or replace function public.update_printful_armory_preview(
  target_item_id uuid,
  target_admin_id uuid,
  target_title text,
  target_description text,
  target_image_path text,
  target_price_cents integer,
  target_shipping_cents integer,
  target_visible_to_all boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_draft private.printful_armory_drafts%rowtype;
  published_item_id uuid;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if target_title is null or char_length(btrim(target_title)) not between 1 and 120
    or target_description is null or char_length(btrim(target_description)) = 0 or char_length(target_description) > 4000
    or target_price_cents not between 100 and 10000000
    or target_shipping_cents not between 0 and 100000
    or target_visible_to_all is null
    or (target_image_path is not null and target_image_path !~ '^[0-9a-f-]{36}/[-[:alnum:]_.]{1,200}$')
  then
    raise exception 'Invalid curated Printful preview fields' using errcode = '22023';
  end if;
  select draft.* into locked_draft
  from private.printful_armory_drafts draft
  where draft.item_id = target_item_id
  for update;
  if not found then raise exception 'Managed Printful draft not found' using errcode = 'P0002'; end if;
  select item.id into published_item_id from public.armory_items item where item.id = target_item_id for update;
  if target_image_path is not null and split_part(target_image_path, '/', 1) <> locked_draft.owner_id::text then
    raise exception 'Use an image uploaded to this draft owner account' using errcode = '22023';
  end if;
  if published_item_id is not null and target_image_path is null then
    raise exception 'Published previews must keep an image; upload a replacement before saving' using errcode = 'P0001';
  end if;
  update private.printful_armory_drafts
  set title = btrim(target_title), description = target_description, image_path = target_image_path,
      price_cents = target_price_cents, shipping_cents = target_shipping_cents,
      visible_to_all = target_visible_to_all, curation_approved_at = now(), curation_approved_by = target_admin_id,
      updated_at = now()
  where item_id = target_item_id;
  if published_item_id is not null then
    insert into private.printful_armory_write_permits (item_id, transaction_id)
    values (target_item_id, txid_current());
    update public.armory_items
    set title = btrim(target_title), description = target_description, image_path = target_image_path,
        price_cents = target_price_cents, shipping_cents = target_shipping_cents,
        visible_to_all = target_visible_to_all
    where id = target_item_id;
  end if;
  return true;
end;
$$;
revoke all on function public.update_printful_armory_preview(uuid, uuid, text, text, text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.update_printful_armory_preview(uuid, uuid, text, text, text, integer, integer, boolean) to service_role;

create or replace function public.get_printful_armory_draft_upload_owner(target_item_id uuid, target_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_owner uuid;
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select draft.owner_id into draft_owner
  from private.printful_armory_drafts draft
  where draft.item_id = target_item_id;
  if not found then raise exception 'Managed Printful draft not found' using errcode = 'P0002'; end if;
  return draft_owner;
end;
$$;
revoke all on function public.get_printful_armory_draft_upload_owner(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_printful_armory_draft_upload_owner(uuid, uuid) to service_role;

create or replace function public.publish_printful_armory_preview(target_item_id uuid, target_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft private.printful_armory_drafts%rowtype;
  product private.printful_catalog_products%rowtype;
  existing_item uuid;
  current_revision bigint;
  current_variants integer;
  eligible_variants integer;
  labels text[];
begin
  if not exists (select 1 from public.profiles where id = target_admin_id and role = 'admin') then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  select * into draft from private.printful_armory_drafts where item_id = target_item_id for update;
  if not found or draft.curation_approved_at is null or draft.curation_approved_by is null
    or draft.image_path is null or char_length(btrim(draft.title)) = 0
    or char_length(btrim(draft.description)) = 0
    or draft.price_cents not between 100 and 10000000
  then
    raise exception 'Save approved copy, image and price before publishing this preview' using errcode = 'P0001';
  end if;
  select item.id into existing_item from public.armory_items item where item.id = target_item_id for update;
  if existing_item is not null then return existing_item; end if;

  select revision into current_revision from private.printful_catalog_sync_state where singleton for share;
  select p.* into product
  from private.printful_catalog_products p
  join private.printful_managed_items managed on managed.product_id = p.id
  where managed.item_id = target_item_id and p.store_id = '19050731'
  for update of p;
  if not found or product.last_seen_revision <> current_revision or product.ignored is distinct from false
    or product.observed_variant_count not between 1 and 20
    or product.synced_variant_count <> product.observed_variant_count
  then
    raise exception 'Refresh and re-review this Printful draft before publication' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where
      v.synced and v.ignored is false and v.catalog_variant_id is not null and v.configuration_complete
      and v.production_cost_min_cents is not null
      and v.production_cost_min_cents = v.production_cost_max_cents
      and v.production_cost_currency = 'USD'
      and v.production_cost_source = 'admin-reviewed-printful-ui'
      and v.production_cost_observed_at >= now() - interval '24 hours'
      and v.production_cost_observed_at <= now()
      and v.production_cost_configuration_fingerprint = v.configuration_fingerprint
      and cardinality(v.placement_types) > 0
  ) into current_variants, eligible_variants
  from private.printful_catalog_variants v
  where v.product_id = product.id and v.last_seen_revision = current_revision;
  if current_variants <> product.observed_variant_count or eligible_variants <> current_variants then
    raise exception 'Fresh exact USD UI prices are required for every current variant before publication' using errcode = 'P0001';
  end if;
  select array_agg(label order by label) into labels from (
    select coalesce(
      nullif(concat_ws(' / ', nullif(v.color, ''), nullif(v.size, '')), ''),
      nullif(v.provider_name, '')
    ) as label
    from private.printful_catalog_variants v
    where v.product_id = product.id and v.last_seen_revision = current_revision
      and v.synced and v.ignored is false and v.catalog_variant_id is not null and v.configuration_complete
  ) current_labels;
  if labels is null or cardinality(labels) <> current_variants
    or (select count(distinct lower(label)) from unnest(labels) as entries(label)) <> current_variants
    or exists (select 1 from unnest(labels) as entries(label) where label is null or char_length(label) > 200)
  then
    raise exception 'Refresh this draft because current variant labels are not unique' using errcode = 'P0001';
  end if;

  update private.printful_armory_drafts set published_at = now(), sizes = labels, updated_at = now()
  where item_id = target_item_id;
  insert into private.printful_armory_write_permits (item_id, transaction_id)
  values (target_item_id, txid_current());
  insert into public.armory_items (
    id, coach_id, kind, category, title, description, price_cents, buy_url, file_path, file_name,
    image_path, visible_to_all, sizes, shipping_cents, made_to_order,
    delivery_min_weeks, delivery_max_weeks, printful_sku, printful_sync_variant_id, printful_variant_mappings
  ) values (
    draft.item_id, draft.owner_id, 'preview', 'gear', draft.title, draft.description, draft.price_cents,
    -- This is a display-only preview; do not claim a fulfillment window before
    -- an order/fulfillment integration exists.
    null, null, null, draft.image_path, draft.visible_to_all, labels, draft.shipping_cents, false,
    null, null, null, null, '[]'::jsonb
  ) returning id into existing_item;
  return existing_item;
end;
$$;
revoke all on function public.publish_printful_armory_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_printful_armory_preview(uuid, uuid) to service_role;
