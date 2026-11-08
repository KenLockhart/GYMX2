-- Gear is shipped to the buyer, never downloaded. Items in the Gear category can only be
-- "Sell gear" (product) or "Buy it elsewhere" (link).

-- Gear that was listed as a paid file becomes real gear: same price, no file, sizes added by the seller.
update public.armory_items
set kind = 'product', file_path = null, file_name = null
where category = 'gear' and kind = 'paid';

-- A free gear "download" has no price to sell at, so it moves to Other for its owner to fix.
update public.armory_items
set category = 'other'
where category = 'gear' and kind = 'download';

alter table public.armory_items
  add constraint armory_items_gear_ships check (category <> 'gear' or kind in ('link', 'product'));
