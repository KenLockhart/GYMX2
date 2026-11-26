begin;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('a3000000-0000-4000-8000-000000000001', 'audience-coach@example.test', '{"display_name":"Audience Coach"}'),
  ('a3000000-0000-4000-8000-000000000002', 'audience-regular@example.test', '{"display_name":"Audience Regular"}'),
  ('a3000000-0000-4000-8000-000000000003', 'audience-premium@example.test', '{"display_name":"Audience Premium"}'),
  ('a3000000-0000-4000-8000-000000000004', 'audience-expired@example.test', '{"display_name":"Audience Expired"}'),
  ('a3000000-0000-4000-8000-000000000005', 'audience-admin@example.test', '{"display_name":"Audience Admin"}');

update public.profiles set role = 'coach'
where id = 'a3000000-0000-4000-8000-000000000001';
update public.profiles set role = 'admin'
where id = 'a3000000-0000-4000-8000-000000000005';

insert into public.platform_memberships (
  member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id,
  status, current_period_end, last_event_created, last_event_id
) values
  ('a3000000-0000-4000-8000-000000000002', 'regular', 'sub_audience_regular', 'cus_audience_regular', 'price_regular_test', 'active', now() + interval '30 days', 1, 'evt_audience_regular'),
  ('a3000000-0000-4000-8000-000000000003', 'premium', 'sub_audience_premium', 'cus_audience_premium', 'price_premium_test', 'active', now() + interval '30 days', 1, 'evt_audience_premium');

insert into public.armory_items (
  id, coach_id, kind, category, title, description, price_cents, buy_url, file_path, file_name,
  visible_to_all, required_membership_tier
) values
  ('a3000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000001', 'paid', 'ebook', 'Everyone paid guide', 'Audience fixture', 2000, null, 'a3000000-0000-4000-8000-000000000001/everyone.pdf', 'everyone.pdf', true, 'everyone'),
  ('a3000000-0000-4000-8000-000000000102', 'a3000000-0000-4000-8000-000000000001', 'paid', 'ebook', 'Premium paid guide', 'Audience fixture', 2000, null, 'a3000000-0000-4000-8000-000000000001/premium.pdf', 'premium.pdf', true, 'premium'),
  ('a3000000-0000-4000-8000-000000000103', 'a3000000-0000-4000-8000-000000000001', 'link', 'supplements', 'Everyone supplements', 'Category no longer controls audience', null, 'https://shop.example.test/supplements', null, null, true, 'everyone'),
  ('a3000000-0000-4000-8000-000000000104', 'a3000000-0000-4000-8000-000000000001', 'link', 'supplements', 'Premium supplements', 'Category no longer controls audience', null, 'https://shop.example.test/premium-supplements', null, null, true, 'premium'),
  ('a3000000-0000-4000-8000-000000000105', 'a3000000-0000-4000-8000-000000000001', 'paid', 'doctor_network', 'Purchased Premium guide', 'Prior download fixture', 1500, null, 'a3000000-0000-4000-8000-000000000001/prior.pdf', 'prior.pdf', true, 'premium'),
  ('a3000000-0000-4000-8000-000000000106', 'a3000000-0000-4000-8000-000000000001', 'link', 'other', 'Legacy other row', 'Remains admin-only', null, 'https://shop.example.test/legacy', null, null, true, 'everyone'),
  ('a3000000-0000-4000-8000-000000000107', 'a3000000-0000-4000-8000-000000000001', 'link', 'partners', 'Everyone partner resource', 'New non-commerce category', null, 'https://partner.example.test/resource', null, null, true, 'everyone'),
  ('a3000000-0000-4000-8000-000000000108', 'a3000000-0000-4000-8000-000000000001', 'link', 'peptides', 'Premium peptide resource', 'New non-commerce category', null, 'https://peptide.example.test/resource', null, null, true, 'premium'),
  ('a3000000-0000-4000-8000-000000000109', 'a3000000-0000-4000-8000-000000000001', 'link', 'other_products', 'Everyone other product resource', 'New non-commerce category', null, 'https://products.example.test/resource', null, null, true, 'everyone'),
  ('a3000000-0000-4000-8000-000000000112', 'a3000000-0000-4000-8000-000000000001', 'paid', 'partners', 'Display-only partner download', 'Not purchasable in this category', 1200, null, 'a3000000-0000-4000-8000-000000000001/partner.pdf', 'partner.pdf', true, 'everyone');

insert into public.purchases (
  item_id, member_id, seller_id, item_title, amount_cents, fee_cents,
  stripe_session_id, kind, fulfillment_status
) values (
  'a3000000-0000-4000-8000-000000000105', 'a3000000-0000-4000-8000-000000000004',
  'a3000000-0000-4000-8000-000000000001', 'Purchased Premium guide', 1500, 150,
  'cs_audience_previous_download', 'item', 'not_needed'
);

select throws_ok(
  $$insert into public.armory_items (id, coach_id, kind, category, title, buy_url, visible_to_all)
    values ('a3000000-0000-4000-8000-000000000110', 'a3000000-0000-4000-8000-000000000001',
      'link', 'supplements', 'Legacy client insert', 'https://shop.example.test/legacy-client', true)$$,
  '23502', null, 'new rows require an explicit audience so older clients cannot silently create Everyone Premium-category items'
);
select lives_ok(
  $$insert into public.armory_items (id, coach_id, kind, category, title, buy_url, visible_to_all, required_membership_tier)
    values ('a3000000-0000-4000-8000-000000000111', 'a3000000-0000-4000-8000-000000000001',
      'link', 'supplements', 'Explicit Everyone choice', 'https://shop.example.test/everyone', true, 'everyone')$$,
  'explicit Everyone audience inserts successfully'
);
select throws_ok(
  $$update public.armory_items set required_membership_tier = 'public' where id = 'a3000000-0000-4000-8000-000000000101'$$,
  '23514', null, 'the audience column accepts only Everyone or Premium'
);
select ok(
  has_column_privilege('authenticated', 'public.armory_items', 'required_membership_tier', 'INSERT')
  and has_column_privilege('authenticated', 'public.armory_items', 'required_membership_tier', 'UPDATE')
  and has_column_privilege('service_role', 'public.armory_items', 'required_membership_tier', 'SELECT')
  and (select column_default is null from information_schema.columns
       where table_schema = 'public' and table_name = 'armory_items' and column_name = 'required_membership_tier')
  and not has_table_privilege('authenticated', 'public.armory_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.armory_items', 'UPDATE')
  and not has_table_privilege('service_role', 'public.armory_items', 'SELECT')
  and not has_table_privilege('anon', 'public.armory_items', 'SELECT'),
  'audience field has no default, writes are column-scoped, and guests cannot query source rows'
);
select is(
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'public_armory_catalog'),
  array['id','coach_id','seller_label','kind','category','title','description','price_cents','buy_url','sizes','shipping_cents','image_path','made_to_order','delivery_min_weeks','delivery_max_weeks','created_at','required_membership_tier']::text[],
  'public catalog appends only the audience label to its approved projection'
);
select is(
  (select array_agg(id::text order by id::text) from public.public_armory_catalog),
  array[
    'a3000000-0000-4000-8000-000000000101',
    'a3000000-0000-4000-8000-000000000103',
    'a3000000-0000-4000-8000-000000000107',
    'a3000000-0000-4000-8000-000000000109',
    'a3000000-0000-4000-8000-000000000111',
    'a3000000-0000-4000-8000-000000000112'
  ]::text[],
  'public display includes Everyone non-legacy categories and filters Premium plus legacy other'
);
select is(
  (select array_agg(distinct required_membership_tier) from public.public_armory_catalog),
  array['everyone']::text[], 'public projection never exposes Premium audience metadata'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000002","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000101'), 'Regular can see Everyone items');
select ok(not exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000102'), 'Regular cannot see a Premium ebook outside legacy Premium categories');
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000103'), 'supplements category no longer forces Premium when the saved audience is Everyone');
select ok(not exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000104'), 'Premium audience is enforced on an otherwise Everyone category');
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000107'), 'Everyone partner category is visible to Regular');
select ok(not exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000108'), 'Premium peptide category is hidden from Regular');
select ok(not exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000106'), 'legacy other remains admin-only');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000003","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000102'), 'Premium can see Premium audience items');
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000108'), 'Premium can see Premium items in new categories');
select ok(not exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000106'), 'Premium does not gain access to legacy other');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000004","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000105'), 'purchased unrefunded download remains accessible after paid membership expires');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"a3000000-0000-4000-8000-000000000001","role":"authenticated"}';
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000102'), 'owner visibility bypasses item audience');
select ok(exists (select 1 from public.armory_items where id = 'a3000000-0000-4000-8000-000000000106'), 'owner retains legacy other management access');
reset role;

-- Locked checkout reads the current audience and stale updated_at snapshots lose the race.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000101', 'a3000000-0000-4000-8000-000000000101', null,
    'guest@example.test', 'en', null, 200,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000101'),
    2000, 0, 'Everyone paid guide', 'paid', 'ebook',
    'a3000000-0000-4000-8000-000000000001/everyone.pdf', 'everyone.pdf'
  ), true, 'Everyone paid ebook can still use allowed guest checkout'
);
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000102', 'a3000000-0000-4000-8000-000000000102',
    'a3000000-0000-4000-8000-000000000002', null, 'en', null, 200,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000102'),
    2000, 0, 'Premium paid guide', 'paid', 'ebook',
    'a3000000-0000-4000-8000-000000000001/premium.pdf', 'premium.pdf'
  ), false, 'Regular member checkout is denied for Premium audience'
);
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000103', 'a3000000-0000-4000-8000-000000000102',
    'a3000000-0000-4000-8000-000000000003', null, 'en', null, 200,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000102'),
    2000, 0, 'Premium paid guide', 'paid', 'ebook',
    'a3000000-0000-4000-8000-000000000001/premium.pdf', 'premium.pdf'
  ), true, 'Premium member checkout remains available for Premium audience'
);
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000104', 'a3000000-0000-4000-8000-000000000107', null,
    'guest@example.test', 'en', null, 0,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000107'),
    null, 0, 'Everyone partner resource', 'link', 'partners', null, null
  ), false, 'new display category does not widen guest checkout allowlist'
);
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000107', 'a3000000-0000-4000-8000-000000000112',
    'a3000000-0000-4000-8000-000000000002', null, 'en', null, 120,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000112'),
    1200, 0, 'Display-only partner download', 'paid', 'partners',
    'a3000000-0000-4000-8000-000000000001/partner.pdf', 'partner.pdf'
  ), false, 'new category paid rows stay out of member commerce as well'
);

reset role;
create temporary table audience_checkout_stale_snapshot as
select updated_at - interval '1 second' as updated_at
from public.armory_items where id = 'a3000000-0000-4000-8000-000000000101';
grant select on audience_checkout_stale_snapshot to service_role;
update public.armory_items
set required_membership_tier = 'premium'
where id = 'a3000000-0000-4000-8000-000000000101';
set local role service_role;
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000105', 'a3000000-0000-4000-8000-000000000101', null,
    'guest@example.test', 'en', null, 200,
    (select updated_at from audience_checkout_stale_snapshot),
    2000, 0, 'Everyone paid guide', 'paid', 'ebook',
    'a3000000-0000-4000-8000-000000000001/everyone.pdf', 'everyone.pdf'
  ), false, 'stale checkout snapshot is rejected after the saved audience changes'
);
select is(
  public.create_armory_checkout_intent(
    'a4000000-0000-4000-8000-000000000106', 'a3000000-0000-4000-8000-000000000101', null,
    'guest@example.test', 'en', null, 200,
    (select updated_at from public.armory_items where id = 'a3000000-0000-4000-8000-000000000101'),
    2000, 0, 'Everyone paid guide', 'paid', 'ebook',
    'a3000000-0000-4000-8000-000000000001/everyone.pdf', 'everyone.pdf'
  ), false, 'current Premium audience is rejected by guest checkout after snapshot refresh'
);
select is((select count(*)::int from public.armory_checkout_intents where id in (
  'a4000000-0000-4000-8000-000000000101','a4000000-0000-4000-8000-000000000103'
)), 2, 'only allowed Everyone guest and Premium member checkout intents persist');
reset role;

select * from finish();
rollback;
