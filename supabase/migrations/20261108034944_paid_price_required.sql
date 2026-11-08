-- A missing price made the paid-item check pass, because a comparison with no value isn't "false".
-- Paid items must have a price of at least $1.
alter table public.armory_items drop constraint armory_items_paid_check;
alter table public.armory_items add constraint armory_items_paid_check
  check (
    kind <> 'paid'
    or (
      file_path is not null
      and file_name is not null
      and buy_url is null
      and price_cents is not null
      and price_cents between 100 and 10000000
    )
  );
