begin;
select plan(43);

insert into auth.users (id, email, raw_user_meta_data) values
  ('60000000-0000-0000-0000-000000000001', 'platform-admin@example.test', '{"display_name":"Platform admin"}'),
  ('60000000-0000-0000-0000-000000000002', 'platform-coach@example.test', '{"display_name":"Platform coach"}'),
  ('60000000-0000-0000-0000-000000000003', 'platform-regular@example.test', '{"display_name":"Regular member"}'),
  ('60000000-0000-0000-0000-000000000004', 'platform-premium@example.test', '{"display_name":"Premium member"}'),
  ('60000000-0000-0000-0000-000000000005', 'platform-expired@example.test', '{"display_name":"Expired member"}'),
  ('60000000-0000-0000-0000-000000000006', 'platform-test@example.test', '{"display_name":"Test entitlement"}'),
  ('60000000-0000-0000-0000-000000000007', 'platform-checkout@example.test', '{"display_name":"Checkout member"}'),
  ('60000000-0000-0000-0000-000000000008', 'platform-incomplete@example.test', '{"display_name":"Incomplete member"}');

update public.profiles set role = 'admin' where id = '60000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach' where id = '60000000-0000-0000-0000-000000000002';

insert into public.platform_memberships (
  member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id,
  status, current_period_end, last_event_created, last_event_id
) values
  ('60000000-0000-0000-0000-000000000003', 'regular', 'sub_platform_regular', 'cus_platform_regular', 'price_regular_test', 'active', now() + interval '30 days', 10, 'evt_platform_regular'),
  ('60000000-0000-0000-0000-000000000004', 'premium', 'sub_platform_premium', 'cus_platform_premium', 'price_premium_test', 'active', now() + interval '30 days', 10, 'evt_platform_premium'),
  ('60000000-0000-0000-0000-000000000005', 'regular', 'sub_platform_expired', 'cus_platform_expired', 'price_regular_test', 'active', now() - interval '1 day', 10, 'evt_platform_expired'),
  ('60000000-0000-0000-0000-000000000008', 'regular', 'sub_platform_incomplete', 'cus_platform_incomplete', 'price_regular_test', 'incomplete', now() + interval '1 day', 10, 'evt_platform_incomplete');

insert into public.platform_test_entitlements (
  member_id, tier, source, grant_reason, granted_by
) values (
  '60000000-0000-0000-0000-000000000006', 'premium', 'manual_test',
  'Local pgTAP entitlement fixture', '00000000-0000-0000-0000-000000000000'
);

insert into public.armory_items (
  coach_id, kind, category, title, buy_url, visible_to_all
) values
  ('60000000-0000-0000-0000-000000000002', 'link', 'accessories', 'Resistance bands', 'https://shop.example.test/bands', true),
  ('60000000-0000-0000-0000-000000000002', 'link', 'supplements', 'Protein', 'https://shop.example.test/protein', true),
  ('60000000-0000-0000-0000-000000000002', 'link', 'doctor_network', 'Doctor network', 'https://shop.example.test/doctors', true),
  ('60000000-0000-0000-0000-000000000002', 'link', 'other', 'Old category item', 'https://shop.example.test/old', true);

insert into public.armory_items (
  coach_id, kind, category, title, price_cents, file_path, file_name, visible_to_all
) values (
  '60000000-0000-0000-0000-000000000002', 'paid', 'doctor_network',
  'Purchased care guide', 1999,
  '60000000-0000-0000-0000-000000000002/guide.pdf', 'guide.pdf', true
);

insert into public.armory_items (
  coach_id, kind, category, title, price_cents, file_path, file_name, visible_to_all
) values (
  '60000000-0000-0000-0000-000000000001', 'paid', 'other',
  'Purchased legacy guide', 999,
  '60000000-0000-0000-0000-000000000001/legacy-guide.pdf', 'legacy-guide.pdf', true
);

insert into public.purchases (
  item_id, member_id, seller_id, item_title, amount_cents, fee_cents,
  stripe_session_id, kind, fulfillment_status
)
select
  ai.id,
  '60000000-0000-0000-0000-000000000005',
  ai.coach_id,
  ai.title,
  1999,
  200,
  'cs_platform_owned_download',
  'item',
  'not_needed'
from public.armory_items ai
where ai.title = 'Purchased care guide';

insert into public.purchases (
  item_id, member_id, seller_id, item_title, amount_cents, fee_cents,
  stripe_session_id, kind, fulfillment_status
)
select
  ai.id,
  '60000000-0000-0000-0000-000000000005',
  ai.coach_id,
  ai.title,
  999,
  100,
  'cs_platform_owned_legacy_download',
  'item',
  'not_needed'
from public.armory_items ai
where ai.title = 'Purchased legacy guide';

insert into public.coach_members (coach_id, member_id)
values ('60000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000003');

-- A Regular member can use Regular categories but cannot see visible Premium rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.armory_items where category = 'accessories'), 1, 'Regular can see Accessories');
select is((select count(*)::int from public.armory_items where category = 'supplements'), 0, 'Regular cannot see Supplements even when visible to all');
select is((select count(*)::int from public.armory_items where category = 'doctor_network'), 0, 'Regular cannot browse Doctor Network without a purchase');
select is((select count(*)::int from public.armory_items where category = 'other'), 0, 'Legacy / Other is not a public buyer category');
select throws_ok(
  $$insert into public.platform_memberships (member_id, tier, stripe_subscription_id, stripe_customer_id, stripe_price_id, status, current_period_end, last_event_created, last_event_id)
    values ('60000000-0000-0000-0000-000000000003', 'premium', 'sub_forged', 'cus_forged', 'price_premium_test', 'active', now() + interval '30 days', 99, 'evt_forged')$$,
  '42501', null, 'a client cannot create a paid entitlement'
);
select throws_ok(
  $$insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
    values ('60000000-0000-0000-0000-000000000003', 'premium', 'forged test', '60000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'a client cannot create a manual test entitlement'
);
reset role;

-- A Premium subscriber sees both premium categories through RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.armory_items where category = 'supplements'), 1, 'Premium can browse Supplements');
select is((select count(*)::int from public.armory_items where category = 'doctor_network'), 2, 'Premium can browse Doctor Network, including visible paid items');
reset role;

-- Expired paid-through access no longer reveals regular or premium catalog rows.
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.armory_items where category = 'accessories'), 0, 'an expired paid period grants no Regular catalog access');
select is((select count(*)::int from public.armory_items where category = 'doctor_network'), 1, 'a paid download remains visible after membership access ends');
reset role;

-- Manual QA grants are separate from Stripe subscriptions, and sellers can manage their own stock.
set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000006","role":"authenticated"}';
select ok(private.has_platform_tier(auth.uid(), 'premium'), 'a service-only manual test grant unlocks Premium');
select is((select count(*)::int from public.armory_items where category = 'supplements'), 1, 'the manual test entitlement grants premium browsing');
reset role;
set local role service_role;
select is((select granted_by from public.platform_test_entitlements where member_id = '60000000-0000-0000-0000-000000000006'), '00000000-0000-0000-0000-000000000000'::uuid, 'manual test grants use the documented service actor sentinel, not a human account');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.armory_items where category in ('supplements', 'doctor_network') and kind = 'link'), 2, 'the seller can manage their own premium link inventory without a buyer entitlement');
select is((select count(*)::int from public.armory_items where category = 'other'), 1, 'the seller can manage a legacy Other item');
reset role;

-- Signed Stripe events and server reconciliations share a revision CAS. An older signed delivery
-- that fetches current canceled state applies without regressing the event audit watermark; a
-- delayed read captured before a concurrent change loses the CAS.
set local role service_role;
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'premium', 'sub_platform_order', 'cus_platform_order',
    'price_premium_test', 'active', now() + interval '30 days', false, 100, 'evt_platform_order_active',
    '70000000-0000-0000-0000-000000000001', null
  ),
  'applied', 'a verified webhook can save a platform subscription'
);
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'premium', 'sub_platform_order', 'cus_platform_order',
    'price_premium_test', 'canceled', now(), true, 101, 'evt_platform_order_cancel',
    '70000000-0000-0000-0000-000000000001', 1
  ),
  'applied', 'a newer webhook can cancel the subscription'
);
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'premium', 'sub_platform_order', 'cus_platform_order',
    'price_premium_test', 'canceled', now(), true, 100, 'evt_platform_order_late_old',
    '70000000-0000-0000-0000-000000000001', 2
  ),
  'applied', 'an older event delivery applies the freshly retrieved canceled Stripe state'
);
select is((select status from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 'canceled', 'the current canceled Stripe state is saved');
select is((select last_event_created from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 101::bigint, 'late event timestamps remain monotonic audit metadata without gating state');
select is((select last_event_id from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 'evt_platform_order_cancel', 'the retained audit event id matches the maximum event timestamp');
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'premium', 'sub_platform_order', 'cus_platform_order',
    'price_premium_test', 'active', now() + interval '30 days', false, null, null,
    null, 1
  ),
  'conflict', 'a delayed reconciliation cannot overwrite a row changed during Stripe retrieval'
);
select is((select tier from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 'premium', 'a rejected delayed read leaves the saved tier unchanged');

-- A current Stripe read can apply on a fresh revision, while an incomplete subscription blocks a
-- second subscription even when the application preflight was stale.
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'regular', 'sub_platform_order', 'cus_platform_order',
    'price_regular_test', 'active', now() + interval '30 days', false, 102, 'evt_platform_order_downgrade',
    '70000000-0000-0000-0000-000000000002', 3
  ),
  'applied', 'an explicitly confirmed downgrade applies against the current revision'
);
select is((select tier from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 'regular', 'a confirmed downgrade removes Premium tier');
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000008', 'regular')),
  'subscription_pending', 'an incomplete subscription blocks a duplicate checkout atomically'
);

-- Old webhook replay may update only its original request; it must not clear a newer open checkout.
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'regular', 'sub_platform_order', 'cus_platform_order',
    'price_regular_test', 'canceled', now(), true, 103, 'evt_platform_order_cancel_final',
    '70000000-0000-0000-0000-000000000002', 4
  ),
  'applied', 'a later cancellation ends Regular access'
);
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000007', 'regular')),
  'reserved', 'a canceled subscription permits a new explicit checkout'
);
select ok(
  public.attach_platform_checkout_session(
    '60000000-0000-0000-0000-000000000007',
    (select request_id from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007'),
    'cs_platform_new',
    (select expires_at from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007')
  ),
  'the Stripe session expiry is bounded by its checkout reservation'
);
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'regular', 'sub_platform_order', 'cus_platform_order',
    'price_regular_test', 'canceled', now(), true, 103, 'evt_platform_order_cancel_final',
    '70000000-0000-0000-0000-000000000002', 5
  ),
  'applied', 'a replayed event can clear only its own reservation id'
);
select is((select stripe_session_id from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007'), 'cs_platform_new', 'a stale subscription event cannot erase a newer checkout');
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000007', 'regular')),
  'pending', 'a repeated checkout request reuses the still-open session'
);

-- The SQL reservation cannot infer Stripe status from elapsed time. It retains an expired bound
-- session until the server verifies expiry; only then can the exact old request be released.
update public.platform_checkout_attempts
set expires_at = now() - interval '1 second'
where member_id = '60000000-0000-0000-0000-000000000007';
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000007', 'regular')),
  'pending', 'an expired bound session must be reconciled with Stripe before replacement'
);
select ok(
  public.release_platform_checkout_attempt(
    '60000000-0000-0000-0000-000000000007',
    (select request_id from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007'),
    'cs_platform_new', true
  ),
  'the server can release the exact request after confirming its Stripe session expired'
);
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000007', 'regular')),
  'reserved', 'a new checkout can start after verified expiry releases the old request'
);
select ok(
  not public.attach_platform_checkout_session(
    '60000000-0000-0000-0000-000000000007',
    '70000000-0000-0000-0000-000000000003',
    'cs_platform_late_old_request', now() + interval '1 hour'
  ),
  'a late in-flight create cannot attach to a replaced reservation'
);
select ok(
  (select expires_at < now() + interval '24 hours' from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007'),
  'new checkout deadlines leave headroom below Stripe 24-hour session maximum'
);

-- Account deletion establishes a permanent tombstone before cancelling sessions. New reservations,
-- late session attachment, and webhook syncs cannot recreate a charge or entitlement after deletion.
select ok(
  public.lock_platform_membership_account_for_deletion('60000000-0000-0000-0000-000000000007'),
  'account closure installs a persistent platform billing lock'
);
select is(
  (select outcome from public.reserve_platform_checkout('60000000-0000-0000-0000-000000000007', 'regular')),
  'account_deleting', 'checkout is blocked after account closure begins'
);
select ok(
  not public.attach_platform_checkout_session(
    '60000000-0000-0000-0000-000000000007',
    (select request_id from public.platform_checkout_attempts where member_id = '60000000-0000-0000-0000-000000000007'),
    'cs_platform_after_delete_lock', now() + interval '1 hour'
  ),
  'an in-flight checkout cannot attach after account closure begins'
);
select is(
  public.sync_platform_membership(
    '60000000-0000-0000-0000-000000000007', 'premium', 'sub_platform_order', 'cus_platform_order',
    'price_premium_test', 'active', now() + interval '30 days', false, 104, 'evt_platform_order_after_delete',
    null, 5
  ),
  'deleting', 'a late webhook after account closure is terminal and cannot restore entitlement'
);
select is((select status from public.platform_memberships where stripe_subscription_id = 'sub_platform_order'), 'canceled', 'late webhook did not rewrite the canceled subscription');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"60000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.armory_items where category = 'other'), 1, 'an owned legacy paid download stays available after membership expiry');
reset role;

select * from finish();
rollback;
