begin;
select plan(3);

insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-000000000002', 'del-coach@example.test', '{"display_name":"Coach"}'),
  ('a0000000-0000-0000-0000-000000000004', 'del-buyer@example.test', '{"display_name":"Buyer"}');
update public.profiles set role = 'coach' where id = 'a0000000-0000-0000-0000-000000000002';
insert into public.purchases (item_id, member_id, seller_id, item_title, amount_cents, fee_cents, stripe_session_id)
values (null, 'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000002', 'Plan', 1999, 200, 'cs_del_1');
insert into public.messages (coach_id, member_id, sender_id, body)
values ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000004', 'Hi coach');

delete from auth.users where id = 'a0000000-0000-0000-0000-000000000004';

select is((select count(*)::int from public.purchases where stripe_session_id = 'cs_del_1'), 1, 'the order is kept');
select ok((select member_id is null from public.purchases where stripe_session_id = 'cs_del_1'), 'without the deleted buyer');
select is(
  (select count(*)::int from public.messages where member_id = 'a0000000-0000-0000-0000-000000000004'),
  0,
  'their messages are gone'
);

select * from finish();
rollback;
