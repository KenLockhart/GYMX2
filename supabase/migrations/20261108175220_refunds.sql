-- Refunds. The server refunds through Stripe, then records it here. A refunded download stops
-- working, and refunded gear that hadn't shipped is cancelled so it leaves "Orders to ship".
alter table public.purchases add column refunded_at timestamptz;

do $$
declare
  existing text;
begin
  select conname into existing
  from pg_constraint
  where conrelid = 'public.purchases'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%fulfillment_status%';
  if existing is not null then
    execute format('alter table public.purchases drop constraint %I', existing);
  end if;
end;
$$;

alter table public.purchases add constraint purchases_fulfillment_status_check
  check (fulfillment_status in ('not_needed', 'to_ship', 'shipped', 'cancelled'));

grant update (refunded_at) on public.purchases to service_role;

-- A refunded order can no longer be marked shipped.
create or replace function public.mark_order_shipped(target_purchase_id uuid, tracking text)
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
    and refunded_at is null
    and (seller_id = caller or private.is_admin());

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
end;
$$;
