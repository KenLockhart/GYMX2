begin;
select plan(67);

-- These three free-course rows are seeded before the migration in the owned disposable clone.
select is(
  (select v.revision_kind from public.program_content_versions v
   where v.program_id = 'e3000000-0000-0000-0000-000000000001' and v.revision_number = 1),
  'current',
  'migration backfills an immutable current revision for an existing free Program'
);
select is(
  (select v.lesson_count::integer from public.program_content_versions v
   where v.program_id = 'e3000000-0000-0000-0000-000000000001' and v.revision_number = 1),
  2,
  'backfilled revision records the original lesson count'
);
select is(
  (select count(*)::integer from public.program_content_version_lessons l
   where l.program_id = 'e3000000-0000-0000-0000-000000000001' and l.content_version_id = (
     select v.id from public.program_content_versions v
     where v.program_id = 'e3000000-0000-0000-0000-000000000001' and v.revision_number = 1
   )),
  2,
  'backfill snapshots both legacy program days'
);
select is(
  (select l.cloudflare_uid from public.program_content_version_lessons l
   where l.source_day_id = 'e4000000-0000-0000-0000-000000000001'),
  'legacy-program-day-uid',
  'backfill preserves the existing media UID independently of its video row'
);
select is(
  (select l.cloudflare_signed_urls_verified from public.program_content_version_lessons l
   where l.source_day_id = 'e4000000-0000-0000-0000-000000000001'),
  false,
  'existing provider media is not falsely marked signed-only verified'
);
select is(
  (select o.offer_kind from public.program_offer_versions o
   where o.program_id = 'e3000000-0000-0000-0000-000000000001' and o.offer_number = 1),
  'free',
  'existing free Programs receive a free initial offer'
);
select is(
  (select state.current_content_version_id = version.id and state.current_offer_version_id = offer.id
   from public.program_commerce_state state
   join public.program_content_versions version on version.program_id = state.program_id and version.revision_number = 1
   join public.program_offer_versions offer on offer.program_id = state.program_id and offer.offer_number = 1
   where state.program_id = 'e3000000-0000-0000-0000-000000000001'),
  true,
  'backfilled state points to the matching initial version and offer'
);
select is(
  (select content_version_id from public.program_enrollments where id = 'e5000000-0000-0000-0000-000000000001'),
  null::uuid,
  'ordinary free enrollment remains on its existing dynamic path after backfill'
);
select is(
  (select count(*)::integer from public.program_day_completions
   where enrollment_id = 'e5000000-0000-0000-0000-000000000001'),
  1,
  'backfill leaves existing free completion history untouched'
);

select ok(not has_table_privilege('anon', 'public.program_content_versions', 'select'), 'anonymous clients cannot read immutable content snapshots');
select ok(not has_table_privilege('authenticated', 'public.program_content_version_lessons', 'select'), 'signed-in clients cannot read private snapshot rows directly');
select ok(not has_table_privilege('authenticated', 'public.program_offer_versions', 'insert'), 'signed-in clients cannot create offer versions');
select ok(has_table_privilege('service_role', 'public.program_offer_versions', 'insert'), 'only the service role can create offer versions');
select ok(not has_column_privilege('authenticated', 'public.program_enrollments', 'content_version_id', 'update'), 'members cannot choose their enrollment content version');
select ok(not has_column_privilege('authenticated', 'public.program_enrollments', 'content_version_id', 'insert'), 'members cannot provide a content version when inserting an enrollment');
select ok(has_column_privilege('authenticated', 'public.program_enrollments', 'program_id', 'insert'), 'members retain column-scoped insertion for ordinary free enrollments');
select ok(has_column_privilege('service_role', 'public.program_enrollments', 'content_version_id', 'update'), 'the service role can pin a conversion snapshot to existing enrollments');
select ok(not has_column_privilege('service_role', 'public.program_enrollments', 'started_on', 'update'), 'the service role cannot rewrite the existing free enrollment start date');
select ok(not has_function_privilege('authenticated', 'public.snapshot_program_free_content(uuid)', 'execute'), 'members cannot run free-to-paid conversion');
select ok(has_function_privilege('service_role', 'public.snapshot_program_free_content(uuid)', 'execute'), 'the server can run free-to-paid conversion');
select ok(not has_function_privilege('authenticated', 'private.program_paid_media_uid_is_retained(text)', 'execute'), 'the media-retention lookup is not exposed to member clients');
select ok(has_function_privilege('service_role', 'private.program_paid_media_uid_is_retained(text)', 'execute'), 'the media-retention helper is available to trusted server code');

insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by)
values
  ('e1000000-0000-0000-0000-000000000003', 'regular', 'Synthetic Program commerce test', 'e1000000-0000-0000-0000-000000000002'),
  ('e1000000-0000-0000-0000-000000000005', 'regular', 'Synthetic Program commerce test', 'e1000000-0000-0000-0000-000000000002');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
select lives_ok(
  $$select public.snapshot_program_free_content('e3000000-0000-0000-0000-000000000001')$$,
  'conversion snapshots the existing free course and pins current free enrollments'
);
reset role;

select is(
  (select v.revision_kind from public.program_commerce_state state
   join public.program_content_versions v on v.id = state.current_content_version_id
   where state.program_id = 'e3000000-0000-0000-0000-000000000001'),
  'free_snapshot',
  'conversion makes the free snapshot the current content boundary'
);
select is(
  (select content_version_id from public.program_enrollments where id = 'e5000000-0000-0000-0000-000000000001'),
  (select id from public.program_content_versions where program_id = 'e3000000-0000-0000-0000-000000000001' and revision_kind = 'free_snapshot'),
  'existing enrollment points at the free snapshot without a paid order'
);
select is(
  (select count(*)::integer from public.program_day_completions
   where enrollment_id = 'e5000000-0000-0000-0000-000000000001'),
  1,
  'conversion preserves free completion history'
);
select ok(
  (select not l.cloudflare_signed_urls_verified
   from public.program_content_version_lessons l
   where l.source_day_id = 'e4000000-0000-0000-0000-000000000001'
     and l.content_version_id = (select content_version_id from public.program_enrollments where id = 'e5000000-0000-0000-0000-000000000001')),
  'conversion retains the existing media UID without inventing provider verification'
);

-- Exercise the trigger with a browser JWT while current_user remains the database owner.
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select throws_ok(
  $$insert into public.program_enrollments (id, program_id, member_id, started_on, content_version_id)
    values (
      'e5000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000001',
      'e1000000-0000-0000-0000-000000000005', (now() at time zone 'America/New_York')::date,
      (select id from public.program_content_versions where program_id = 'e3000000-0000-0000-0000-000000000001' and revision_kind = 'free_snapshot')
    )$$,
  '42501', null,
  'the enrollment trigger rejects caller-supplied pins based on JWT role, not SECURITY DEFINER current_user'
);
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select lives_ok(
  $$delete from public.program_enrollments where id = 'e5000000-0000-0000-0000-000000000001'$$,
  'a member may still leave a free enrollment'
);
select throws_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on, content_version_id)
    values (
      'e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003',
      (now() at time zone 'America/New_York')::date,
      (select id from public.program_content_versions where program_id = 'e3000000-0000-0000-0000-000000000001' and revision_kind = 'free_snapshot')
    )$$,
  '42501', null,
  'a member cannot select a grandfathered snapshot when re-enrolling'
);
select lives_ok(
  $$insert into public.program_enrollments (program_id, member_id, started_on)
    values ('e3000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000003', (now() at time zone 'America/New_York')::date)$$,
  'ordinary free re-enrollment with an omitted content version still works'
);
select is(
  (select content_version_id from public.program_enrollments where program_id = 'e3000000-0000-0000-0000-000000000001' and member_id = 'e1000000-0000-0000-0000-000000000003'),
  null::uuid,
  're-enrollment receives a null pin and cannot recover the old grandfathered version'
);
reset role;

-- A distinct legacy-free Program still allows the old dynamic day table to grow.
insert into public.programs (id, coach_id, title, description, published)
values ('e3000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'Still free', '', true);
select lives_ok(
  $$insert into public.program_days (id, program_id, day_number, title, pillar)
    values ('e4000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000003', 1, 'New free day', 'body')$$,
  'the migration does not block existing free-program day editing'
);

select is(private.program_paid_lesson_ceiling(42, 3, 1), 14, 'SQL stage helper opens floor(D*k/N) ordinals');
select is(private.program_paid_lesson_ceiling(42, 3, 3), 42, 'SQL stage helper opens the final ordinal only at full payment');
select is(private.program_paid_lesson_ceiling(null, 3, 1), 0, 'SQL stage helper fails closed on null lesson counts');
select is(private.program_paid_lesson_ceiling(42, 13, 1), 0, 'SQL stage helper enforces the twelve-installment cap');

-- Build an eligible coach-owned paid offer with an isolated, creator-owned private video.
insert into public.programs (id, coach_id, title, published)
values ('e3000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'Paid test program', true);
insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility) values
  ('e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'paid-program-private-uid', 'Paid private lesson', 'ready', 'private'),
  ('e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'paid-program-members-uid', 'Existing members video', 'ready', 'members');
insert into public.program_days (program_id, day_number, title, pillar) values
  ('e3000000-0000-0000-0000-000000000002', 1, 'Paid day one', 'body'),
  ('e3000000-0000-0000-0000-000000000002', 2, 'Paid day two', 'mind'),
  ('e3000000-0000-0000-0000-000000000002', 3, 'Paid day three', 'spirit');
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 2, 'paid', 3, 'e1000000-0000-0000-0000-000000000002');
insert into public.program_content_version_lessons (
  program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
  video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
) values
  ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000001', 1, 1, 'Lesson one', 'body', 'e2000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'paid-program-private-uid', true),
  ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000001', 2, 2, 'Lesson two', 'mind', null, null, null, false),
  ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000001', 3, 3, 'Lesson three', 'spirit', null, null, null, false);
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'e7000000-0000-0000-0000-000000000001', 'e3000000-0000-0000-0000-000000000002', 2,
  'e6000000-0000-0000-0000-000000000001', 'paid', 1200, 'usd', 3, false,
  'e1000000-0000-0000-0000-000000000002', 'acct_foundation123', 'e1000000-0000-0000-0000-000000000002'
);
update public.program_commerce_state
set current_content_version_id = 'e6000000-0000-0000-0000-000000000001',
    current_offer_version_id = 'e7000000-0000-0000-0000-000000000001'
where program_id = 'e3000000-0000-0000-0000-000000000002';

select throws_ok(
  $$insert into public.program_offer_versions (
      program_id, offer_number, content_version_id, offer_kind, list_price_cents,
      currency, max_installments, platform_owned, seller_profile_id, connected_account_id
    ) values (
      'e3000000-0000-0000-0000-000000000002', 3, 'e6000000-0000-0000-0000-000000000001',
      'paid', 1200, 'usd', 13, false, 'e1000000-0000-0000-0000-000000000002', 'acct_foundation123'
    )$$,
  '23514', null,
  'paid offer cannot configure more than twelve monthly installments'
);

insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002', 3, 'paid', 1, 'e1000000-0000-0000-0000-000000000002');
select lives_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000002', 1, 1,
      'Instructions revised, protected video retained', 'body', 'e2000000-0000-0000-0000-000000000003',
      'e1000000-0000-0000-0000-000000000002', 'paid-program-private-uid', true
    )$$,
  'a later paid revision may retain the exact verified private asset from this Program'
);
insert into public.program_offer_versions (
  id, program_id, offer_number, content_version_id, offer_kind, list_price_cents,
  currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
) values (
  'e7000000-0000-0000-0000-000000000002', 'e3000000-0000-0000-0000-000000000002', 3,
  'e6000000-0000-0000-0000-000000000002', 'paid', 600, 'usd', 1, false,
  'e1000000-0000-0000-0000-000000000002', 'acct_foundation123', 'e1000000-0000-0000-0000-000000000002'
);
update public.program_commerce_state
set current_content_version_id = 'e6000000-0000-0000-0000-000000000002',
    current_offer_version_id = 'e7000000-0000-0000-0000-000000000002'
where program_id = 'e3000000-0000-0000-0000-000000000002';
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar
    ) values ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000002', 1, 1, 'Text-only append', 'body')$$,
  '23514', null,
  'a text-only lesson cannot be appended after an offer seals the version'
);

insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000003', 'e3000000-0000-0000-0000-000000000002', 4, 'paid', 2, 'e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar
    ) values ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000003', 3, 3, 'Out of range', 'body')$$,
  '23514', null,
  'lesson ordinal cannot exceed the declared version lesson count'
);
insert into public.program_content_version_lessons (
  program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar
) values
  ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000003', 1, 2, 'Later day first', 'body'),
  ('e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000003', 2, 1, 'Earlier day second', 'mind');
select throws_ok(
  $$insert into public.program_offer_versions (
      program_id, offer_number, content_version_id, offer_kind, list_price_cents,
      currency, max_installments, platform_owned, seller_profile_id, connected_account_id
    ) values (
      'e3000000-0000-0000-0000-000000000002', 4, 'e6000000-0000-0000-0000-000000000003',
      'paid', 600, 'usd', 2, false, 'e1000000-0000-0000-0000-000000000002', 'acct_foundation123'
    )$$,
  '23514', null,
  'offer cannot freeze lesson ordinals that move backward in the daily timeline'
);

insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000004', 'e3000000-0000-0000-0000-000000000003', 2, 'paid', 1, 'e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000003', 'e6000000-0000-0000-0000-000000000004', 1, 1,
      'Cross Program reuse', 'body', 'e2000000-0000-0000-0000-000000000003',
      'e1000000-0000-0000-0000-000000000002', 'paid-program-private-uid', true
    )$$,
  '23514', null,
  'a different Program cannot retain another Program’s paid UID'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select ok(private.is_eligible_paid_program_buyer('e3000000-0000-0000-0000-000000000002'), 'linked active Regular member passes paid-buyer eligibility');
select ok(not private.is_eligible_paid_program_buyer('e3000000-0000-0000-0000-000000000001'), 'free offer is not treated as paid-buyer eligibility');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select ok(not private.is_eligible_paid_program_buyer('e3000000-0000-0000-0000-000000000002'), 'active member without the coach link fails buyer eligibility');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select ok(not private.is_eligible_paid_program_buyer('e3000000-0000-0000-0000-000000000002'), 'coach role is not buyer eligibility');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::integer from public.programs where id = 'e3000000-0000-0000-0000-000000000001'), 1, 'existing linked member can still see the published free Program');
select is((select count(*)::integer from public.program_days where program_id = 'e3000000-0000-0000-0000-000000000001'), 2, 'existing free Program day visibility remains on the old path');
select is((select count(*)::integer from public.videos where id = 'e2000000-0000-0000-0000-000000000001'), 0, 'program enrollment still does not grant direct private Library video access');
reset role;

-- These media rejection cases use a fresh, unsealed, in-bounds paid revision so the media
-- validators, not the sealing/ordinal guards, determine the expected failure.
insert into public.videos (id, coach_id, cloudflare_uid, title, status, visibility)
values ('e2000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000002', 'legacy-program-intro-uid', 'Program intro', 'ready', 'private');
update public.programs set intro_video_id = 'e2000000-0000-0000-0000-000000000005'
where id = 'e3000000-0000-0000-0000-000000000001';
insert into public.programs (id, coach_id, title, published)
values ('e3000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002', 'Media rejection fixture', false);
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000007', 'e3000000-0000-0000-0000-000000000004', 2, 'paid', 1, 'e1000000-0000-0000-0000-000000000002');

select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000004', 'e6000000-0000-0000-0000-000000000007', 1, 1,
      'Reuse intro', 'body', 'e2000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000002',
      'legacy-program-intro-uid', true
    )$$,
  '23514', 'Paid Program media cannot reuse an intro, free lesson, Task, or Daily Fuel video',
  'paid lesson cannot reuse an intro-video UID'
);
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000004', 'e6000000-0000-0000-0000-000000000007', 1, 1,
      'Reuse members video', 'body', 'e2000000-0000-0000-0000-000000000004', 'e1000000-0000-0000-0000-000000000002',
      'paid-program-members-uid', true
    )$$,
  '23514', 'Paid media must be a ready private Program asset owned by the Program creator',
  'already member-visible media cannot be converted into exclusive paid content'
);
select ok(private.program_paid_media_uid_is_retained('paid-program-private-uid'), 'paid snapshot retains the exact provider UID');
select throws_ok(
  $$update public.programs set intro_video_id = 'e2000000-0000-0000-0000-000000000003'
    where id = 'e3000000-0000-0000-0000-000000000002'$$,
  '23514', null,
  'intro video cannot reuse a retained paid-media UID'
);
select throws_ok(
  $$update public.videos set cloudflare_uid = 'replacement-paid-uid' where id = 'e2000000-0000-0000-0000-000000000003'$$,
  '23514', null,
  'a retained paid provider UID cannot be changed on its video row'
);
select throws_ok(
  $$insert into public.tasks (coach_id, video_id, title)
    values ('e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000003', 'Protected video task')$$,
  '23514', null,
  'paid-only media cannot be assigned through Tasks'
);
select throws_ok(
  $$insert into public.member_daily_fuel_assignments (member_id, coach_id, video_id, day)
    values ('e1000000-0000-0000-0000-000000000003', 'e1000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000003', current_date)$$,
  '23514', null,
  'paid-only media cannot be featured as Daily Fuel'
);
select throws_ok(
  $$insert into public.member_daily_fuel_bookmarks (member_id, video_id)
    values ('e1000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000003')$$,
  '23514', null,
  'paid-only media cannot be saved through the Daily Fuel bookmark surface'
);
select throws_ok(
  $$insert into public.program_days (program_id, day_number, title, pillar, video_id)
    values ('e3000000-0000-0000-0000-000000000003', 2, 'Protected free day', 'body', 'e2000000-0000-0000-0000-000000000003')$$,
  '23514', null,
  'paid-only media cannot be attached to an ordinary free-program day'
);
select throws_ok(
  $$delete from public.programs where id = 'e3000000-0000-0000-0000-000000000002'$$,
  '23503', null,
  'a Program with a paid offer cannot be deleted and cascade its historical media identity'
);
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('e6000000-0000-0000-0000-000000000005', 'e3000000-0000-0000-0000-000000000002', 5, 'paid', 1, 'e1000000-0000-0000-0000-000000000002');
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000005', 1, 1,
      'Wrong captured creator', 'body', 'e2000000-0000-0000-0000-000000000003',
      'e1000000-0000-0000-0000-000000000003', 'paid-program-private-uid', true
    )$$,
  '23514', null,
  'a paid media snapshot cannot name a creator other than the verified video owner'
);
select throws_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000005', 1, 1,
      'Missing captured creator', 'body', 'e2000000-0000-0000-0000-000000000003',
      null, 'paid-program-private-uid', true
    )$$,
  '23514', null,
  'a paid media snapshot must preserve the verified creator ID for later revisions'
);
select lives_ok(
  $$delete from public.videos where id = 'e2000000-0000-0000-0000-000000000003'$$,
  'the catalog video row may be removed while its immutable paid UID remains retained'
);
select ok(private.program_paid_media_uid_is_retained('paid-program-private-uid'), 'deleting a video row does not erase the paid snapshot UID');
select lives_ok(
  $$insert into public.program_content_version_lessons (
      program_id, content_version_id, lesson_ordinal, timeline_day_number, title, pillar,
      video_id, video_creator_id, cloudflare_uid, cloudflare_signed_urls_verified
    ) values (
      'e3000000-0000-0000-0000-000000000002', 'e6000000-0000-0000-0000-000000000005', 1, 1,
      'Instructions revised after catalog removal', 'body', 'e2000000-0000-0000-0000-000000000003',
      'e1000000-0000-0000-0000-000000000002', 'paid-program-private-uid', true
    )$$,
  'a revision can retain an exact previously verified asset after its editable video row is deleted'
);
select is(
  (select cloudflare_uid from public.program_content_version_lessons where content_version_id = 'e6000000-0000-0000-0000-000000000005'),
  'paid-program-private-uid',
  'the later revision preserves the immutable provider UID'
);
select lives_ok(
  $$insert into public.program_offer_versions (
      program_id, offer_number, content_version_id, offer_kind, list_price_cents,
      currency, max_installments, platform_owned, seller_profile_id, connected_account_id
    ) values (
      'e3000000-0000-0000-0000-000000000002', 4, 'e6000000-0000-0000-0000-000000000005',
      'paid', 600, 'usd', 1, false, 'e1000000-0000-0000-0000-000000000002', 'acct_foundation123'
    )$$,
  'a complete revision may offer a retained asset even after the catalog row is deleted'
);

select * from finish();
rollback;
