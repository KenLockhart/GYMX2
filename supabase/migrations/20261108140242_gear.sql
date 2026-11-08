-- GYMX2 gear: physical products like shirts, sold in the Armory and shipped by the seller.
-- The buyer picks a size and gives a US shipping address at Stripe Checkout. The seller ships the order
-- and marks it shipped with a tracking number. A print-on-demand service can take over shipping later.

alter table public.armory_items drop constraint armory_items_kind_check;
alter table public.armory_items add constraint armory_items_kind_check
  check (kind in ('link', 'download', 'paid', 'product'));

-- The sizes a buyer can choose from, like S, M, L. Empty means one version only.
alter table public.armory_items add column sizes text[] not null default '{}'
  check (cardinality(sizes) <= 20 and array_position(sizes, '') is null);
-- A flat shipping fee in cents, added at checkout.
alter table public.armory_items add column shipping_cents integer not null default 0
  check (shipping_cents between 0 and 100000);

alter table public.armory_items add constraint armory_items_product_check
  check (
    kind <> 'product'
    or (
      price_cents is not null
      and price_cents between 100 and 10000000
      and file_path is null
      and file_name is null
      and buy_url is null
    )
  );

grant insert (sizes, shipping_cents) on public.armory_items to authenticated;
grant update (sizes, shipping_cents) on public.armory_items to authenticated;

-- Order details for gear. Digital purchases leave these empty and need no shipping.
alter table public.purchases add column size text check (char_length(size) <= 40);
alter table public.purchases add column shipping_cents integer not null default 0 check (shipping_cents >= 0);
alter table public.purchases add column shipping_name text check (char_length(shipping_name) <= 200);
alter table public.purchases add column shipping_address jsonb;
alter table public.purchases add column fulfillment_status text not null default 'not_needed'
  check (fulfillment_status in ('not_needed', 'to_ship', 'shipped'));
alter table public.purchases add column tracking_number text check (char_length(tracking_number) <= 100);
alter table public.purchases add column shipped_at timestamptz;

create index purchases_to_ship_idx on public.purchases (seller_id, created_at) where fulfillment_status = 'to_ship';

grant update (fulfillment_status, tracking_number, shipped_at) on public.purchases to service_role;

-- The seller (or any admin, for GYMX2's own gear) marks an order shipped. The time is set here.
create function public.mark_order_shipped(target_purchase_id uuid, tracking text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if char_length(coalesce(tracking, '')) > 100 then
    raise exception 'Use 100 characters or fewer for the tracking number' using errcode = 'P0001';
  end if;

  update public.purchases
  set fulfillment_status = 'shipped',
      tracking_number = nullif(trim(tracking), ''),
      shipped_at = coalesce(shipped_at, now())
  where id = target_purchase_id
    and fulfillment_status in ('to_ship', 'shipped')
    and (seller_id = caller or private.is_admin());

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.mark_order_shipped(uuid, text) from public, anon;
grant execute on function public.mark_order_shipped(uuid, text) to authenticated;
