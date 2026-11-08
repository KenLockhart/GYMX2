begin;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('50000000-0000-0000-0000-000000000001', 'arm-admin@example.test', '{"display_name":"Admin"}'),
  ('50000000-0000-0000-0000-000000000002', 'arm-coach@example.test', '{"display_name":"Coach"}'),
  ('50000000-0000-0000-0000-000000000003', 'arm-rival@example.test', '{"display_name":"Rival"}'),
  ('50000000-0000-0000-0000-000000000004', 'arm-joined@example.test', '{"display_name":"Joined"}'),
  ('50000000-0000-0000-0000-000000000005', 'arm-outsider@example.test', '{"display_name":"Outsider"}');

update public.profiles set role = 'admin' where id = '50000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach'
where id in ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003');

insert into public.coach_members (coach_id, member_id) values
  ('50000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000004');

-- Anonymous visitors
set local role anon;
select throws_ok('select id from public.armory_items', '42501', null, 'anonymous visitors cannot see the Armory');
reset role;

-- A coach adds items
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$insert into public.armory_items (coach_id, kind, category, title, price_cents, buy_url)
    values ('50000000-0000-0000-0000-000000000002', 'link', 'gear', 'Bands', 2499, 'https://shop.example.com/bands')$$,
  'a coach can add an outside-link item'
);
select lives_ok(
  $$insert into public.armory_items (coach_id, kind, title, file_path, file_name)
    values ('50000000-0000-0000-0000-000000000002', 'download', 'Meal plan',
            '50000000-0000-0000-0000-000000000002/plan.pdf', 'plan.pdf')$$,
  'a coach can add a free download'
);
select lives_ok(
  $$insert into public.armory_items (coach_id, kind, title, buy_url, visible_to_all)
    values ('50000000-0000-0000-0000-000000000002', 'link', 'Public guide', 'https://shop.example.com/guide', true)$$,
  'a coach can share an item with everyone'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, file_path, file_name)
    values ('50000000-0000-0000-0000-000000000002', 'download', 'Stolen',
            '50000000-0000-0000-0000-000000000003/secret.pdf', 'secret.pdf')$$,
  '23514',
  null,
  'a coach cannot point an item at another coach''s file'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, buy_url)
    values ('50000000-0000-0000-0000-000000000002', 'link', 'Insecure', 'http://shop.example.com')$$,
  '23514',
  null,
  'a buy link must use https'
);
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, buy_url)
    values ('50000000-0000-0000-0000-000000000003', 'link', 'Forged', 'https://shop.example.com')$$,
  '42501',
  null,
  'a coach cannot add an item as someone else'
);
reset role;

-- Members see their coach's items, plus anything shared with everyone
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.armory_items), 3, 'a joined member sees all of their coach''s items');
select throws_ok(
  $$insert into public.armory_items (coach_id, kind, title, buy_url)
    values ('50000000-0000-0000-0000-000000000004', 'link', 'Member item', 'https://shop.example.com')$$,
  '42501',
  null,
  'a member cannot add items'
);
update public.armory_items set title = 'Hacked';
select is(
  (select count(*)::int from public.armory_items where title = 'Hacked'),
  0,
  'a member cannot edit a coach''s items'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is(
  (select array_agg(title) from public.armory_items),
  array['Public guide'],
  'someone who did not join the coach only sees items shared with everyone'
);
reset role;

-- Other coaches
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000003","role":"authenticated"}';
delete from public.armory_items where title = 'Bands';
reset role;
select is(
  (select count(*)::int from public.armory_items where title = 'Bands'),
  1,
  'another coach cannot remove someone else''s item'
);
reset role;

-- Admins see and can remove everything
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.armory_items), 3, 'an admin sees every item');
delete from public.armory_items where title = 'Public guide';
select is((select count(*)::int from public.armory_items), 2, 'an admin can remove an item');
reset role;

-- The coach edits and removes their own
set local role authenticated;
set local request.jwt.claims = '{"sub":"50000000-0000-0000-0000-000000000002","role":"authenticated"}';
select lives_ok(
  $$update public.armory_items set title = 'Resistance bands', price_cents = 1999 where title = 'Bands'$$,
  'a coach can edit their item'
);
delete from public.armory_items where title = 'Meal plan';
select is(
  (select array_agg(title) from public.armory_items),
  array['Resistance bands'],
  'a coach can remove their item'
);
reset role;

select * from finish();
rollback;
