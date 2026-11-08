-- GYMX2 Armory: ebooks and gear chosen by coaches.
-- An item is either an outside link (the coach sells it elsewhere, like Amazon or Gumroad)
-- or a free download stored in GYMX2. Paid downloads with checkout can be added as a third kind later.

-- Files to download are private: the server hands out a short-lived link after checking access.
-- Cover images are public, since they're only pictures of the product.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('armory-files', 'armory-files', false, 52428800, array[
    'application/pdf',
    'application/epub+zip',
    'application/zip',
    'audio/mpeg',
    'video/mp4',
    'image/png',
    'image/jpeg'
  ]),
  ('armory-images', 'armory-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp']);

create table public.armory_items (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('link', 'download')),
  category text not null default 'ebook' check (category in ('ebook', 'gear', 'program', 'other')),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 4000),
  -- Shown on outside-link items so members know the cost before leaving GYMX2.
  price_cents integer check (price_cents between 0 and 10000000),
  buy_url text check (buy_url ~ '^https://' and char_length(buy_url) <= 1000),
  -- Storage paths always start with the owner's id, so nobody can point an item at someone else's file.
  file_path text check (split_part(file_path, '/', 1) = coach_id::text),
  file_name text check (char_length(file_name) between 1 and 200),
  image_path text check (split_part(image_path, '/', 1) = coach_id::text),
  -- Off: only members who joined this coach see it. On: everyone on GYMX2 sees it.
  visible_to_all boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'link' or (buy_url is not null and file_path is null)),
  check (kind <> 'download' or (file_path is not null and file_name is not null and buy_url is null and price_cents is null))
);

create index armory_items_coach_idx on public.armory_items (coach_id, created_at desc);
create index armory_items_public_idx on public.armory_items (created_at desc) where visible_to_all;

create trigger armory_items_set_updated_at
before update on public.armory_items
for each row execute function public.set_updated_at();

alter table public.armory_items enable row level security;

create policy "People can see the Armory items open to them"
on public.armory_items for select to authenticated
using (
  coach_id = (select auth.uid())
  or visible_to_all
  or (select private.is_admin())
  or exists (
    select 1 from public.coach_members cm
    where cm.coach_id = armory_items.coach_id and cm.member_id = (select auth.uid())
  )
);

create policy "Coaches and admins can add their own items"
on public.armory_items for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and (private.has_role((select auth.uid()), 'coach') or (select private.is_admin()))
);

create policy "Coaches and admins can edit their own items"
on public.armory_items for update to authenticated
using (coach_id = (select auth.uid()))
with check (coach_id = (select auth.uid()));

create policy "Owners and admins can remove items"
on public.armory_items for delete to authenticated
using (coach_id = (select auth.uid()) or (select private.is_admin()));

revoke all on public.armory_items from public, anon, authenticated;
grant select, delete on public.armory_items to authenticated;
grant insert (coach_id, kind, category, title, description, price_cents, buy_url, file_path, file_name, image_path, visible_to_all)
on public.armory_items to authenticated;
grant update (kind, category, title, description, price_cents, buy_url, file_path, file_name, image_path, visible_to_all)
on public.armory_items to authenticated;
