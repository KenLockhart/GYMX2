-- Armory visibility follows a per-item audience choice. Legacy `other` remains admin-only.
alter table public.armory_items
  add column required_membership_tier text not null default 'everyone';

update public.armory_items
set required_membership_tier = 'premium'
where category in ('supplements', 'doctor_network');

-- Older clients omit the field on INSERT. Requiring explicit audience avoids a rolling-deploy
-- gap where a legacy Premium-category row could be inserted as Everyone by a transient default.
alter table public.armory_items alter column required_membership_tier drop default;

alter table public.armory_items
  add constraint armory_items_required_membership_tier_check
  check (required_membership_tier in ('everyone', 'premium'));

alter table public.armory_items drop constraint armory_items_category_check;
alter table public.armory_items add constraint armory_items_category_check
  check (category in (
    'ebook', 'gear', 'accessories', 'program', 'supplements', 'doctor_network', 'partners', 'peptides', 'other_products', 'other'
  ));

grant insert (required_membership_tier) on public.armory_items to authenticated;
grant update (required_membership_tier) on public.armory_items to authenticated;
grant select (required_membership_tier) on public.armory_items to service_role;

drop policy "People with a platform plan can see eligible Armory items" on public.armory_items;
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
      required_membership_tier <> 'premium'
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

-- Preserve the established public projection and append only the harmless Everyone tier.
-- Every Premium row is filtered before it can be represented in this view.
create or replace view public.public_armory_catalog
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
  item.created_at,
  item.required_membership_tier
from public.armory_items as item
join public.profiles as seller on seller.id = item.coach_id
left join public.coach_profiles_public as public_profile on public_profile.coach_id = item.coach_id
where item.visible_to_all
  and item.category <> 'other'
  and item.required_membership_tier = 'everyone'
  and item.kind in ('link', 'paid', 'product', 'preview')
  and (
    item.kind in ('link', 'preview')
    or (item.price_cents is not null and item.price_cents >= 100)
  );
revoke all on public.public_armory_catalog from public, anon, authenticated;
grant select on public.public_armory_catalog to anon, authenticated;

-- Recheck current audience under the same row lock used for the checkout snapshot.
create or replace function public.create_armory_checkout_intent(
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
    or locked_item.category not in ('ebook', 'gear', 'accessories', 'program', 'supplements', 'doctor_network', 'other')
    or target_fee_cents is null
  then
    return false;
  end if;

  if target_member_id is null then
    if not locked_item.visible_to_all
      or locked_item.required_membership_tier <> 'everyone'
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
    if locked_item.category = 'other' and buyer_role <> 'admin' then return false; end if;
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
    if locked_item.required_membership_tier = 'premium'
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

-- Every managed draft stores its audience even before it is published.
alter table private.printful_armory_drafts
  add column required_membership_tier text not null default 'everyone',
  add constraint printful_armory_drafts_required_membership_tier_check
    check (required_membership_tier in ('everyone', 'premium'));

-- Add the saved audience to the service-only admin snapshot without changing the underlying
-- provider/cost evidence snapshot or the existing public/private grants.
alter function public.get_printful_catalog_admin_snapshot() set schema private;
alter function private.get_printful_catalog_admin_snapshot() rename to get_printful_catalog_admin_snapshot_unfiltered;
revoke all on function private.get_printful_catalog_admin_snapshot_unfiltered() from public, anon, authenticated, service_role;

create function public.get_printful_catalog_admin_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot_value jsonb;
begin
  snapshot_value := private.get_printful_catalog_admin_snapshot_unfiltered();
  if snapshot_value is null then return null; end if;
  return jsonb_set(
    snapshot_value,
    '{products}',
    coalesce((
      select jsonb_agg(
        product.value || jsonb_build_object(
          'importedRequiredMembershipTier', coalesce(draft.required_membership_tier, 'everyone')
        ) order by product.ordinality
      )
      from jsonb_array_elements(coalesce(snapshot_value -> 'products', '[]'::jsonb)) with ordinality as product(value, ordinality)
      left join private.printful_catalog_products catalog_product
        on catalog_product.id = nullif(product.value ->> 'localProductId', '')::uuid
      left join private.printful_managed_items managed on managed.product_id = catalog_product.id
      left join private.printful_armory_drafts draft on draft.item_id = managed.item_id
    ), '[]'::jsonb), true
  );
end;
$$;
revoke all on function public.get_printful_catalog_admin_snapshot() from public, anon, authenticated;
grant execute on function public.get_printful_catalog_admin_snapshot() to service_role;

-- The 8-argument curation RPC cannot safely preserve an audience it does not receive. Remove it;
-- callers must use the exact-tier overload below.
drop function public.update_printful_armory_preview(uuid, uuid, text, text, text, integer, integer, boolean);

create function public.update_printful_armory_preview(
  target_item_id uuid,
  target_admin_id uuid,
  target_title text,
  target_description text,
  target_image_path text,
  target_price_cents integer,
  target_shipping_cents integer,
  target_visible_to_all boolean,
  target_required_membership_tier text
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
    or target_required_membership_tier is null
    or target_required_membership_tier not in ('everyone', 'premium')
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
      visible_to_all = target_visible_to_all, required_membership_tier = target_required_membership_tier,
      curation_approved_at = now(), curation_approved_by = target_admin_id,
      updated_at = now()
  where item_id = target_item_id;
  if published_item_id is not null then
    insert into private.printful_armory_write_permits (item_id, transaction_id)
    values (target_item_id, txid_current());
    update public.armory_items
    set title = btrim(target_title), description = target_description, image_path = target_image_path,
        price_cents = target_price_cents, shipping_cents = target_shipping_cents,
        visible_to_all = target_visible_to_all, required_membership_tier = target_required_membership_tier
    where id = target_item_id;
  end if;
  return true;
end;
$$;
revoke all on function public.update_printful_armory_preview(uuid, uuid, text, text, text, integer, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.update_printful_armory_preview(uuid, uuid, text, text, text, integer, integer, boolean, text) to service_role;

-- Publication creates the public preview with the draft audience in the same transaction.
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
    delivery_min_weeks, delivery_max_weeks, printful_sku, printful_sync_variant_id, printful_variant_mappings,
    required_membership_tier
  ) values (
    draft.item_id, draft.owner_id, 'preview', 'gear', draft.title, draft.description, draft.price_cents,
    null, null, null, draft.image_path, draft.visible_to_all, labels, draft.shipping_cents, false,
    null, null, null, null, '[]'::jsonb, draft.required_membership_tier
  ) returning id into existing_item;
  return existing_item;
end;
$$;
revoke all on function public.publish_printful_armory_preview(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_printful_armory_preview(uuid, uuid) to service_role;

-- Keep the existing Printful implementation as a private delegate; public catalog/context/order
-- entry points below apply the saved per-item audience before returning or creating anything.
alter function public.list_printful_apparel_catalog() set schema private;
alter function private.list_printful_apparel_catalog() rename to list_printful_apparel_catalog_unfiltered;
revoke all on function private.list_printful_apparel_catalog_unfiltered() from public, anon, authenticated, service_role;

create function public.list_printful_apparel_catalog()
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
  select catalog.product_id, catalog.title, catalog.description, catalog.image_path,
    catalog.price_cents, catalog.shipping_cents, catalog.variants
  from private.list_printful_apparel_catalog_unfiltered() catalog
  join private.printful_managed_items managed on managed.product_id = catalog.product_id
  join private.printful_armory_drafts draft on draft.item_id = managed.item_id
  where draft.required_membership_tier = 'everyone'
$$;
revoke all on function public.list_printful_apparel_catalog() from public;
grant execute on function public.list_printful_apparel_catalog() to anon, authenticated, service_role;

alter function public.get_printful_apparel_checkout_context(uuid, uuid) set schema private;
alter function private.get_printful_apparel_checkout_context(uuid, uuid) rename to get_printful_apparel_checkout_context_unfiltered;
revoke all on function private.get_printful_apparel_checkout_context_unfiltered(uuid, uuid) from public, anon, authenticated, service_role;

create function public.get_printful_apparel_checkout_context(target_product_id uuid, target_variant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_value jsonb;
  audience text;
begin
  context_value := private.get_printful_apparel_checkout_context_unfiltered(target_product_id, target_variant_id);
  if context_value is null then return null; end if;
  select draft.required_membership_tier into audience
  from private.printful_armory_drafts draft
  where draft.item_id = nullif(context_value #>> '{approval,itemId}', '')::uuid;
  if not found or audience <> 'everyone' then return null; end if;
  context_value := jsonb_set(context_value, '{draft,requiredMembershipTier}', to_jsonb(audience), true);
  return context_value;
end;
$$;
revoke all on function public.get_printful_apparel_checkout_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_printful_apparel_checkout_context(uuid, uuid) to service_role;

alter function public.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb) set schema private;
alter function private.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb)
  rename to create_printful_apparel_checkout_intent_unfiltered;
revoke all on function private.create_printful_apparel_checkout_intent_unfiltered(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;

create function public.create_printful_apparel_checkout_intent(
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
  audience text;
begin
  if target_order_id is null or target_product_id is null or target_variant_id is null then
    return private.create_printful_apparel_checkout_intent_unfiltered(
      target_order_id, target_product_id, target_variant_id, target_catalog_revision,
      target_approval_version, target_email, target_address, target_address_sha256,
      target_status_token_sha256, target_status_token_expires_at, target_quote
    );
  end if;
  select draft.required_membership_tier into audience
  from private.printful_catalog_products product
  join private.printful_managed_items managed on managed.product_id = product.id
  join private.printful_armory_drafts draft on draft.item_id = managed.item_id
  where product.id = target_product_id and product.store_id = '19050731'
  for share of draft;
  if not found or audience is distinct from 'everyone' then
    raise exception 'Premium Printful items are unavailable in the guest-only apparel checkout' using errcode = 'P0001';
  end if;
  return private.create_printful_apparel_checkout_intent_unfiltered(
    target_order_id, target_product_id, target_variant_id, target_catalog_revision,
    target_approval_version, target_email, target_address, target_address_sha256,
    target_status_token_sha256, target_status_token_expires_at, target_quote
  );
end;
$$;
revoke all on function public.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.create_printful_apparel_checkout_intent(uuid, uuid, uuid, bigint, bigint, text, jsonb, text, text, timestamptz, jsonb) to service_role;
