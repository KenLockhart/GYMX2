-- Preview is a distinct kind: old as well as new checkout code only allows
-- 'paid' and 'product', so previews fail closed even on an older deployment.
-- No existing items are modified and existing ownership/RLS is unchanged.
alter table public.armory_items drop constraint armory_items_kind_check;
alter table public.armory_items add constraint armory_items_kind_check
  check (kind in ('link', 'download', 'paid', 'product', 'preview'));

alter table public.armory_items drop constraint armory_items_gear_ships;
alter table public.armory_items add constraint armory_items_gear_ships
  check (category <> 'gear' or kind in ('link', 'product', 'preview'));

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
