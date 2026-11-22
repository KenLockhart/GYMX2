begin;
select no_plan();

-- Isolated Gate 4 fixture and actual database-role/JWT behavior; this test never calls Stripe.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000002', 'g4-coach@example.test', '{"display_name":"Gate Four Coach"}'),
  ('f1000000-0000-0000-0000-000000000003', 'g4-buyer@example.test', '{"display_name":"Gate Four Buyer"}'),
  ('f1000000-0000-0000-0000-000000000004', 'g4-outsider@example.test', '{"display_name":"Gate Four Outsider"}'),
  ('f1000000-0000-0000-0000-000000000005', 'g4-admin@example.test', '{"display_name":"Gate Four Admin"}'),
  ('f1000000-0000-0000-0000-000000000006', 'g4-onetime@example.test', '{"display_name":"Gate Four One-time Buyer"}'),
  ('f1000000-0000-0000-0000-000000000007', 'g4-installment@example.test', '{"display_name":"Gate Four Installment Buyer"}'),
  ('f1000000-0000-0000-0000-000000000008', 'g4-checkout-drain@example.test', '{"display_name":"Gate Four Checkout Drain Buyer"}'),
  ('f1000000-0000-0000-0000-000000000009', 'g4-null-pi-retry@example.test', '{"display_name":"Gate Four Null PI Retry Buyer"}'),
  ('f1000000-0000-0000-0000-000000000010', 'g4-draft-only-delete@example.test', '{"display_name":"Gate Four Draft Only Delete Buyer"}'),
  ('f1000000-0000-0000-0000-000000000011', 'g4-item-bound-delete@example.test', '{"display_name":"Gate Four Item Bound Delete Buyer"}'),
  ('f1000000-0000-0000-0000-000000000012', 'g4-buyer-null-pi-drain@example.test', '{"display_name":"Gate Four Buyer Null PI Drain"}'),
  ('f1000000-0000-0000-0000-000000000013', 'g4-first-delete@example.test', '{"display_name":"Gate Four First Deletion Buyer"}'),
  ('f1000000-0000-0000-0000-000000000014', 'g4-bound-delete@example.test', '{"display_name":"Gate Four Bound Deletion Buyer"}'),
  ('f1000000-0000-0000-0000-000000000015', 'g4-zero-total-delete@example.test', '{"display_name":"Gate Four Zero Total Deletion Buyer"}'),
  ('f1000000-0000-0000-0000-000000000016', 'g4-completed-cancel-delete@example.test', '{"display_name":"Gate Four Completed Cancellation Buyer"}'),
  ('f1000000-0000-0000-0000-000000000017', 'g4-text-only-paid@example.test', '{"display_name":"Gate Four Text Only Paid Buyer"}'),
  ('f1000000-0000-0000-0000-000000000018', 'g4-text-only-unpaid@example.test', '{"display_name":"Gate Four Text Only Unpaid Buyer"}');
update public.profiles set role = 'coach' where id = 'f1000000-0000-0000-0000-000000000002';
update public.profiles set role = 'member' where id in ('f1000000-0000-0000-0000-000000000003','f1000000-0000-0000-0000-000000000004','f1000000-0000-0000-0000-000000000006','f1000000-0000-0000-0000-000000000007','f1000000-0000-0000-0000-000000000008','f1000000-0000-0000-0000-000000000009','f1000000-0000-0000-0000-000000000010','f1000000-0000-0000-0000-000000000011','f1000000-0000-0000-0000-000000000012','f1000000-0000-0000-0000-000000000013','f1000000-0000-0000-0000-000000000014','f1000000-0000-0000-0000-000000000015','f1000000-0000-0000-0000-000000000016','f1000000-0000-0000-0000-000000000017','f1000000-0000-0000-0000-000000000018');
update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-000000000005';
insert into public.platform_test_entitlements (member_id, tier, grant_reason, granted_by) values
  ('f1000000-0000-0000-0000-000000000003', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000004', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000006', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000007', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000008', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000009', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000010', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000011', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000012', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000013', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000014', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000015', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000016', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000017', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-000000000018', 'regular', 'Synthetic Gate 4 test', 'f1000000-0000-0000-0000-000000000002');
insert into public.coach_members (coach_id, member_id) values
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000003'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000004'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000006'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000007'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000008'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000009'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000010'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000011'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000012'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000013'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000014'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000015'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000016'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000017'),
  ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000018')
on conflict (coach_id, member_id) do nothing;

-- Synthetic, local provider observations below exercise the ordinary media lifecycle RPCs.
-- They prove the billing retention contract only and make no external provider calls.
reset role;
create function pg_temp.make_ready_billing_test_video(
  target_video_id uuid,target_owner_id uuid,target_uid text,target_registry_id uuid,target_parent_revision bigint
) returns jsonb language plpgsql as $fixture$
declare
  intent_id uuid := gen_random_uuid();
  operation_id uuid := gen_random_uuid();
  observation_request uuid := gen_random_uuid();
  result jsonb;
begin
  result := public.record_stream_media_upload_intent(intent_id,gen_random_uuid(),target_owner_id,
    'library_video','video',target_video_id,0,target_registry_id,gen_random_uuid(),repeat('3',64));
  if result->>'outcome'<>'recorded' then raise exception 'Synthetic media intent failed: %',result->>'outcome'; end if;
  result := public.record_stream_upload_context(gen_random_uuid(),intent_id,'profile',target_owner_id::text,
    target_owner_id,target_parent_revision,repeat('4',64));
  if result->>'outcome'<>'context_recorded' then raise exception 'Synthetic media context failed: %',result->>'outcome'; end if;
  result := public.reserve_stream_media_upload(operation_id,gen_random_uuid(),intent_id,repeat('5',64));
  if result->>'outcome'<>'reserved' then raise exception 'Synthetic media reserve failed: %',result->>'outcome'; end if;
  result := public.advance_stream_media_upload(operation_id,gen_random_uuid(),'create_started',repeat('6',64));
  if result->>'outcome'<>'advanced' then raise exception 'Synthetic media start failed: %',result->>'outcome'; end if;
  result := public.advance_stream_media_upload(operation_id,gen_random_uuid(),'created_unverified',repeat('7',64));
  if result->>'outcome'<>'advanced' then raise exception 'Synthetic media create failed: %',result->>'outcome'; end if;
  result := public.record_stream_media_upload_observation(operation_id,target_registry_id,'exact_uid_get',target_uid,
    200::smallint,true,true,true,true,observation_request,repeat('8',64));
  if result->>'outcome'<>'recorded' then raise exception 'Synthetic media observation failed: %',result->>'outcome'; end if;
  result := public.bind_stream_media_upload_readback(operation_id,observation_request,gen_random_uuid());
  if result->>'outcome'<>'provisional_bound' then raise exception 'Synthetic media binding failed: %',result->>'outcome'; end if;
  perform set_config('app.stream_media_operation_id',operation_id::text,true);
  insert into public.videos(id,coach_id,cloudflare_uid,title,description,status,visibility,stream_provider_account_registry_id)
  values(target_video_id,target_owner_id,target_uid,'Synthetic billing retention video','','uploading','private',target_registry_id);
  result := public.finalize_stream_media_upload(operation_id,gen_random_uuid(),repeat('9',64));
  perform set_config('app.stream_media_operation_id','',true);
  return result;
end;
$fixture$;
select set_config('test.g4_retention_parent_revision',coalesce((select fence.source_revision::text
  from public.stream_media_parent_fences fence
  where fence.source_kind='profile' and fence.source_identity='f1000000-0000-0000-0000-000000000002'),'1'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('test.g4_media_registry_id',public.record_stream_provider_account_attestation(
  'f3100000-0000-0000-0000-000000000016',repeat('a',32),'vod_primary',repeat('1',64))->>'registry_id',true);
select is(public.record_stream_account_path_verification('f3100000-0000-0000-0000-000000000017',
  current_setting('test.g4_media_registry_id')::uuid,'vod_primary',repeat('a',32),200::smallint,repeat('2',64))->>'outcome',
  'verified','synthetic local fixture verifies media through the ordinary account-path RPC');
select set_config('test.g4_retention_video_result',pg_temp.make_ready_billing_test_video(
  'f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002',
  'g4-synthetic-retention-uid',current_setting('test.g4_media_registry_id')::uuid,
  current_setting('test.g4_retention_parent_revision')::bigint
)::text,true);
select is(current_setting('test.g4_retention_video_result')::jsonb->>'outcome','ready_for_publication',
  'synthetic source completes exact readback and source finalization before any order exists');
reset role;
select ok(exists(select 1 from public.stream_media_assets asset
  where asset.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and asset.raw_provider_uid='g4-synthetic-retention-uid' and asset.lifecycle_state='ready_for_publication'
    and asset.signed_urls_verified and asset.ready_to_stream_verified),
  'nonempty retention assertions use an existing ready source asset');
select ok(exists(select 1 from public.stream_media_source_bindings binding
  where binding.source_kind='video' and binding.source_identity='f2000000-0000-0000-0000-000000000001'
    and binding.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and binding.raw_provider_uid='g4-synthetic-retention-uid' and binding.owner_id='f1000000-0000-0000-0000-000000000002'
    and binding.binding_state in ('ready_for_publication','active')),
  'synthetic coach-owned video has its exact lifecycle-created source binding');
reset role;

insert into public.programs (id, coach_id, title, description, published)
values ('f3000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000002', 'Gate Four billing fixture', '', true);
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
select 'f6000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001',
  coalesce(max(version.revision_number),0) + 1, 'paid', 3, 'f1000000-0000-0000-0000-000000000002'
from public.program_content_versions version where version.program_id = 'f3000000-0000-0000-0000-000000000001';
insert into public.program_content_version_lessons (program_id, content_version_id, lesson_ordinal, timeline_day_number, title, instructions, pillar,
  video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified) values
  ('f3000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 1, 1, 'Gate Four lesson one', '', 'body',
    'f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002','g4-synthetic-retention-uid',true),
  ('f3000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 2, 2, 'Gate Four lesson two', '', 'mind',
    default,default,default,default),
  ('f3000000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', 3, 3, 'Gate Four lesson three', '', 'spirit',
    default,default,default,default);
insert into public.program_offer_versions (id, program_id, offer_number, content_version_id, offer_kind, list_price_cents, currency, max_installments, platform_owned, seller_profile_id, connected_account_id, created_by)
select 'f7000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001',
  coalesce(max(offer.offer_number),0) + 1, 'f6000000-0000-0000-0000-000000000001', 'paid', 2000, 'usd', 2, false,
  'f1000000-0000-0000-0000-000000000002', 'acct_g4coach1', 'f1000000-0000-0000-0000-000000000002'
from public.program_offer_versions offer where offer.program_id = 'f3000000-0000-0000-0000-000000000001';
update public.program_commerce_state set current_content_version_id = 'f6000000-0000-0000-0000-000000000001', current_offer_version_id = 'f7000000-0000-0000-0000-000000000001'
where program_id = 'f3000000-0000-0000-0000-000000000001';
insert into public.program_promotions (id, program_id, offer_version_id, code, discount_kind, discount_value, max_redemptions, created_by) values
  ('f8000000-0000-0000-0000-000000000001', 'f3000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'G4RETRY', 'fixed', 200, 1, 'f1000000-0000-0000-0000-000000000002'),
  ('f8000000-0000-0000-0000-000000000002', 'f3000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'G4LOST', 'fixed', 200, 1, 'f1000000-0000-0000-0000-000000000002'),
  ('f8000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'G4FIRSTDELETE', 'fixed', 200, 1, 'f1000000-0000-0000-0000-000000000002'),
  ('f8000000-0000-0000-0000-000000000005', 'f3000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'G4BOUNDDELETE', 'fixed', 200, 1, 'f1000000-0000-0000-0000-000000000002'),
  ('f8000000-0000-0000-0000-000000000004', 'f3000000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', 'G4ZERO', 'percent', 10000, 1, 'f1000000-0000-0000-0000-000000000002');

insert into public.programs (id, coach_id, title, description, published)
values ('f3000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002', 'Gate Four text-only billing fixture', '', true);
insert into public.program_content_versions (id, program_id, revision_number, revision_kind, lesson_count, created_by)
values ('f6000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002',2,'paid',2,
  'f1000000-0000-0000-0000-000000000002');
insert into public.program_content_version_lessons (
  program_id,content_version_id,lesson_ordinal,timeline_day_number,title,instructions,pillar,
  video_id,video_creator_id,cloudflare_uid,cloudflare_signed_urls_verified
) values
  ('f3000000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-000000000002',1,1,'Text lesson one','','body',null,null,null,false),
  ('f3000000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-000000000002',2,2,'Text lesson two','','mind',null,null,null,false);
insert into public.program_offer_versions (
  id,program_id,offer_number,content_version_id,offer_kind,list_price_cents,currency,max_installments,
  platform_owned,seller_profile_id,connected_account_id,created_by
) values ('f7000000-0000-0000-0000-000000000002','f3000000-0000-0000-0000-000000000002',2,
  'f6000000-0000-0000-0000-000000000002','paid',1200,'usd',2,false,
  'f1000000-0000-0000-0000-000000000002','acct_g4coach1','f1000000-0000-0000-0000-000000000002');
update public.program_commerce_state set current_content_version_id='f6000000-0000-0000-0000-000000000002',
  current_offer_version_id='f7000000-0000-0000-0000-000000000002'
where program_id='f3000000-0000-0000-0000-000000000002';
insert into public.program_promotions (id,program_id,offer_version_id,code,discount_kind,discount_value,max_redemptions,created_by)
values ('f8000000-0000-0000-0000-000000000006','f3000000-0000-0000-0000-000000000002',
  'f7000000-0000-0000-0000-000000000002','G4TEXTUNPAID','fixed',200,1,
  'f1000000-0000-0000-0000-000000000002');

select ok(not has_table_privilege('anon', 'public.program_billing_orders', 'select'), 'anonymous users cannot read Program billing rows');
select ok(not has_table_privilege('authenticated', 'public.program_billing_checkout_attempts', 'select'), 'members cannot read provider attempt IDs');
select ok(not has_table_privilege('authenticated', 'public.program_billing_operations', 'insert'), 'members cannot create provider-operation rows');
select ok(not has_table_privilege('service_role', 'public.program_billing_orders', 'select'), 'service code uses typed RPCs instead of direct billing-table reads');
select ok(has_function_privilege('authenticated', 'public.request_program_checkout_retry(uuid,uuid)', 'execute'), 'signed-in buyers have only the explicit retry request path');
select ok(not has_function_privilege('authenticated', 'public.advance_program_checkout_attempt(uuid,bigint,uuid,jsonb,text)', 'execute'), 'clients cannot certify terminal provider inventory');
select ok(has_function_privilege('service_role', 'public.advance_program_checkout_attempt(uuid,bigint,uuid,jsonb,text)', 'execute'), 'trusted server role owns provider reconciliation');
select ok(not has_function_privilege('authenticated', 'public.get_program_billing_draft_invoice_delete(uuid,smallint,text)', 'execute'), 'clients cannot read persisted draft deletion snapshots');
select ok(has_function_privilege('service_role', 'public.get_program_billing_draft_invoice_delete(uuid,smallint,text)', 'execute'), 'trusted server retrieves draft deletion snapshots through the narrow RPC');
select ok(not has_table_privilege('service_role','private.program_order_closing_receipts','select')
  and not has_table_privilege('service_role','private.program_order_closing_receipts','insert'),
  'service role cannot read or forge private Gate 1 closing receipts');
select ok(not has_function_privilege('service_role',
  'private.prepare_program_order_closing_receipt(uuid,bigint,text,bigint,bigint,boolean,jsonb,text)','execute'),
  'service role cannot mint a private Gate 1 closing receipt');
select ok(not has_function_privilege('anon','private.reconcile_program_order_retention_closing(uuid)','execute')
  and not has_function_privilege('authenticated','private.reconcile_program_order_retention_closing(uuid)','execute')
  and not has_function_privilege('service_role','private.reconcile_program_order_retention_closing(uuid)','execute'),
  'closing retention reconciliation has no app-role execute grant or GUC authority');
select ok(not has_function_privilege('authenticated', 'public.record_program_billing_settled_payment(uuid,bigint,text,smallint,smallint,text,text,text,text,integer,integer,text,timestamptz,text,jsonb,text)', 'execute'), 'clients cannot claim canonical paid stages');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000012","role":"authenticated"}';
select throws_ok($$select public.get_program_billing_draft_invoice_delete(
  'f3000000-0000-0000-0000-000000000001',2::smallint,'in_g4_forbidden_read')$$,
  '42501', null, 'authenticated buyers cannot retrieve internal draft deletion proof');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000003', 'f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001', 2::smallint, 'g4-program-order-001', 'G4RETRY'
)::text, true);
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  join public.program_content_version_lessons lesson on lesson.id::text=split_part(obligation.source_identity,':',2)
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_order_id')||':'||lesson.id::text
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'ordinary un-tombstoned order ingress creates an active nonempty checkout retention obligation');
select is((select count(*)::integer from public.stream_media_source_account_edges edge
  join public.stream_media_source_bindings binding on binding.id=edge.binding_id
  join public.program_content_version_lessons lesson on lesson.id::text=binding.source_identity
  where edge.account_id='f1000000-0000-0000-0000-000000000003' and edge.relation_kind='assigned_member'
    and binding.source_kind='program_lesson' and lesson.cloudflare_uid='g4-synthetic-retention-uid'),1,
  'ordinary order ingress creates the exact member source-account edge');
select set_config('test.g4_lesson_source_binding_id',coalesce((select binding.id::text from public.stream_media_source_bindings binding
  where binding.source_kind='program_lesson' and binding.source_identity=(select lesson.id::text
    from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
      and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and binding.raw_provider_uid='g4-synthetic-retention-uid' limit 1),'00000000-0000-0000-0000-000000000000'),true);

-- This fixture has historically accepted terms and an anchor due today. It uses
-- the normal production service RPCs for every provider lifecycle mutation.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_installment_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000007','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',2::smallint,'g4-program-installment-001',null
)::text,true);
reset role;
insert into public.program_billing_orders (
  order_id,revision,billing_state,terms_version,terms_digest,accepted_at,accepted_total_cents,
  accepted_installment_count,disclosed_charge_dates,off_session_consent,retry_window_days,
  cancellation_stops_future_charges
) values (
  current_setting('test.g4_installment_order_id')::uuid,1,'terms_saved',1,repeat('7',64),
  now() - interval '45 days',2000,2,array[(now() at time zone 'America/New_York')::date],true,7,true
);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_billing_customer(current_setting('test.g4_installment_order_id')::uuid,1::bigint,'acct_g4platform',false)->>'status'),
  'prepared','historical installment fixture creates an isolated Customer intent');
select ok(public.bind_program_billing_customer(current_setting('test.g4_installment_order_id')::uuid,2::bigint,'cus_g4_installment',
  jsonb_build_object('id','cus_g4_installment','deleted',false,'balance',0,'discountId',null,'taxExempt','none',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),'program_billing_purpose','program_order',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('8',64)),
  'service role binds the isolated installment Customer');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_installment_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/success?order=g4-installment','https://gymx2.test/programs/cancel?order=g4-installment')->>'status'),
  'prepared','installment Checkout attempt persists before provider creation');
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_installment_order_id')::uuid,1::smallint),
  'installment Checkout creation is durably unknown before binding');
reset role;
select set_config('test.g4_installment_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_installment_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_installment_order_id')::uuid,4::bigint,1::smallint,
  'cs_g4_installment','pi_g4_installment_first',
  jsonb_build_object('id','cs_g4_installment','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_installment','client_reference_id',current_setting('test.g4_installment_attempt_id'),
    'payment_intent_id','pi_g4_installment_first','mode','payment','currency','usd','amount_total',1000,'status','complete','payment_status','paid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_g4_installment','amount',1000,'currency','usd','application_fee_amount',100,
      'transfer_destination_id','acct_g4coach1','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),'program_checkout_attempt_number','1',
        'program_installment_number','1','program_billing_kind','program_sale','program_platform_account_id','acct_g4platform','program_livemode','false'))),repeat('9',64)),
  'initial installment Session and exact PI bind');
reset role;
select set_config('test.g4_installment_one_revision',(select revision::text from public.program_order_installments
  where order_id=current_setting('test.g4_installment_order_id')::uuid and installment_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_settled_payment(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_one_revision')::bigint,'evt_g4_installment_first',1::smallint,1::smallint,
  'cs_g4_installment',null,'pi_g4_installment_first','ch_g4_installment_first',1000,0,'usd',now()-interval '30 days',
  'pm_g4_installment_saved',jsonb_build_object(
    'checkout_session',jsonb_build_object('id','cs_g4_installment','customer_id','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'client_reference_id',current_setting('test.g4_installment_attempt_id'),'mode','payment','status','complete','payment_status','paid',
      'amount_total',1000,'currency','usd','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),'program_checkout_attempt_number','1',
        'program_installment_number','1','program_billing_kind','program_sale','program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_g4_installment_first','customer_id','cus_g4_installment','status','succeeded',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'amount',1000,'amount_received',1000,'currency','usd','application_fee_amount',100,'transfer_destination_id','acct_g4coach1',
      'payment_method_id','pm_g4_installment_saved','latest_charge_id','ch_g4_installment_first',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),'program_billing_kind','program_sale',
        'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_g4_installment_saved','customer_id','cus_g4_installment','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))),repeat('a',64))->>'status'),
  'settled','historically accepted first installment opens the staged ledger');
reset role;
select set_config('test.g4_installment_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_installment_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_billing_invoice(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_billing_revision')::bigint,2::smallint,
  (now() at time zone 'America/New_York')::date)->>'status'),'ready',
  'service role prepares the finite future installment invoice at its immutable anchor');
select ok(public.mark_program_billing_operation_unknown(current_setting('test.g4_installment_order_id')::uuid,'invoice_create',1::smallint,2::smallint,0::smallint),
  'Invoice create request is durably unknown before provider binding');
select ok(public.bind_program_billing_invoice(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_billing_revision')::bigint,2::smallint,'in_g4_installment',
  jsonb_build_object('id','in_g4_installment','customer_id','cus_g4_installment','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'currency','usd','auto_advance',false,
    'collection_method','charge_automatically','billing_reason','manual','status','draft','amount_due',0,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false')),repeat('b',64)),
  'exact standalone draft Invoice binds with auto_advance disabled');
select ok(public.mark_program_billing_operation_unknown(current_setting('test.g4_installment_order_id')::uuid,'invoice_item_create',1::smallint,2::smallint,0::smallint),
  'Invoice item creation is durably unknown before binding');
select ok(public.bind_program_billing_invoice_item(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_billing_revision')::bigint,2::smallint,'ii_g4_installment',
  jsonb_build_object('id','ii_g4_installment','invoice_id','in_g4_installment','customer_id','cus_g4_installment',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'amount',1000,
    'currency','usd','quantity',1,'discountable',false,'proration',false,'subscription_id',null,'discounts','[]'::jsonb,
    'tax_rates','[]'::jsonb,'tax_amounts','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_g4platform','program_livemode','false')),repeat('c',64)),
  'exact fixed amount no-tax no-discount line binds to the exact Invoice');
reset role;
with base as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_installment',
    'customer',jsonb_build_object('id','cus_g4_installment','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),'program_billing_purpose','program_order',
        'program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_installment','customerId','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId','pi_g4_installment_first','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(jsonb_build_object('id','pi_g4_installment_first','customerId','cus_g4_installment',
      'amount',1000,'amountReceived',1000,'currency','usd','applicationFeeAmount',100,'transferDestinationId','acct_g4coach1',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'deletedInvoices','[]'::jsonb,'invoices',jsonb_build_array(jsonb_build_object('id','in_g4_installment','customerId','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'currency','usd','autoAdvance',false,'billingReason','manual',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'lines',jsonb_build_array(jsonb_build_object('invoiceItemId','ii_g4_installment','amount',1000,'livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
        'metadata',jsonb_build_object('program_platform_account_id','acct_g4platform','program_livemode','false')))))) as inventory
), statuses(status_name) as (values ('uncollectible'),('void'))
select ok(bool_and(case when statuses.status_name = 'uncollectible'
    then not private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_installment_order_id')::uuid,
      jsonb_set(base.inventory,'{invoices,0,status}',to_jsonb(statuses.status_name),true))
    else private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_installment_order_id')::uuid,
      jsonb_set(base.inventory,'{invoices,0,status}',to_jsonb(statuses.status_name),true)) end),
  'uncollectible invoice is not terminal, while exact zero-paid void inventory is terminal')
from base cross join statuses;
with base as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_installment',
    'customer',jsonb_build_object('id','cus_g4_installment','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'discountId',null,'taxExempt','none',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_installment','customerId','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId','pi_g4_installment_first','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(jsonb_build_object('id','pi_g4_installment_first','customerId','cus_g4_installment',
      'amount',1000,'amountReceived',1000,'currency','usd','applicationFeeAmount',100,'transferDestinationId','acct_g4coach1',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'deletedInvoices','[]'::jsonb,'invoices',jsonb_build_array(jsonb_build_object('id','in_g4_installment','customerId','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'currency','usd','autoAdvance',false,
      'billingReason','manual','status','void','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'lines',jsonb_build_array(jsonb_build_object('invoiceItemId','ii_g4_installment','amount',1000,'livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
        'metadata',jsonb_build_object('program_platform_account_id','acct_g4platform','program_livemode','false')))))) as inventory
), wrong_pi_proof(field_name,value) as (
  values ('customerId','"cus_foreign"'::jsonb),('amount','999'::jsonb),('currency','"eur"'::jsonb),
    ('applicationFeeAmount','101'::jsonb),('transferDestinationId','"acct_foreign"'::jsonb),
    ('livemode','true'::jsonb),('providerScope','{"platformAccountId":"acct_foreign","livemode":false}'::jsonb)
)
select ok(bool_and(not private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_installment_order_id')::uuid,
  jsonb_set(base.inventory,array['paymentIntents','0',wrong_pi_proof.field_name],wrong_pi_proof.value,true))),
  'Checkout cancellation inventory rejects wrong PI Customer, amount, currency, seller split, mode, and platform account')
from base cross join wrong_pi_proof;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_billing_operation_unknown(current_setting('test.g4_installment_order_id')::uuid,
  'invoice_finalize',1::smallint,2::smallint,0::smallint),'Invoice finalization is durably unknown before binding its PaymentIntent');
select ok(public.bind_program_billing_payment_intent(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_billing_revision')::bigint,2::smallint,'pi_g4_installment_second',
  jsonb_build_object('id','pi_g4_installment_second','customer_id','cus_g4_installment','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'amount',1000,'amount_received',0,
    'status','requires_payment_method','currency','usd','application_fee_amount',100,'transfer_destination_id','acct_g4coach1',
    'payment_method_id','pm_g4_installment_saved',
    'invoice',jsonb_build_object('id','in_g4_installment','customer_id','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'auto_advance',false,
      'billing_reason','manual','currency','usd','default_payment_method_id','pm_g4_installment_saved','status','open',
      'starting_balance',0,'ending_balance',0,'amount_shipping',0,'total',1000,'subtotal',1000,
      'automatic_tax_enabled',false,'discounts','[]'::jsonb,'total_discount_amounts','[]'::jsonb,
      'default_tax_rates','[]'::jsonb,'total_taxes','[]'::jsonb,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'invoice_payments',jsonb_build_array(jsonb_build_object('invoice_id','in_g4_installment',
      'payment_intent_id','pi_g4_installment_second','is_default',true,'type','payment_intent','status','open',
      'currency','usd','amount_requested',1000,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false)))),repeat('d',64)),
  'exact finalized Invoice PaymentIntent binds after complete one-invoice one-PI proof');
select is((public.prepare_program_invoice_pay_attempt(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_billing_revision')::bigint,2::smallint,'in_g4_installment',
  'pi_g4_installment_second','requires_payment_method',repeat('e',64))->>'status'),'prepared',
  'explicit saved-card collection persists one exact Invoice/PI pay intent');
select is((public.record_program_billing_provider_observation(current_setting('test.g4_installment_order_id')::uuid,
  1::smallint,2::smallint,'payment_intent','pi_g4_foreign','requires_payment_method',repeat('f',64))->>'status'),
  'provider_identity_mismatch_manual_review','foreign PI observation cannot mutate a current unknown pay attempt');
reset role;
select is((select current_pay_outcome from public.program_billing_installment_invoices
  where order_id=current_setting('test.g4_installment_order_id')::uuid and installment_number=2),'unknown',
  'foreign PI leaves current retry outcome unknown');
select is((select current_pay_attempt from public.program_billing_installment_invoices
  where order_id=current_setting('test.g4_installment_order_id')::uuid and installment_number=2),1::smallint,
  'foreign PI cannot advance or reopen a retry');
select is((select operation_state from public.program_billing_operations where order_id=current_setting('test.g4_installment_order_id')::uuid
  and operation_kind='invoice_pay' and installment_number=2 and payment_attempt_number=1),'unknown',
  'foreign PI cannot clear the persisted pay operation');
select set_config('test.g4_installment_two_revision',(select revision::text from public.program_order_installments
  where order_id=current_setting('test.g4_installment_order_id')::uuid and installment_number=2),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_settled_payment(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_two_revision')::bigint,'evt_g4_installment_second',1::smallint,2::smallint,
  null,'in_g4_installment','pi_g4_installment_second','ch_g4_installment_second',1000,0,'usd',now(),
  'pm_g4_installment_saved',jsonb_build_object(
    'payment_intent',jsonb_build_object('id','pi_g4_installment_second','customer_id','cus_g4_installment','status','succeeded',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'amount',1000,'amount_received',1000,'currency','usd','application_fee_amount',100,'transfer_destination_id','acct_g4coach1',
      'payment_method_id','pm_g4_installment_saved','latest_charge_id','ch_g4_installment_second'),
    'invoice',jsonb_build_object('id','in_g4_installment','customer_id','cus_g4_installment','status','paid','auto_advance',false,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'currency','usd','total',1000,'amount_paid',1000,'amount_remaining',0,'amount_overpaid',0,'amount_shipping',0,
      'starting_balance',0,'ending_balance',0,'subtotal',1000,'automatic_tax_enabled',false,'discounts','[]'::jsonb,
      'total_discount_amounts','[]'::jsonb,'default_tax_rates','[]'::jsonb,'total_taxes','[]'::jsonb,'billing_reason','manual',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'invoice_lines',jsonb_build_array(jsonb_build_object('invoice_item_id','ii_g4_installment','invoice_id','in_g4_installment',
      'amount',1000,'currency','usd','discountable',false,'quantity',1,'proration',false,'subscription_id',null,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discounts','[]'::jsonb,'tax_rates','[]'::jsonb,'tax_amounts','[]'::jsonb,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'invoice_payments',jsonb_build_array(jsonb_build_object('invoice_id','in_g4_installment',
      'payment_intent_id','pi_g4_installment_second','is_default',true,'type','payment_intent','status','paid',
      'currency','usd','amount_requested',1000,'amount_paid',1000,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))),
    'payment_method',jsonb_build_object('id','pm_g4_installment_saved','customer_id','cus_g4_installment','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))),repeat('0',64))->>'status'),
  'settled','exact finalized invoice and associated InvoicePayment settle the next canonical stage');
reset role;
select is((select billing_state from public.program_billing_orders where order_id=current_setting('test.g4_installment_order_id')::uuid),
  'paid','finite fixed total completes at the final installment');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((public.get_my_program_order_lesson_access(current_setting('test.g4_installment_order_id')::uuid)->>'fully_funded'),
  'true','settled finite installments expose access through the canonical ledger');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_installment_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000007')->>'status'),'cancellation_requested',
  'buyer cancellation records a durable stop after the last installment');
reset role;
select set_config('test.g4_installment_cancel_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_installment_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_installment_inventory',jsonb_build_object(
  'completeInventory',true,'orderId',current_setting('test.g4_installment_order_id'),
  'customerId','cus_g4_installment','customer',jsonb_build_object('id','cus_g4_installment','deleted',false,'balance',0,
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),
  'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
  'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_installment','customerId','cus_g4_installment','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'paymentIntentId','pi_g4_installment_first','status','complete','paymentStatus','paid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'paymentIntents',jsonb_build_array(
    jsonb_build_object('id','pi_g4_installment_first','customerId','cus_g4_installment','amount',1000,'amountReceived',1000,
      'currency','usd','applicationFeeAmount',100,'transferDestinationId','acct_g4coach1','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_installment_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    jsonb_build_object('id','pi_g4_installment_second','customerId','cus_g4_installment','amount',1000,'amountReceived',1000,
      'currency','usd','applicationFeeAmount',100,'transferDestinationId','acct_g4coach1','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded')),
  'deletedInvoices','[]'::jsonb,
  'invoices',jsonb_build_array(
    jsonb_build_object('id','in_g4_installment','customerId','cus_g4_installment','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'currency','usd','autoAdvance',false,'billingReason','manual','status','paid','amountPaid',1000,'amountRemaining',0,
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_installment_order_id'),
        'program_installment_number','2','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'lines',jsonb_build_array(
        jsonb_build_object('invoiceItemId','ii_g4_installment','amount',1000,'livemode',false,
          'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
          'metadata',jsonb_build_object('program_platform_account_id','acct_g4platform','program_livemode','false')))
    )
  ),
  'paymentIntentIds',jsonb_build_array('pi_g4_installment_first','pi_g4_installment_second'),
  'invoiceIds',jsonb_build_array('in_g4_installment')
)::text,true);
select is(jsonb_array_length(current_setting('test.g4_installment_inventory')::jsonb->'invoices'),1,
  'cancellation inventory keeps exactly one invoice in its invoice array');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('test.g4_installment_inventory')::jsonb->'invoices') invoice(value)
  where jsonb_typeof(invoice.value) is distinct from 'object'),
  'every cancellation invoice array element is an invoice object');
select is(current_setting('test.g4_installment_inventory')::jsonb->'paymentIntentIds',
  '["pi_g4_installment_first","pi_g4_installment_second"]'::jsonb,'payment intent ID list remains at the inventory root');
select is(current_setting('test.g4_installment_inventory')::jsonb->'invoiceIds',
  '["in_g4_installment"]'::jsonb,'invoice ID list remains at the inventory root');
select is((public.complete_program_billing_cancellation(current_setting('test.g4_installment_order_id')::uuid,
  current_setting('test.g4_installment_cancel_revision')::bigint,
  current_setting('test.g4_installment_inventory')::jsonb,repeat('1',64))->>'status'),'canceled',
  'complete exact paid/paid cancellation inventory stops future collection without refund');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((public.get_my_program_order_lesson_access(current_setting('test.g4_installment_order_id')::uuid)->>'fully_funded'),
  'true','buyer cancellation preserves stages already funded by the canonical ledger');
reset role;

select is((select effective_total_cents from public.program_orders where id = current_setting('test.g4_order_id')::uuid), 1800, 'promotion fixes the immutable discounted total');
select is((select installment_amounts_cents from public.program_orders where id = current_setting('test.g4_order_id')::uuid), array[900,900]::integer[], 'discounted installment amounts sum to the exact fixed total');
select is((select count(*)::integer from public.program_promotion_reservations where order_id = current_setting('test.g4_order_id')::uuid and state = 'reserved'), 1, 'one bounded promotion reservation is held before checkout');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_billing_terms(current_setting('test.g4_order_id')::uuid, 0::bigint, repeat('a',64), array[(now() at time zone 'America/New_York')::date + 14], true, 7::smallint)->>'status'), 'saved', 'fixed-total installment terms and seven-day saved-card consent persist before collection');
select is((public.prepare_program_billing_customer(current_setting('test.g4_order_id')::uuid, 1::bigint,'acct_g4platform',false)->>'status'), 'prepared', 'isolated Customer creation snapshots merchant scope before durable intent');
select is((public.prepare_program_billing_customer(current_setting('test.g4_order_id')::uuid,2::bigint,'acct_wrongplatform',false)->>'status'),
  'provider_scope_mismatch','platform account mismatch cannot replace the immutable pre-create scope');
reset role;
with base as (
  select jsonb_build_object('completeInventory',true,'customerId',null,'customer',null,
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
)
select ok(private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,base.inventory),
  'complete pre-Customer cancellation inventory is accepted only with explicit empty arrays and null Customer fields')
from base;
with base as (
  select jsonb_build_object('completeInventory',true,'customerId',null,'customer',null,
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
), required(field_name) as (
  values ('completeInventory'),('customerId'),('customer'),('pendingInvoiceItemCount'),
    ('sessions'),('paymentIntents'),('invoices'),('deletedInvoices'),('subscriptions'),('schedules')
)
select ok(bool_and((private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,
    base.inventory - required.field_name)) is false),
  'pre-Customer cancellation inventory rejects every missing required proof field')
from base cross join required;
with base as (
  select jsonb_build_object('completeInventory',true,'customerId',null,'customer',null,
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
), nonnullable(field_name) as (
  values ('completeInventory'),('pendingInvoiceItemCount'),('sessions'),('paymentIntents'),
    ('invoices'),('deletedInvoices'),('subscriptions'),('schedules')
)
select ok(bool_and((private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,
    jsonb_set(base.inventory,array[nonnullable.field_name],'null'::jsonb,true))) is false),
  'pre-Customer cancellation inventory rejects JSON null in each nonnullable proof field')
from base cross join nonnullable;
with normalized as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_program_order',
    'customer',jsonb_build_object('id','cus_g4_program_order','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,
    'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
)
select ok(not private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,
  jsonb_set(jsonb_set(jsonb_set(
    normalized.inventory #- array['customer','discountId'] #- array['customer','taxExempt'] #- array['customer','invoiceCreditBalance'],
    '{customer,discount_id}','null'::jsonb,true),
    '{customer,tax_exempt}','"none"'::jsonb,true),
    '{customer,invoice_credit_balance}','{"usd":0}'::jsonb,true)),
  'cleanup inventory accepts the normalized Customer DTO keys and rejects raw Stripe Customer keys')
from normalized;
select set_config('test.g4_customer_key', (select idempotency_key from public.program_billing_operations where order_id = current_setting('test.g4_order_id')::uuid and operation_kind = 'customer_create'), true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_billing_customer(current_setting('test.g4_order_id')::uuid,2::bigint,'acct_g4platform',false)->>'idempotency_key'), current_setting('test.g4_customer_key'), 'unknown Customer creation reuses its persisted idempotency key and immutable scope');
select ok(not public.bind_program_billing_customer(current_setting('test.g4_order_id')::uuid,2::bigint,'cus_g4_wrong_scope',
  jsonb_build_object('id','cus_g4_wrong_scope','deleted',false,'balance',0,'discountId',null,'taxExempt','none','livemode',true,
    'providerScope',jsonb_build_object('platformAccountId','acct_wrongplatform','livemode',true),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_billing_purpose','program_order',
      'program_platform_account_id','acct_wrongplatform','program_livemode','true'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('b',64)),
  'foreign platform account and mode cannot bind the persisted Customer intent');
select ok(public.bind_program_billing_customer(current_setting('test.g4_order_id')::uuid, 2::bigint, 'cus_g4_program_order',
  jsonb_build_object('id','cus_g4_program_order','deleted',false,'balance',0,'discountId',null,'taxExempt','none',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_billing_purpose','program_order',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)), repeat('b',64)), 'isolated zero-balance Customer binds with exact order metadata');
reset role;
with bound_inventory as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_program_order',
    'customer',jsonb_build_object('id','cus_g4_program_order','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object(
        'program_order_id',current_setting('test.g4_order_id'),'program_billing_purpose','program_order',
        'program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
)
select ok(private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,inventory),
  'bound Customer cancellation inventory accepts a truthful exact numeric zero credit balance')
from bound_inventory;
with bound_inventory as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_program_order',
    'customer',jsonb_build_object('id','cus_g4_program_order','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object(
        'program_order_id',current_setting('test.g4_order_id'),'program_billing_purpose','program_order',
        'program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
), malformed_credit(field_name,value) as (
  values ('json null','{"usd":null}'::jsonb),('string zero','{"usd":"0"}'::jsonb),
    ('boolean false','{"usd":false}'::jsonb),('nonzero number','{"usd":1}'::jsonb)
)
select ok(bool_and((private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,
    jsonb_set(bound_inventory.inventory,'{customer,invoiceCreditBalance}',malformed_credit.value,true))) is false),
  'bound Customer cancellation inventory rejects null, nonnumeric, and nonzero credits without SQL-null pass-through')
from bound_inventory cross join malformed_credit;
with bound_inventory as (
  select jsonb_build_object('completeInventory',true,'customerId','cus_g4_program_order',
    'customer',jsonb_build_object('id','cus_g4_program_order','deleted',false,'balance',0,'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object(
        'program_order_id',current_setting('test.g4_order_id'),'program_billing_purpose','program_order',
        'program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb) as inventory
)
select ok((private.program_billing_cancel_inventory_is_complete(current_setting('test.g4_order_id')::uuid,
    bound_inventory.inventory #- array['customer','invoiceCreditBalance'])) is false,
  'bound Customer cancellation inventory rejects a missing credit-balance object')
from bound_inventory;

set local role service_role;
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/success?order=g4','https://gymx2.test/programs/cancel?order=g4')->>'status'), 'prepared', 'Checkout attempt and exact URLs persist before provider creation');
reset role;
select set_config('test.g4_checkout_attempt_id', (select attempt_id::text from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid and attempt_number = 1), true);
select is((select cancel_url from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid and attempt_number = 1), 'https://gymx2.test/programs/cancel?order=g4', 'attempt retains the immutable captured cancel URL');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_order_id')::uuid,4::bigint,
  'https://gymx2.test/changed-success','https://gymx2.test/changed-cancel')->>'success_url'), 'https://gymx2.test/programs/success?order=g4', 'attempt replay returns the immutable captured success URL');
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_order_id')::uuid,1::smallint), 'lost Checkout response remains durably unknown');
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_order_id')::uuid,4::bigint,1::smallint,'cs_g4_expired','pi_g4_expired',
  jsonb_build_object('id','cs_g4_expired','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_program_order','client_reference_id',current_setting('test.g4_checkout_attempt_id'),
    'payment_intent_id','pi_g4_expired','mode','payment','currency','usd','amount_total',900,'status','expired','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_checkout_attempt_id',current_setting('test.g4_checkout_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_g4_program_order','amount',900,'currency','usd','application_fee_amount',90,'transfer_destination_id','acct_g4coach1',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_checkout_attempt_id',current_setting('test.g4_checkout_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))), repeat('c',64)), 'exact first Session is durably bound for terminal reconciliation');

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((public.request_program_checkout_retry(current_setting('test.g4_order_id')::uuid,'f9000000-0000-0000-0000-000000000002')->>'status'),
  'buyer_or_program_ineligible', 'signed-in administrators cannot purchase through the member checkout path');
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((public.request_program_checkout_retry(current_setting('test.g4_order_id')::uuid,'f9000000-0000-0000-0000-000000000001')->>'status'), 'buyer_or_program_ineligible', 'different linked buyer cannot request retry on this order');
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((public.request_program_checkout_retry(current_setting('test.g4_order_id')::uuid,'f9000000-0000-0000-0000-000000000001')->>'status'), 'requested', 'signed-in order owner explicitly requests retry');
select is((public.request_program_checkout_retry(current_setting('test.g4_order_id')::uuid,'f9000000-0000-0000-0000-000000000001')->>'status'), 'already_requested', 'exact buyer retry request is idempotent');
select throws_ok($$select public.prepare_program_checkout_attempt(current_setting('test.g4_order_id')::uuid,3::bigint,'https://gymx2.test/a','https://gymx2.test/b')$$,
  '42501', null, 'authenticated clients cannot create provider checkout attempts');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.advance_program_checkout_attempt(current_setting('test.g4_order_id')::uuid,5::bigint,'f9000000-0000-0000-0000-000000000001',
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_order_id'),'customerId','cus_g4_program_order','priorAttemptNumber',1,'pendingInvoiceItemCount',0,
    'sessionIds',jsonb_build_array('cs_g4_expired'),'paymentIntentIds',jsonb_build_array('pi_g4_expired'),'invoiceIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
    'attempts',jsonb_build_array(jsonb_build_object('attemptNumber',1,'attemptId',current_setting('test.g4_checkout_attempt_id'),'sessionId','cs_g4_expired','paymentIntentId','pi_g4_expired',
      'sessionStatus','expired','sessionPaymentStatus','unpaid','paymentIntentStatus','canceled','amountCents',900,'amountReceivedCents',0,'currency','usd','customerId','cus_g4_program_order'))), repeat('d',64))->>'attempt_number'),
  '2', 'retry advances only on complete exact proof of an expired unpaid Session and canceled zero-paid PI');
reset role;
select set_config('test.g4_retry_attempt_id', (select attempt_id::text from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid and attempt_number = 2), true);
select is((select current_checkout_attempt from public.program_billing_orders where order_id = current_setting('test.g4_order_id')::uuid), 2::smallint, 'same-order current pointer advances without loosening the unique fence');
select is((select count(*)::integer from public.program_orders where buyer_id = 'f1000000-0000-0000-0000-000000000003' and program_id = 'f3000000-0000-0000-0000-000000000001'), 1, 'retry preserves one canonical order and immutable quote');
select is((select count(*)::integer from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid), 2, 'retry appends rather than overwrites an attempt');
select is((select count(*)::integer from public.program_payment_intent_claims where order_id = current_setting('test.g4_order_id')::uuid), 0, 'unsettled attempts do not consume a canonical PI claim');
select is((select count(*)::integer from public.program_promotion_reservations where order_id = current_setting('test.g4_order_id')::uuid and state = 'reserved'), 1, 'verified retry holds the same promotion quota');
select is((select success_url from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid and attempt_number = 2), 'https://gymx2.test/programs/success?order=g4', 'new attempt preserves exact success URL');
select is((select cancel_url from public.program_billing_checkout_attempts where order_id = current_setting('test.g4_order_id')::uuid and attempt_number = 2), 'https://gymx2.test/programs/cancel?order=g4', 'new attempt preserves exact cancel URL');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_order_id')::uuid,
  6::bigint,2::smallint,'cs_g4_current','pi_g4_current',
  jsonb_build_object('id','cs_g4_current','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_program_order','client_reference_id',current_setting('test.g4_retry_attempt_id'),
    'payment_intent_id','pi_g4_current','mode','payment','currency','usd','amount_total',900,'status','complete','payment_status','paid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_checkout_attempt_id',current_setting('test.g4_retry_attempt_id'),
      'program_checkout_attempt_number','2','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_g4_program_order','amount',900,'currency','usd','application_fee_amount',90,'transfer_destination_id','acct_g4coach1',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_checkout_attempt_id',current_setting('test.g4_retry_attempt_id'),
        'program_checkout_attempt_number','2','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))), repeat('e',64)), 'current retry Session binds to the immutable order and coach split');
select is((public.record_program_billing_settled_payment(current_setting('test.g4_order_id')::uuid,0::bigint,'evt_g4_current_paid',2::smallint,1::smallint,
  'cs_g4_current',null,'pi_g4_current','ch_g4_current',900,0,'usd',now(),'pm_g4_saved',
  jsonb_build_object('checkout_session',jsonb_build_object('id','cs_g4_current','customer_id','cus_g4_program_order','client_reference_id',current_setting('test.g4_retry_attempt_id'),
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'mode','payment','status','complete','payment_status','paid','amount_total',900,'currency','usd',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_checkout_attempt_id',current_setting('test.g4_retry_attempt_id'),
        'program_checkout_attempt_number','2','program_installment_number','1','program_billing_kind','program_sale','program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_g4_current','customer_id','cus_g4_program_order','status','succeeded','amount',900,'amount_received',900,'currency','usd',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'application_fee_amount',90,'transfer_destination_id','acct_g4coach1','payment_method_id','pm_g4_saved','latest_charge_id','ch_g4_current',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_order_id'),'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_retry_attempt_id'),
        'program_checkout_attempt_number','2','program_installment_number','1','program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_g4_saved','customer_id','cus_g4_program_order','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))), repeat('f',64))->>'status'),
  'settled', 'verified current settled PI is the only attempt claimed by Gate 1');
reset role;
select is((select count(*)::integer from public.program_payment_intent_claims where order_id = current_setting('test.g4_order_id')::uuid and installment_number = 1), 1, 'successful installment has exactly one canonical claim');
select is((select payment_intent_id from public.program_payment_intent_claims where order_id = current_setting('test.g4_order_id')::uuid and installment_number = 1), 'pi_g4_current', 'current PI becomes the immutable claim');
select is((select state from public.program_promotion_reservations where order_id = current_setting('test.g4_order_id')::uuid), 'redeemed', 'canonical settlement redeems the same promotion reservation');
select is((select count(*)::integer from public.program_promotion_redemptions where order_id = current_setting('test.g4_order_id')::uuid), 1, 'retry yields one promotion redemption');

-- A normal explicit retry accepts a verified expired Session that Stripe created
-- without a PaymentIntent. It records no synthetic PI and preserves the Gate 1 fence.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_null_pi_retry_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000009','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-program-null-pi-retry-001',null
)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_null_pi_retry_order_id')::uuid,0::bigint,
  repeat('2',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'null-PI retry order persists one-time immutable terms');
select is((public.prepare_program_billing_customer(current_setting('test.g4_null_pi_retry_order_id')::uuid,1::bigint,
  'acct_g4platform',false)->>'status'),'prepared','null-PI retry Customer intent persists with merchant scope');
select ok(public.bind_program_billing_customer(current_setting('test.g4_null_pi_retry_order_id')::uuid,2::bigint,
  'cus_g4_null_pi_retry',jsonb_build_object('id','cus_g4_null_pi_retry','deleted',false,'balance',0,
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_null_pi_retry_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('7',64)),
  'null-PI retry order binds its isolated Customer');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_null_pi_retry_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/null-pi-success','https://gymx2.test/programs/null-pi-cancel')->>'status'),
  'prepared','null-PI retry order stores exact Checkout request');
reset role;
select set_config('test.g4_null_pi_retry_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_null_pi_retry_order_id')::uuid,1::smallint),
  'null-PI retry Checkout attempt is durably unknown before provider binding');
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_null_pi_retry_order_id')::uuid,4::bigint,
  1::smallint,'cs_g4_expired_no_pi',null,
  jsonb_build_object('id','cs_g4_expired_no_pi','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_null_pi_retry','client_reference_id',current_setting('test.g4_null_pi_retry_attempt_id'),
     'payment_intent_id',null,'payment_intent','null'::jsonb,'mode','payment','currency','usd','amount_total',2000,
      'status','expired','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_null_pi_retry_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_null_pi_retry_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false')),repeat('8',64)),
  'expired unpaid Checkout Session with explicit JSON-null PI binds without inventing a PI');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000009","role":"authenticated"}';
select is((public.request_program_checkout_retry(current_setting('test.g4_null_pi_retry_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000009')->>'status'),'requested',
  'eligible buyer explicitly requests retry of the expired null-PI Session');
reset role;
select set_config('test.g4_null_pi_retry_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.advance_program_checkout_attempt(current_setting('test.g4_null_pi_retry_order_id')::uuid,
  current_setting('test.g4_null_pi_retry_billing_revision')::bigint,
  'f9000000-0000-0000-0000-000000000009',
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_null_pi_retry_order_id'),
    'customerId','cus_g4_null_pi_retry','priorAttemptNumber',1,'pendingInvoiceItemCount',0,
    'sessionIds',jsonb_build_array('cs_g4_expired_no_pi'),'paymentIntentIds','[]'::jsonb,
    'invoiceIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
    'attempts',jsonb_build_array(jsonb_build_object('attemptNumber',1,
      'attemptId',current_setting('test.g4_null_pi_retry_attempt_id'),'sessionId','cs_g4_expired_no_pi',
      'paymentIntentId',null,'paymentIntentStatus',null,'sessionStatus','expired','sessionPaymentStatus','unpaid',
      'amountCents',2000,'amountReceivedCents',0,'currency','usd','customerId','cus_g4_null_pi_retry'))),repeat('9',64))->>'attempt_number'),
  '2','explicit retry appends a new attempt using exact terminal Session proof and an empty PI inventory');
reset role;
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),0,
  'an expired unpaid null-PI attempt never consumes a canonical ledger claim');
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),'cs_g4_expired_no_pi',
  'normal retry preserves the original Gate 1 Session binding');
reset role;

set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000009","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_null_pi_retry_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000019')->>'status'),'cancellation_requested',
  'buyer can cancel after a normal retry proved an expired null-PI Session');
reset role;
select set_config('test.g4_null_pi_retry_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_null_pi_retry_order_id')::uuid,
  current_setting('test.g4_null_pi_retry_billing_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_null_pi_retry_order_id'),
    'customerId','cus_g4_null_pi_retry','customer',jsonb_build_object('id','cus_g4_null_pi_retry','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_null_pi_retry_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_expired_no_pi','customerId','cus_g4_null_pi_retry','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'paymentIntentId',null,
      'status','expired','paymentStatus','unpaid','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_null_pi_retry_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_null_pi_retry_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('3',64))->>'status'),'canceled',
  'buyer cancellation accepts complete same-scope empty PI inventory without fabricating a canceled PaymentIntent');
reset role;
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),'cs_g4_expired_no_pi',
  'buyer cancellation retains the exact Gate 1 Session reference');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_null_pi_retry_order_id')::uuid),0,
  'buyer cancellation after a null-PI retry never creates a payment claim');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_settled_payment(current_setting('test.g4_order_id')::uuid,1::bigint,'evt_g4_late_old_paid',1::smallint,1::smallint,
  'cs_g4_expired',null,'pi_g4_expired','ch_g4_late_old',900,0,'usd',now(),'pm_g4_old',
  jsonb_build_object('payment_intent',jsonb_build_object('id','pi_g4_expired','customer_id','cus_g4_program_order','status','succeeded','amount',900,'amount_received',900,
    'currency','usd','application_fee_amount',90,'transfer_destination_id','acct_g4coach1','payment_method_id','pm_g4_old','latest_charge_id','ch_g4_late_old')), repeat('1',64))->>'status'),
  'payment_conflict_manual_review', 'late old-attempt success is audited without a second canonical claim');
reset role;
select is((select count(*)::integer from public.program_payment_intent_claims where order_id = current_setting('test.g4_order_id')::uuid and installment_number = 1), 1, 'late success cannot create or replace the canonical claim');
select ok(not exists (select 1 from public.program_payment_intent_claims where payment_intent_id = 'pi_g4_expired'), 'old terminal PI remains outside the Gate 1 claim table');
select is((select reason_code from public.program_billing_financial_conflicts where provider_event_id = 'evt_g4_late_old_paid'), 'late_payment_after_terminal_retry', 'actual late provider event is durable for manual review');
select is((select financial_conflict from public.program_billing_orders where order_id = current_setting('test.g4_order_id')::uuid), true, 'contradictory late collection blocks future billing');
select is((select count(*)::integer from public.program_orders where buyer_id = 'f1000000-0000-0000-0000-000000000003' and program_id = 'f3000000-0000-0000-0000-000000000001'), 1, 'late events do not weaken the one-order fence');

-- A permanent membership-deletion lock records late events but cannot restore access.
insert into public.platform_membership_deletion_locks (member_id) values ('f1000000-0000-0000-0000-000000000003') on conflict (member_id) do nothing;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_settled_payment(current_setting('test.g4_order_id')::uuid,1::bigint,'evt_g4_after_delete',2::smallint,1::smallint,
  'cs_g4_current',null,'pi_g4_current','ch_g4_current',900,0,'usd',now(),'pm_g4_saved',jsonb_build_object('payment_intent',jsonb_build_object('id','pi_g4_current')),repeat('2',64))->>'status'),
  'manual_review_after_account_fence', 'permanent deletion fence records but does not canonically settle a late webhook');
reset role;
select is((select count(*)::integer from public.program_payment_events where provider_event_id = 'evt_g4_after_delete'), 0, 'post-deletion event does not enter the canonical access ledger');
select is((select observed_after_account_fence from public.program_billing_provider_observations where provider_event_id = 'evt_g4_after_delete'), true, 'post-deletion event evidence is durably marked as fenced');
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is(public.get_my_program_order_lesson_access(current_setting('test.g4_order_id')::uuid), null::jsonb, 'deleted buyer cannot read paid lesson access');
reset role;
delete from public.platform_membership_deletion_locks where member_id = 'f1000000-0000-0000-0000-000000000003';

-- One-time pricing uses no installment dates or saved-card billing fields.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_one_time_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000006', 'f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001', 1::smallint, 'g4-program-order-onetime-001', null
)::text, true);
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_one_time_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'one-time order ingress begins with an active lesson-specific checkout obligation');
set local role service_role;
select is((public.prepare_program_billing_terms(current_setting('test.g4_one_time_order_id')::uuid,0::bigint,
  repeat('3',64),array[]::date[],false,null::smallint)->>'status'), 'saved', 'one-time terms save with an empty date list and no off-session consent');
select is((public.prepare_program_billing_customer(current_setting('test.g4_one_time_order_id')::uuid,1::bigint,'acct_g4platform',false)->>'status'),
  'prepared', 'one-time sale receives the same isolated Customer intent');
select ok(public.bind_program_billing_customer(current_setting('test.g4_one_time_order_id')::uuid,2::bigint,'cus_g4_onetime',
  jsonb_build_object('id','cus_g4_onetime','deleted',false,'balance',0,'discountId',null,'taxExempt','none',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),'program_billing_purpose','program_order',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('4',64)), 'one-time Customer binds with the same exact zero-balance proof');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_one_time_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/success?order=g4-onetime','https://gymx2.test/programs/cancel?order=g4-onetime')->>'status'),
  'prepared', 'one-time fixed price uses one-time Checkout preparation');
reset role;
select set_config('test.g4_one_time_attempt_id', (select attempt_id::text from public.program_billing_checkout_attempts
  where order_id = current_setting('test.g4_one_time_order_id')::uuid and attempt_number = 1), true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_one_time_order_id')::uuid,1::smallint),
  'one-time Checkout create intent is durable before provider reconciliation');
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_one_time_order_id')::uuid,4::bigint,1::smallint,
  'cs_g4_onetime','pi_g4_onetime',
  jsonb_build_object('id','cs_g4_onetime','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_onetime','client_reference_id',current_setting('test.g4_one_time_attempt_id'),
    'payment_intent_id','pi_g4_onetime','mode','payment','currency','usd','amount_total',2000,'status','complete','payment_status','paid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),'program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_g4_onetime','amount',2000,'currency','usd','application_fee_amount',200,'transfer_destination_id','acct_g4coach1',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),'program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),repeat('5',64)),
  'one-time Session and exact fixed-price PI bind without installment consent');
select is((public.record_program_billing_settled_payment(current_setting('test.g4_one_time_order_id')::uuid,0::bigint,'evt_g4_onetime_paid',1::smallint,1::smallint,
  'cs_g4_onetime',null,'pi_g4_onetime','ch_g4_onetime',2000,0,'usd',now(),'pm_g4_onetime',
  jsonb_build_object('checkout_session',jsonb_build_object('id','cs_g4_onetime','customer_id','cus_g4_onetime','client_reference_id',current_setting('test.g4_one_time_attempt_id'),
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'mode','payment','status','complete','payment_status','paid','amount_total',2000,'currency','usd',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),'program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale','program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_g4_onetime','customer_id','cus_g4_onetime','status','succeeded','amount',2000,'amount_received',2000,'currency','usd',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'application_fee_amount',200,'transfer_destination_id','acct_g4coach1','payment_method_id','pm_g4_onetime','latest_charge_id','ch_g4_onetime',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),'program_billing_kind','program_sale',
        'program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_g4_onetime','customer_id','cus_g4_onetime','type','card','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))),repeat('6',64))->>'status'),
  'settled', 'service settlement succeeds for a full one-time price');
reset role;
select is((select billing_state from public.program_billing_orders where order_id = current_setting('test.g4_one_time_order_id')::uuid),
  'paid', 'one-time settlement closes billing without monthly collection');
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_one_time_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='paid_order' and obligation.obligation_state='active'),
  'settled one-time lesson creates an active paid_order retention obligation');
select ok((select first_settled_at is not null and anchor_day is null and anchor_is_end_of_month is null
    and next_installment_number is null and next_anchor_date is null and saved_payment_method_id is null
    from public.program_billing_orders where order_id = current_setting('test.g4_one_time_order_id')::uuid),
  'one-time settlement has no installment anchor or saved-card requirement');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id = current_setting('test.g4_one_time_order_id')::uuid and installment_number = 1),1,
  'one-time purchase creates its single canonical Gate 1 PI claim');
select set_config('test.g4_one_time_edge_count_before_deletion',(
  select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000006' and edge.relation_kind='assigned_member'),true);
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((public.get_my_program_order_lesson_access(current_setting('test.g4_one_time_order_id')::uuid)->>'fully_funded'),
  'true', 'one-time full settlement reaches canonical paid-program access');
reset role;

-- A fully paid one-time order can later be buyer-canceled, then monotonically
-- promoted to account deletion without changing its original cancellation ID or PI claim.
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000061')->>'status'),'cancellation_requested',
  'a signed-in buyer may close a fully settled one-time order');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.begin_stream_account_media_cleanup('f9100000-0000-0000-0000-000000000061',
  'f1000000-0000-0000-0000-000000000006','f9200000-0000-0000-0000-000000000061',
  repeat('2',64),'f9300000-0000-0000-0000-000000000061',repeat('3',64))->>'outcome'),'reserved',
  'deletion lifecycle reserves the exact buyer tombstone');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000006'),
  'account deletion fences the already-canceled one-time buyer');
select is((public.request_program_billing_account_deletion('f9100000-0000-0000-0000-000000000061')->>'status'),
  'deletion_billing_fenced','billing cancellation promotes to account deletion');
reset role;
select is((select cancellation_request_id from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),'f9000000-0000-0000-0000-000000000061',
  'deletion promotion retains the immutable original buyer cancellation request');
select is((select cancellation_reason from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),'account_deletion',
  'fully canceled paid one-time order is attached to the deletion tombstone');
select ok((select billing.cancellation_request_id='f9000000-0000-0000-0000-000000000061'
      and billing.account_tombstone_id='f9100000-0000-0000-0000-000000000061'
      and tombstone.request_id='f9200000-0000-0000-0000-000000000061'
      and tombstone.request_id is distinct from billing.cancellation_request_id
    from public.program_billing_orders billing
    join public.stream_media_account_tombstones tombstone on tombstone.id=billing.account_tombstone_id
    where billing.order_id=current_setting('test.g4_one_time_order_id')::uuid),
  'buyer cancellation UUID and deletion tombstone request UUID remain separate identities');
select set_config('test.g4_one_time_paid_retention_event_count_before',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_one_time_order_id')||':%'
    and obligation.obligation_kind='paid_order'),true);
select throws_ok($$select private.sync_program_order_retention(current_setting('test.g4_one_time_order_id')::uuid)$$,
  '55000',null,'ordinary paid retention ingress stays blocked while the account cleanup reservation is active');
select set_config('test.g4_one_time_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),true);
create function pg_temp.g4_one_time_deletion_inventory() returns jsonb language sql as $$
  select jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_one_time_order_id'),
    'customerId','cus_g4_onetime','customer',jsonb_build_object('id','cus_g4_onetime','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_onetime','customerId','cus_g4_onetime','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId','pi_g4_onetime','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(jsonb_build_object('id','pi_g4_onetime','customerId','cus_g4_onetime',
      'amount',2000,'amountReceived',2000,'currency','usd','applicationFeeAmount',200,'transferDestinationId','acct_g4coach1',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_one_time_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_one_time_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;
savepoint g4_paid_release_probe;
select ok((select private.stream_set_retention_obligation(obligation.registry_id,obligation.raw_provider_uid,'program_order',
  obligation.source_identity,obligation.source_revision,'paid_order',false,'f1000000-0000-0000-0000-000000000002',
  'qa_paid_retention_release_probe','f9700000-0000-0000-0000-000000000061',repeat('8',64)) is not null
  from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_one_time_order_id')||':%'
    and obligation.obligation_kind='paid_order'),
  'isolated savepoint marks the paid retention as released for a fail-closed regression probe');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select throws_ok($$select public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint,
  pg_temp.g4_one_time_deletion_inventory(),repeat('6',64))$$,
  '55000',null,'closing fails closed when the expected paid media obligation was released');
reset role;
rollback to savepoint g4_paid_release_probe;
release savepoint g4_paid_release_probe;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint,
  pg_temp.g4_one_time_deletion_inventory(),repeat('6',64))->>'status'),'canceled',
  'account-deletion cancellation accepts only the exact settled one-time provider objects and preserves access ledger');
reset role;
select is((select billing_state from public.program_billing_orders where order_id=current_setting('test.g4_one_time_order_id')::uuid),
  'deletion_pending','paid one-time billing history is retained as deletion-pending');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_one_time_order_id')::uuid and payment_intent_id='pi_g4_onetime'),1,
  'buyer cancellation and account deletion preserve the canonical one-time PI claim without refund');
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_one_time_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='paid_order' and obligation.obligation_state='active'),
  'paid media retention remains active after account-deletion cancellation');
select is((select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_one_time_order_id')||':%'
    and obligation.obligation_kind='paid_order'),
  current_setting('test.g4_one_time_paid_retention_event_count_before'),
  'receipt-authorized paid closing preserves the existing retention event history without reactivation');
select is((select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000006' and edge.relation_kind='assigned_member'),
  current_setting('test.g4_one_time_edge_count_before_deletion'),
  'closing preserves existing paid-member edges without adding new account edges');
select ok(exists(select 1 from public.stream_media_source_bindings binding
  where binding.id=current_setting('test.g4_lesson_source_binding_id')::uuid
    and binding.source_kind='program_lesson' and binding.raw_provider_uid='g4-synthetic-retention-uid'
    and binding.binding_state in ('active','ready_for_publication')),
  'deletion preserves the existing exact lesson media binding');
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='paid_order' and obligation.obligation_state='active'
    and exists(select 1 from public.program_payment_intent_claims claim
      where claim.order_id=current_setting('test.g4_order_id')::uuid and claim.installment_number=1)),
  'closing one buyer preserves another buyer’s canonical paid-order media obligation');
select set_config('test.g4_one_time_terminal_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),true);
select set_config('test.g4_one_time_terminal_gate_revision',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),true);
select set_config('test.g4_one_time_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint,
  pg_temp.g4_one_time_deletion_inventory(),repeat('6',64))->>'status'),'canceled',
  'exact paid no-promotion completion replays from its original request billing revision');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),current_setting('test.g4_one_time_terminal_billing_revision'),
  'paid completion replay leaves the terminal billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),current_setting('test.g4_one_time_terminal_gate_revision'),
  'paid completion replay leaves the terminal Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),current_setting('test.g4_one_time_receipt_count'),
  'paid completion replay reuses the existing immutable receipt');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint,
  pg_temp.g4_one_time_deletion_inventory(),repeat('7',64))->>'status'),'revision_mismatch',
  'paid completion replay rejects changed evidence digest');
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_terminal_billing_revision')::bigint,
  pg_temp.g4_one_time_deletion_inventory(),repeat('6',64))->>'status'),'revision_mismatch',
  'terminal billing revision cannot start a second completion or mint another receipt');
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint,
  jsonb_set(pg_temp.g4_one_time_deletion_inventory(),'{subscriptions}','["unexpected"]'::jsonb),repeat('6',64))->>'status'),
  'revision_mismatch','paid completion replay rejects altered provider inventory');
select is((public.complete_program_billing_cancellation(current_setting('test.g4_one_time_order_id')::uuid,
  current_setting('test.g4_one_time_billing_revision')::bigint-1,
  pg_temp.g4_one_time_deletion_inventory(),repeat('6',64))->>'status'),'revision_mismatch',
  'paid completion replay rejects an unrelated stale billing revision');
reset role;
select set_config('test.g4_one_time_tombstone_revision',(
  select revision::text from public.stream_media_account_tombstones where id='f9100000-0000-0000-0000-000000000061'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof('f9100000-0000-0000-0000-000000000061',
  current_setting('test.g4_one_time_tombstone_revision')::bigint,
  'f9600000-0000-0000-0000-000000000061',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(
    jsonb_set(pg_temp.g4_one_time_deletion_inventory(),'{sessions}','[]'::jsonb))))->>'proof_state'),
  'incomplete','Auth cleanup rejects a fresh provider inventory that omits the settled Checkout Session');
select is((public.finalize_stream_media_cleanup('f9300000-0000-0000-0000-000000000061',
  'f9800000-0000-0000-0000-000000000061',repeat('9',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 RPC finalizes retained media before the fresh billing Auth proof');
reset role;
select is((select receipt.terminal_state from public.stream_media_finalization_receipts receipt
  where receipt.operation_id='f9300000-0000-0000-0000-000000000061'
    and receipt.request_id='f9800000-0000-0000-0000-000000000061'),'retained',
  'the finalized account operation records its actual retained media outcome');
select set_config('test.g4_one_time_tombstone_revision',(
  select revision::text from public.stream_media_account_tombstones where id='f9100000-0000-0000-0000-000000000061'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof('f9100000-0000-0000-0000-000000000061',
  current_setting('test.g4_one_time_tombstone_revision')::bigint,
  'f9200000-0000-0000-0000-000000000061',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(pg_temp.g4_one_time_deletion_inventory())))->>'proof_state'),
  'ready','one-time paid cancellation drains to the registered billing cleanup component without deleting the canonical settlement');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),
  current_setting('test.g4_one_time_terminal_billing_revision'),
  'Auth cleanup verification leaves terminal billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),
  current_setting('test.g4_one_time_terminal_gate_revision'),
  'Auth cleanup verification leaves terminal Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_one_time_order_id')::uuid),
  current_setting('test.g4_one_time_receipt_count'),
  'Auth cleanup verification reuses the paid completion receipt');

-- A valid paid order with two immutable text lessons has no media retention rows to drain.
create function pg_temp.g4_text_paid_inventory() returns jsonb language sql as $$
  select jsonb_build_object('orderId',current_setting('test.g4_text_paid_order_id'),'completeInventory',true,
    'customerId','cus_g4_text_paid','customer',jsonb_build_object('id','cus_g4_text_paid','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object(
        'program_order_id',current_setting('test.g4_text_paid_order_id'),'program_billing_purpose','program_order',
        'program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_text_paid','customerId','cus_g4_text_paid','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId','pi_g4_text_paid','status','complete','paymentStatus','paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents',jsonb_build_array(jsonb_build_object('id','pi_g4_text_paid','customerId','cus_g4_text_paid',
      'amount',1200,'amountReceived',1200,'currency','usd','applicationFeeAmount',120,'transferDestinationId','acct_g4coach1',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','succeeded',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_text_paid_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000017','f3000000-0000-0000-0000-000000000002',
  'f7000000-0000-0000-0000-000000000002',1::smallint,'g4-text-only-paid-001',null)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_text_paid_order_id')::uuid,0::bigint,
  repeat('3',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'text-only paid fixture saves immutable one-time billing terms');
select is((public.prepare_program_billing_customer(current_setting('test.g4_text_paid_order_id')::uuid,
  1::bigint,'acct_g4platform',false)->>'status'),'prepared','text-only paid fixture persists its exact Customer intent');
select ok(public.bind_program_billing_customer(current_setting('test.g4_text_paid_order_id')::uuid,2::bigint,
  'cus_g4_text_paid',jsonb_build_object('id','cus_g4_text_paid','deleted',false,'balance',0,
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('4',64)),
  'text-only paid fixture binds the exact zero-balance Customer snapshot');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_text_paid_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/text-only-paid-success','https://gymx2.test/programs/text-only-paid-cancel')->>'status'),
  'prepared','text-only paid fixture persists its one-time Checkout attempt');
reset role;
select set_config('test.g4_text_paid_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_text_paid_order_id')::uuid,1::smallint),
  'text-only paid fixture records its Checkout create intent before reconciliation');
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_text_paid_order_id')::uuid,4::bigint,
  1::smallint,'cs_g4_text_paid','pi_g4_text_paid',jsonb_build_object(
    'id','cs_g4_text_paid','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'customer_id','cus_g4_text_paid','client_reference_id',current_setting('test.g4_text_paid_attempt_id'),
    'payment_intent_id','pi_g4_text_paid','mode','payment','currency','usd','amount_total',1200,
    'status','complete','payment_status','paid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent',jsonb_build_object('livemode',false,'customer_id','cus_g4_text_paid','amount',1200,'currency','usd',
      'application_fee_amount',120,'transfer_destination_id','acct_g4coach1',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),repeat('5',64)),
  'text-only paid fixture binds the exact fixed-price Session and PaymentIntent');
select is((public.record_program_billing_settled_payment(current_setting('test.g4_text_paid_order_id')::uuid,
  0::bigint,'evt_g4_text_paid',1::smallint,1::smallint,'cs_g4_text_paid',null,'pi_g4_text_paid',
  'ch_g4_text_paid',1200,0,'usd',now(),'pm_g4_text_paid',jsonb_build_object(
    'checkout_session',jsonb_build_object('id','cs_g4_text_paid','customer_id','cus_g4_text_paid',
      'client_reference_id',current_setting('test.g4_text_paid_attempt_id'),'livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'mode','payment','status','complete','payment_status','paid','amount_total',1200,'currency','usd',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_intent',jsonb_build_object('id','pi_g4_text_paid','customer_id','cus_g4_text_paid','status','succeeded',
      'amount',1200,'amount_received',1200,'currency','usd','livemode',false,
      'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'application_fee_amount',120,'transfer_destination_id','acct_g4coach1','payment_method_id','pm_g4_text_paid',
      'latest_charge_id','ch_g4_text_paid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_text_paid_order_id'),
        'program_billing_kind','program_sale','program_checkout_attempt_id',current_setting('test.g4_text_paid_attempt_id'),
        'program_checkout_attempt_number','1','program_installment_number','1',
        'program_platform_account_id','acct_g4platform','program_livemode','false')),
    'payment_method',jsonb_build_object('id','pm_g4_text_paid','customer_id','cus_g4_text_paid',
      'type','card','livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false))),
  repeat('6',64))->>'status'),'settled','text-only paid fixture records exact synthetic paid provider facts through Gate 4');
reset role;
select is((select billing_state from public.program_billing_orders
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),'paid','text-only order has a real paid billing state');
select is((select count(*)::integer from public.program_content_version_lessons
  where content_version_id='f6000000-0000-0000-0000-000000000002' and video_id is null and cloudflare_uid is null),
  2,'text-only paid fixture has two immutable lessons and no VOD identities');
select is((select count(*)::integer from public.stream_media_retention_obligations
  where source_kind='program_order' and source_identity like current_setting('test.g4_text_paid_order_id')||':%'),
  0,'text-only paid order creates no media retention obligations');
select set_config('test.g4_text_paid_tombstone_id','f9100000-0000-0000-0000-000000000017',true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_text_paid_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000017','f9200000-0000-0000-0000-000000000017',repeat('a',64),
  'f9300000-0000-0000-0000-000000000017',repeat('b',64))->>'outcome'),'reserved',
  'text-only paid account enters the standard empty-media cleanup lifecycle');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000017'),
  'text-only paid account receives the ordinary membership deletion fence');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_text_paid_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','text-only paid billing is fenced under its exact tombstone');
reset role;
select set_config('test.g4_text_paid_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_text_paid_order_id')::uuid,
  current_setting('test.g4_text_paid_billing_revision')::bigint,pg_temp.g4_text_paid_inventory(),repeat('a',64))->>'status'),
  'canceled','complete paid provider inventory closes the text-only account order');
reset role;
select set_config('test.g4_text_paid_terminal_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),true);
select set_config('test.g4_text_paid_terminal_gate_revision',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),true);
select set_config('test.g4_text_paid_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_text_paid_order_id')::uuid,
  current_setting('test.g4_text_paid_billing_revision')::bigint,pg_temp.g4_text_paid_inventory(),repeat('a',64))->>'status'),
  'canceled','exact paid text-only deletion proof replays from its original billing revision');
reset role;
select is((select count(*)::integer from public.stream_media_retention_obligations
  where source_kind='program_order' and source_identity like current_setting('test.g4_text_paid_order_id')||':%'),
  0,'paid text-only deletion writes no media retention rows');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9300000-0000-0000-0000-000000000017',
  'f9800000-0000-0000-0000-000000000017',repeat('c',64))->>'outcome'),'account_cleanup_complete',
  'Gate 3 finalizes the paid text-only account’s empty media manifest through its normal RPC');
reset role;
select is((select receipt.terminal_state from public.stream_media_finalization_receipts receipt
  where receipt.operation_id='f9300000-0000-0000-0000-000000000017'
    and receipt.request_id='f9800000-0000-0000-0000-000000000017'),'completed',
  'text-only account cleanup records the empty manifest as completed');
select set_config('test.g4_text_paid_tombstone_revision',(select revision::text from public.stream_media_account_tombstones
  where id=current_setting('test.g4_text_paid_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof(current_setting('test.g4_text_paid_tombstone_id')::uuid,
  current_setting('test.g4_text_paid_tombstone_revision')::bigint,'f9200000-0000-0000-0000-000000000017',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(pg_temp.g4_text_paid_inventory())))->>'proof_state'),
  'ready','fresh Auth verification accepts paid text-only deletion after exact media finalization');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),
  current_setting('test.g4_text_paid_terminal_billing_revision'),'text-only Auth proof leaves terminal billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),
  current_setting('test.g4_text_paid_terminal_gate_revision'),'text-only Auth proof leaves terminal Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_text_paid_order_id')::uuid),
  current_setting('test.g4_text_paid_receipt_count'),'text-only Auth proof reuses the exact cancellation receipt');

create function pg_temp.g4_text_unpaid_inventory() returns jsonb language sql as $$
  select jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_text_unpaid_order_id'),
    'customerId',null,'customer',null,'pendingInvoiceItemCount',0,
    'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,'sessions','[]'::jsonb,
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_text_unpaid_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000018','f3000000-0000-0000-0000-000000000002',
  'f7000000-0000-0000-0000-000000000002',1::smallint,'g4-text-only-unpaid-001','G4TEXTUNPAID')::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_text_unpaid_order_id')::uuid,0::bigint,
  repeat('d',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'text-only unpaid fixture saves its immutable discounted quote');
reset role;
select is((select effective_total_cents from public.program_orders
  where id=current_setting('test.g4_text_unpaid_order_id')::uuid),1000,
  'text-only unpaid fixture is a positive nonzero purchase before deletion');
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),'reserved',
  'text-only unpaid fixture begins with its exact fixed promotion held');
select is((select count(*)::integer from public.stream_media_retention_obligations
  where source_kind='program_order' and source_identity like current_setting('test.g4_text_unpaid_order_id')||':%'),
  0,'unpaid text-only order creates no media retention obligations');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_text_unpaid_tombstone_id','f9100000-0000-0000-0000-000000000018',true);
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_text_unpaid_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000018','f9200000-0000-0000-0000-000000000018',repeat('e',64),
  'f9300000-0000-0000-0000-000000000018',repeat('f',64))->>'outcome'),'reserved',
  'unpaid text-only account enters the standard empty-media cleanup lifecycle');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000018'),
  'unpaid text-only account receives the normal membership deletion fence');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_text_unpaid_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','unpaid text-only billing is fenced under its exact tombstone');
reset role;
select set_config('test.g4_text_unpaid_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_text_unpaid_order_id')::uuid,
  current_setting('test.g4_text_unpaid_billing_revision')::bigint,pg_temp.g4_text_unpaid_inventory(),repeat('1',64))->>'status'),
  'canceled','complete empty provider inventory closes the unpaid text-only order');
reset role;
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),'released',
  'terminal unpaid text-only deletion releases only its never-bound promotion');
select is((select count(*)::integer from public.program_promotion_redemptions
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),0,
  'unpaid text-only deletion creates no promotion redemption or access grant');
select set_config('test.g4_text_unpaid_terminal_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),true);
select set_config('test.g4_text_unpaid_terminal_gate_revision',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),true);
select set_config('test.g4_text_unpaid_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_text_unpaid_order_id')::uuid,
  current_setting('test.g4_text_unpaid_billing_revision')::bigint,pg_temp.g4_text_unpaid_inventory(),repeat('1',64))->>'status'),
  'canceled','exact unpaid text-only deletion proof replays against its original request');
reset role;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9300000-0000-0000-0000-000000000018',
  'f9800000-0000-0000-0000-000000000018',repeat('2',64))->>'outcome'),'account_cleanup_complete',
  'Gate 3 finalizes the unpaid text-only account’s empty media manifest through its normal RPC');
reset role;
select set_config('test.g4_text_unpaid_tombstone_revision',(select revision::text from public.stream_media_account_tombstones
  where id=current_setting('test.g4_text_unpaid_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof(current_setting('test.g4_text_unpaid_tombstone_id')::uuid,
  current_setting('test.g4_text_unpaid_tombstone_revision')::bigint,'f9200000-0000-0000-0000-000000000018',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(pg_temp.g4_text_unpaid_inventory())))->>'proof_state'),
  'ready','fresh Auth verification accepts unpaid text-only deletion after exact media finalization');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),
  current_setting('test.g4_text_unpaid_terminal_billing_revision'),'unpaid text-only Auth proof leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),
  current_setting('test.g4_text_unpaid_terminal_gate_revision'),'unpaid text-only Auth proof leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_text_unpaid_order_id')::uuid),
  current_setting('test.g4_text_unpaid_receipt_count'),'unpaid text-only Auth proof reuses the exact cancellation receipt');
select is((select count(*)::integer from public.stream_media_retention_obligations
  where source_kind='program_order' and source_identity like current_setting('test.g4_text_unpaid_order_id')||':%'),
  0,'unpaid text-only deletion writes no media retention rows');

-- This second buyer cancellation is fully completed before account deletion begins.
-- Its cancellation UUID and later tombstone request UUID are deliberately different.
create function pg_temp.g4_empty_cancel_inventory(target_order_id uuid) returns jsonb language sql as $$
  select jsonb_build_object('completeInventory',true,'orderId',target_order_id::text,
    'customerId',null,'customer',null,'pendingInvoiceItemCount',0,
    'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,'sessions','[]'::jsonb,
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_completed_cancel_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000016','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-completed-cancel-delete-001',null)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_completed_cancel_order_id')::uuid,0::bigint,
  repeat('d',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'already-canceled buyer fixture has its immutable one-time billing terms');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000016","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_completed_cancel_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000016')->>'status'),'cancellation_requested',
  'second fixture records its buyer cancellation before deletion');
reset role;
select set_config('test.g4_completed_cancel_predelete_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_completed_cancel_order_id')::uuid,
  current_setting('test.g4_completed_cancel_predelete_revision')::bigint,
  pg_temp.g4_empty_cancel_inventory(current_setting('test.g4_completed_cancel_order_id')::uuid),repeat('a',64))->>'status'),
  'canceled','buyer cancellation reaches a terminal state before the account deletion handoff');
reset role;
select is((select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),'canceled',
  'pre-deletion buyer cancellation already completed Gate 1');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.begin_stream_account_media_cleanup('f9100000-0000-0000-0000-000000000016',
  'f1000000-0000-0000-0000-000000000016','f9200000-0000-0000-0000-000000000016',
  repeat('b',64),'f9300000-0000-0000-0000-000000000016',repeat('c',64))->>'outcome'),'reserved',
  'already-canceled buyer receives its separate exact account tombstone');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000016'),
  'already-canceled buyer receives the permanent account fence');
select is((public.request_program_billing_account_deletion('f9100000-0000-0000-0000-000000000016')->>'status'),
  'deletion_billing_fenced','deletion handoff promotes a completed buyer cancellation without replacing its UUID');
reset role;
select set_config('test.g4_completed_cancel_tombstone_revision',(
  select revision::text from public.stream_media_account_tombstones where id='f9100000-0000-0000-0000-000000000016'),true);
select ok((select billing.cancellation_request_id='f9000000-0000-0000-0000-000000000016'
      and billing.account_tombstone_id='f9100000-0000-0000-0000-000000000016'
      and tombstone.request_id='f9200000-0000-0000-0000-000000000016'
      and tombstone.request_id is distinct from billing.cancellation_request_id
    from public.program_billing_orders billing
    join public.stream_media_account_tombstones tombstone on tombstone.id=billing.account_tombstone_id
    where billing.order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  'completed cancellation keeps the original request separate from the tombstone request');
select set_config('test.g4_completed_cancel_delete_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_completed_cancel_order_id')::uuid,
  current_setting('test.g4_completed_cancel_delete_revision')::bigint,
  pg_temp.g4_empty_cancel_inventory(current_setting('test.g4_completed_cancel_order_id')::uuid),repeat('a',64))->>'status'),
  'canceled','deletion completion records exact no-op Gate 1 evidence for an already-canceled buyer');
reset role;
select ok((select not receipt.transition_applied
      and receipt.source_revision=receipt.target_revision
      and receipt.request_billing_revision=current_setting('test.g4_completed_cancel_delete_revision')::bigint
      and receipt.terminal_billing_revision=receipt.request_billing_revision+1
      and receipt.cancellation_request_id='f9000000-0000-0000-0000-000000000016'
      and receipt.tombstone_request_id='f9200000-0000-0000-0000-000000000016'
      and receipt.tombstone_id=billing.account_tombstone_id
      and receipt.tombstone_id=tombstone.id
      and receipt.tombstone_revision=tombstone.revision
      and receipt.tombstone_state=tombstone.tombstone_state
      and tombstone.account_id=orders.buyer_id
      and exists(select 1 from public.platform_membership_deletion_locks fence
        where fence.member_id=orders.buyer_id)
    from private.program_order_closing_receipts receipt
    join public.program_billing_orders billing on billing.order_id=receipt.order_id
    join public.program_orders orders on orders.id=receipt.order_id
    join public.stream_media_account_tombstones tombstone on tombstone.id=receipt.tombstone_id
    where receipt.order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  'no-op receipt binds the exact completed Gate 1 state and both request identities');
select set_config('test.g4_completed_cancel_terminal_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
select set_config('test.g4_completed_cancel_terminal_gate_revision',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
select set_config('test.g4_completed_cancel_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_completed_cancel_order_id')::uuid,
  current_setting('test.g4_completed_cancel_delete_revision')::bigint,
  pg_temp.g4_empty_cancel_inventory(current_setting('test.g4_completed_cancel_order_id')::uuid),repeat('a',64))->>'status'),
  'canceled','exact no-op deletion completion replays after prior buyer cancellation');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_terminal_billing_revision'),
  'no-op replay leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_terminal_gate_revision'),
  'no-op replay leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_receipt_count'),
  'no-op replay reuses its immutable completion receipt');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof('f9100000-0000-0000-0000-000000000016',
  current_setting('test.g4_completed_cancel_tombstone_revision')::bigint,
  'f9600000-0000-0000-0000-000000000016',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(
    pg_temp.g4_empty_cancel_inventory(current_setting('test.g4_completed_cancel_order_id')::uuid))))->>'proof_state'),
  'ready','Auth cleanup verifies a completed buyer cancellation promoted to deletion');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_terminal_billing_revision'),
  'Auth proof after cancellation promotion leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_terminal_gate_revision'),
  'Auth proof after cancellation promotion leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_completed_cancel_receipt_count'),
  'Auth proof after cancellation promotion reuses its no-op receipt');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9300000-0000-0000-0000-000000000016',
  'f9800000-0000-0000-0000-000000000016',repeat('e',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 finalization completes the prior buyer cleanup reservation before later shared-UID ingress');
reset role;
select ok(exists(select 1 from public.stream_media_operation_states operation_state
  join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=operation_state.operation_id
  where operation_state.operation_id='f9300000-0000-0000-0000-000000000016'
    and operation_state.operation_state='retained'
    and uid_state.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and uid_state.raw_provider_uid='g4-synthetic-retention-uid'
    and uid_state.uid_state='retained_attached'),
  'finalized prior buyer cleanup remains an attached retained UID without an active cleanup reservation');
select set_config('test.g4_cc_final_tomb_rev',(select revision::text from public.stream_media_account_tombstones
  where id='f9100000-0000-0000-0000-000000000016'),true);
select set_config('test.g4_cc_final_bill_rev',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
select set_config('test.g4_cc_final_gate_rev',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
select set_config('test.g4_cc_final_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof('f9100000-0000-0000-0000-000000000016',
  current_setting('test.g4_cc_final_tomb_rev')::bigint,'f9600000-0000-0000-0000-000000000017',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(
    pg_temp.g4_empty_cancel_inventory(current_setting('test.g4_completed_cancel_order_id')::uuid))))->>'proof_state'),
  'ready','fresh billing Auth proof accepts the exact retained-media finalization lineage');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_cc_final_bill_rev'),'post-finalization Auth proof leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_cc_final_gate_rev'),'post-finalization Auth proof leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_completed_cancel_order_id')::uuid),
  current_setting('test.g4_cc_final_receipt_count'),'post-finalization Auth proof reuses the same no-op receipt');

-- A committed buyer cancellation can win while Customer creation is unknown. The
-- drain RPC binds only the exact provider-created Customer and keeps billing closed.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_drain_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000004','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-program-order-drain-customer-001',null
)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_drain_order_id')::uuid,0::bigint,
  repeat('7',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'drain fixture persists immutable one-time terms before provider setup');
select is((public.prepare_program_billing_customer(current_setting('test.g4_drain_order_id')::uuid,1::bigint,
  'acct_g4platform',false)->>'status'),'prepared',
  'drain fixture snapshots platform scope before Customer create');
select ok(public.mark_program_billing_operation_unknown(current_setting('test.g4_drain_order_id')::uuid,
  'customer_create',0::smallint,0::smallint,0::smallint),
  'Customer create is durably unknown before the simulated lost response');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_drain_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000004')->>'status'),'cancellation_requested',
  'buyer cancellation commits while the Customer response remains unknown');
reset role;
select set_config('test.g4_drain_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.reconcile_program_billing_drain_resource(current_setting('test.g4_drain_order_id')::uuid,
  current_setting('test.g4_drain_billing_revision')::bigint,
  'customer_create',0::smallint,0::smallint,0::smallint,'cus_g4_drain',
  jsonb_build_object('id','cus_g4_drain','deleted',false,'balance',0,'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_drain_order_id'),'program_billing_purpose','program_order',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('8',64))->>'status'),
  'resource_reconciled_no_access','drain binds only the exact already-created Customer after cancellation');
reset role;
select set_config('test.g4_drain_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_drain_order_id')::uuid,
  current_setting('test.g4_drain_billing_revision')::bigint,
  'https://gymx2.test/programs/drain-success','https://gymx2.test/programs/drain-cancel')->>'status'),
  'checkout_not_ready','the drain never authorizes a new Checkout create after cancellation');
reset role;
select set_config('test.g4_drain_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_drain_order_id')::uuid,
  current_setting('test.g4_drain_billing_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_drain_order_id'),
    'customerId','cus_g4_drain','customer',jsonb_build_object('id','cus_g4_drain','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_drain_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('9',64))->>'status'),
  'canceled','complete known Customer inventory plus drained unknown proves cancellation without provider or Gate 1 mutation');
reset role;
select is((select billing_state from public.program_billing_orders where order_id=current_setting('test.g4_drain_order_id')::uuid),
  'canceled','drain reconciliation does not reopen canceled billing');

-- A lost Checkout-create response can be drained only by its exact Session and
-- PaymentIntent proof after cancellation; the same operation remains unknown on mismatch.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_checkout_drain_order_id', public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000008','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-program-checkout-drain-001','G4LOST'
)::text,true);
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_checkout_drain_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'Gate 4-only checkout order starts with active nonempty lesson retention');
set local role service_role;
select is((public.prepare_program_billing_terms(current_setting('test.g4_checkout_drain_order_id')::uuid,0::bigint,
  repeat('c',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'Checkout-drain fixture persists the immutable one-time quote');
select is((public.prepare_program_billing_customer(current_setting('test.g4_checkout_drain_order_id')::uuid,1::bigint,
  'acct_g4platform',false)->>'status'),'prepared','Checkout-drain Customer scope and create intent persist before provider setup');
select ok(public.bind_program_billing_customer(current_setting('test.g4_checkout_drain_order_id')::uuid,2::bigint,
  'cus_g4_drain_checkout',jsonb_build_object('id','cus_g4_drain_checkout','deleted',false,'balance',0,
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('d',64)),
  'Checkout-drain fixture binds only its isolated merchant-scoped Customer');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_checkout_drain_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/drain-checkout-success','https://gymx2.test/programs/drain-checkout-cancel')->>'status'),
  'prepared','Checkout-drain fixture persists exact attempt URLs and create request');
reset role;
select set_config('test.g4_checkout_drain_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_checkout_drain_order_id')::uuid,1::smallint),
  'Checkout creation is durably unknown before the simulated cancellation race');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000008","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_checkout_drain_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000008')->>'status'),'cancellation_requested',
  'buyer cancellation wins before the unknown Checkout-create response is reconciled');
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_checkout_drain_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'Gate 4-only unpaid checkout retention survives cancel_requested before terminal proof');
select set_config('test.g4_checkout_drain_cancel_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_cancel_revision')::bigint,
  'https://gymx2.test/programs/drain-checkout-success','https://gymx2.test/programs/drain-checkout-cancel')->>'status'),
  'checkout_not_ready','cancellation request alone blocks another Checkout create before the account deletion fence');

set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_checkout_drain_tombstone_id','f9300000-0000-0000-0000-000000000008',true);
select set_config('test.g4_checkout_drain_deletion_request_id','f9400000-0000-0000-0000-000000000008',true);
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_checkout_drain_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000008',current_setting('test.g4_checkout_drain_deletion_request_id')::uuid,
  repeat('2',64),'f9500000-0000-0000-0000-000000000008',repeat('3',64))->>'outcome'),'reserved',
  'real media cleanup request establishes the deletion tombstone before Program billing handoff');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000008'),
  'account deletion establishes its permanent membership lock');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_checkout_drain_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','pending buyer cancellation is monotonically promoted to account deletion');
reset role;
select throws_ok($$select private.sync_program_order_retention(current_setting('test.g4_checkout_drain_order_id')::uuid)$$,
  '55000',null,'ordinary unpaid checkout retention ingress remains blocked under cleanup_reserved');
select is((select cancellation_request_id from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),'f9000000-0000-0000-0000-000000000008',
  'deletion handoff preserves the original buyer cancellation request ID');
select is((select cancellation_reason from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),'account_deletion',
  'deletion reason is promoted under the exact tombstone without resetting cancellation identity');
select is((select account_tombstone_id from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),current_setting('test.g4_checkout_drain_tombstone_id')::uuid,
  'Program order is fenced by the exact account tombstone');
select set_config('test.g4_checkout_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
create function pg_temp.g4_checkout_drain_inventory() returns jsonb language sql as $$
  select jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_checkout_drain_order_id'),
    'customerId','cus_g4_drain_checkout','customer',jsonb_build_object('id','cus_g4_drain_checkout','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_drain_checkout','customerId','cus_g4_drain_checkout',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId',null,'status','expired','paymentStatus','unpaid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_checkout_drain_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)
$$;
select set_config('test.g4_checkout_drain_tombstone_revision',(
  select revision::text from public.stream_media_account_tombstones
  where id=current_setting('test.g4_checkout_drain_tombstone_id')::uuid),true);
select set_config('test.g4_checkout_drain_operations_before',coalesce((
  select jsonb_agg(to_jsonb(operation) order by operation.id)::text from public.program_billing_operations operation
  where operation.order_id=current_setting('test.g4_checkout_drain_order_id')::uuid
),'[]'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.record_program_billing_auth_cleanup_proof(current_setting('test.g4_checkout_drain_tombstone_id')::uuid,
  current_setting('test.g4_checkout_drain_tombstone_revision')::bigint,
  'f9600000-0000-0000-0000-000000000008',
  jsonb_build_object('completeInventory',true,'orders',jsonb_build_array(pg_temp.g4_checkout_drain_inventory())))->>'proof_state'),
  'incomplete','Auth cleanup stays incomplete while the exact Checkout expiry operation is unresolved');
reset role;
select set_config('test.g4_checkout_drain_operations_after',coalesce((
  select jsonb_agg(to_jsonb(operation) order by operation.id)::text from public.program_billing_operations operation
  where operation.order_id=current_setting('test.g4_checkout_drain_order_id')::uuid
),'[]'),true);
select is((select operation_state from public.program_billing_operations
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid
    and operation_kind='checkout_create' and checkout_attempt_number=1),
  'unknown','Auth verification observes the original unknown Checkout creation');
select is(current_setting('test.g4_checkout_drain_operations_after'),
  current_setting('test.g4_checkout_drain_operations_before'),
  'read-only Auth verification leaves every billing operation row unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),'0',
  'Auth verification cannot mint a terminal receipt before cancellation completion');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_checkout_drain_order_id'),
    'customerId','cus_g4_drain_checkout','customer',jsonb_build_object('id','cus_g4_drain_checkout','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('e',64))->>'status'),
  'provider_operation_unresolved','complete inventory cannot close deletion while exact Checkout-create outcome remains unknown');
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_checkout_drain_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'unresolved Checkout evidence leaves the unpaid media obligation active');
set local role service_role;
select is((public.reconcile_program_billing_drain_resource(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,'checkout_create',1::smallint,0::smallint,0::smallint,
  'cs_g4_wrong_drain_session',jsonb_build_object('id','cs_g4_drain_checkout'),repeat('e',64))->>'status'),
  'provider_identity_mismatch_manual_review','a mixed Checkout ID cannot bind or resolve the original unknown operation');
reset role;
select is((select operation_state from public.program_billing_operations where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid
  and operation_kind='checkout_create' and checkout_attempt_number=1),'unknown',
  'mismatched object leaves the original create operation pending reconciliation');
select set_config('test.g4_checkout_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
select set_config('test.g4_checkout_drain_retention_events_before',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_checkout_drain_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
select set_config('test.g4_checkout_drain_active_checkout_rows_before',(
  select count(*)::text from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_checkout_drain_order_id')||':%'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.reconcile_program_billing_drain_resource(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,'checkout_create',1::smallint,0::smallint,0::smallint,
  'cs_g4_drain_checkout',jsonb_build_object('id','cs_g4_drain_checkout','customer_id','cus_g4_drain_checkout',
    'client_reference_id',current_setting('test.g4_checkout_drain_attempt_id'),'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
     'mode','payment','currency','usd','amount_total',1800,'status','open','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_checkout_drain_attempt_id'),'program_checkout_attempt_number','1',
      'program_installment_number','1','program_billing_kind','program_sale','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent_id',null,'payment_intent','null'::jsonb,'payment_intent_inventory_complete',true,
    'payment_intents','[]'::jsonb),repeat('f',64))->>'status'),
  'resource_reconciled_no_access','exact open unpaid null-PI Session with complete empty PI inventory binds during cancellation/deletion drain');
reset role;
select is((select checkout_session_id from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and attempt_number=1),
  'cs_g4_drain_checkout','Gate 4 persists the exact recovered open Session on its checkout attempt');
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),null::text,
  'late Gate 4 drain binding never fills the Gate 1 checkout-session field');
select is((select payment_intent_id from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and attempt_number=1),null::text,
  'open unpaid Session with JSON-null PI binds without claiming a synthetic PaymentIntent');
select is((select operation_state from public.program_billing_operations
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and operation_kind='checkout_expire'),
  'intent','binding a recovered open Session durably prepares only its exact expiry operation');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_billing_cancellation_operation_unknown(current_setting('test.g4_checkout_drain_order_id')::uuid,
  'checkout_expire',1::smallint,0::smallint),'exact recovered open Session expiry is durably unknown before provider mutation');
reset role;
select is((select operation_state from public.program_billing_operations
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and operation_kind='checkout_expire'),
  'unknown','expiry intent transitions to unknown while Gate 1 stays unbound');
select set_config('test.g4_checkout_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,
  'https://gymx2.test/programs/drain-checkout-success','https://gymx2.test/programs/drain-checkout-cancel')->>'status'),
  'account_fenced','account deletion fence blocks replacement Checkout create after cancellation');
reset role;
select set_config('test.g4_checkout_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_checkout_drain_order_id'),
    'customerId','cus_g4_drain_checkout','customer',jsonb_build_object('id','cus_g4_drain_checkout','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_drain_checkout','customerId','cus_g4_drain_checkout',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId',null,'status','expired','paymentStatus','unpaid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_checkout_drain_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('1',64))->>'status'),'canceled',
  'exact complete terminal null-PI inventory closes deletion without create, pay, or Gate 1 access');
reset role;
select is((select billing_state from public.program_billing_orders where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  'deletion_pending','draining an already-created Session never reopens deletion-pending billing');
select is((select checkout_session_id from public.program_order_state where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  null::text,'lost Checkout create drain does not bind the Gate 1 Session');
select is((select count(*)::integer from public.program_promotion_reservations
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid and state='released'),1,
  'verified Gate 4 terminal Session releases the held immutable promotion exactly once');
select is((select obligation.obligation_state from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_checkout_drain_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid' and obligation.obligation_kind='checkout_intent'),
  'released','Gate 4-only checkout retention releases only after exact terminal inventory proof');
select is((select count(*)::integer from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_checkout_drain_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_checkout_drain_retention_events_before')::integer
    + current_setting('test.g4_checkout_drain_active_checkout_rows_before')::integer,
  'Gate 4-only terminal proof adds one exact release event per preexisting active checkout obligation');
select set_config('test.g4_checkout_drain_terminal_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
select set_config('test.g4_checkout_drain_terminal_gate_revision',(select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
select set_config('test.g4_checkout_drain_receipt_count',(select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),true);
select set_config('test.g4_checkout_drain_retention_events_terminal',(select count(*)::text
  from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_checkout_drain_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_checkout_drain_order_id')::uuid,
  current_setting('test.g4_checkout_drain_revision')::bigint,
  pg_temp.g4_checkout_drain_inventory(),repeat('1',64))->>'status'),'canceled',
  'exact unbound-promotion terminal evidence replays against its original billing revision');
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_billing_revision'),
  'unbound-promotion replay leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_gate_revision'),
  'unbound-promotion replay leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_receipt_count'),
  'unbound-promotion replay reuses its immutable terminal receipt');
select is((select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_checkout_drain_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_checkout_drain_retention_events_terminal'),
  'Gate 4-only exact terminal replay creates no duplicate checkout release event');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),0,
  'null-PI deletion drain never claims a canonical installment');
select set_config('test.g4_checkout_drain_tombstone_revision',(
  select revision::text from public.stream_media_account_tombstones
  where id=current_setting('test.g4_checkout_drain_tombstone_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is(
  public.record_program_billing_auth_cleanup_proof(
    current_setting('test.g4_checkout_drain_tombstone_id')::uuid,
    current_setting('test.g4_checkout_drain_tombstone_revision')::bigint,
    current_setting('test.g4_checkout_drain_deletion_request_id')::uuid,
    jsonb_build_object(
      'completeInventory',true,
      'orders',jsonb_build_array(jsonb_build_object(
        'orderId',current_setting('test.g4_checkout_drain_order_id'),'completeInventory',true,
        'customerId','cus_g4_drain_checkout',
        'customer',jsonb_build_object('id','cus_g4_drain_checkout','deleted',false,'balance',0,
          'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
          'discountId',null,'taxExempt','none',
          'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
            'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
          'invoiceCreditBalance',jsonb_build_object('usd',0)),
        'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
        'sessions',jsonb_build_array(jsonb_build_object(
          'id','cs_g4_drain_checkout','customerId','cus_g4_drain_checkout',
          'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
          'paymentIntentId',null,'status','expired','paymentStatus','unpaid',
          'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_checkout_drain_order_id'),
            'program_checkout_attempt_id',current_setting('test.g4_checkout_drain_attempt_id'),
            'program_platform_account_id','acct_g4platform','program_livemode','false'))),
        'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb
      ))
    )
  )->>'proof_state',
  'ready','pending cancellation-to-deletion handoff drains exact null-PI evidence before the billing cleanup proof'
);
reset role;
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_billing_revision'),
  'Auth proof after the unbound-promotion close leaves billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_gate_revision'),
  'Auth proof after the unbound-promotion close leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_receipt_count'),
  'Auth proof after the unbound-promotion close reuses its terminal receipt');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9500000-0000-0000-0000-000000000008',
  'f9800000-0000-0000-0000-000000000008',repeat('7',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 finalization closes the F8 account cleanup after billing terminal proof and replay');
reset role;
select is((select state.operation_state from public.stream_media_operation_states state
  where state.operation_id='f9500000-0000-0000-0000-000000000008'),'retained',
  'F8 account cleanup ends in its retained terminal operation state');
select ok(exists(select 1 from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id='f9500000-0000-0000-0000-000000000008'
    and uid_state.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and uid_state.raw_provider_uid='g4-synthetic-retention-uid' and uid_state.uid_state='retained_attached'),
  'F8 finalization preserves the exact shared UID as retained and attached');
select ok(not private.stream_uid_blocks_new_media_reference(current_setting('test.g4_media_registry_id')::uuid,
  'g4-synthetic-retention-uid'),'F8 terminal retained media leaves no active cleanup reservation');
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_billing_revision'),
  'F8 Gate 3 finalization leaves terminal billing revision unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_terminal_gate_revision'),
  'F8 Gate 3 finalization leaves terminal Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_checkout_drain_order_id')::uuid),
  current_setting('test.g4_checkout_drain_receipt_count'),
  'F8 Gate 3 finalization leaves the immutable billing receipt count unchanged');

-- Draft Invoice deletion persists an exact pre-delete snapshot, then accepts
-- only the exact deleted response or a qualified resource_missing 404 proof.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_draft_only_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000010','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',2::smallint,'g4-draft-only-delete-001',null)::text,true);
select set_config('test.g4_item_delete_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000011','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',2::smallint,'g4-item-bound-delete-001',null)::text,true);
reset role;

insert into public.program_billing_orders (
  order_id,revision,billing_state,stripe_customer_id,provider_platform_account_id,provider_livemode,saved_payment_method_id,
  terms_version,terms_digest,accepted_at,accepted_total_cents,accepted_installment_count,disclosed_charge_dates,
  off_session_consent,retry_window_days,cancellation_stops_future_charges,current_checkout_attempt
) values
  (current_setting('test.g4_draft_only_order_id')::uuid,1,'checkout_ready','cus_g4_draft_only','acct_g4platform',false,'pm_g4_draft_only',
    1,repeat('a',64),now()-interval '1 day',2000,2,array[(now() at time zone 'America/New_York')::date],true,7,true,1),
  (current_setting('test.g4_item_delete_order_id')::uuid,1,'checkout_ready','cus_g4_item_delete','acct_g4platform',false,'pm_g4_item_delete',
    1,repeat('b',64),now()-interval '1 day',2000,2,array[(now() at time zone 'America/New_York')::date],true,7,true,1);
insert into public.program_billing_installment_invoices (
  order_id,installment_number,checkout_attempt_number,due_date,retry_started_at,
  invoice_create_idempotency_key,line_create_idempotency_key,finalize_idempotency_key,
  invoice_create_outcome,line_create_outcome,finalize_outcome,invoice_id,invoice_item_id,provider_status
) values
  (current_setting('test.g4_draft_only_order_id')::uuid,2,1,current_date,now(),
    'g4-draft-invoice-create-key','g4-draft-line-create-key','g4-draft-finalize-key','created','not_started','not_started','in_g4_draft_only',null,'unpaid'),
  (current_setting('test.g4_item_delete_order_id')::uuid,2,1,current_date,now(),
    'g4-item-invoice-create-key','g4-item-line-create-key','g4-item-finalize-key','created','created','not_started','in_g4_item_delete','ii_g4_item_delete','unpaid');
insert into public.program_billing_operations (
  order_id,operation_kind,checkout_attempt_number,installment_number,payment_attempt_number,
  idempotency_key,request_digest,operation_state
)
select billing.order_id,'invoice_finalize',1,2,0,
  'program:' || billing.order_id::text || ':invoice_finalize:a1:i2:p0:v1',
  private.stream_media_identity_digest(private.stream_media_identity_digest(
    billing.order_id::text || '|invoice|' || billing.terms_digest || '|2|1|' || orders.installment_amounts_cents[2]::text)
    || '|finalize'),'intent'
from public.program_billing_orders billing join public.program_orders orders on orders.id = billing.order_id
where billing.order_id in (current_setting('test.g4_draft_only_order_id')::uuid,current_setting('test.g4_item_delete_order_id')::uuid);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_billing_operation_unknown(current_setting('test.g4_item_delete_order_id')::uuid,
  'invoice_finalize',1::smallint,2::smallint,0::smallint),'item-bound finalization becomes durable unknown before provider reconciliation');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000010","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_draft_only_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000010')->>'status'),'cancellation_requested','draft-only buyer cancellation establishes its durable fence');
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_item_delete_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000011')->>'status'),'cancellation_requested','item-bound buyer cancellation establishes its durable fence');
reset role;
select set_config('test.g4_draft_only_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_draft_only_order_id')::uuid),true);
select set_config('test.g4_item_delete_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
with item_snapshot(snapshot) as (select jsonb_build_object(
  'customerId','cus_g4_item_delete','pendingInvoiceItemCount',0,
  'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
  'invoiceIds',jsonb_build_array('in_g4_item_delete'),'paymentIntents','[]'::jsonb,
  'pendingInvoiceItemIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
  'lines',jsonb_build_array(jsonb_build_object('id','il_g4_item_delete','invoiceId','in_g4_item_delete',
    'invoiceItemId','ii_g4_item_delete','customerId','cus_g4_item_delete','amount',1000,'currency','usd',
    'quantity',1,'discountable',false,'discounts','[]'::jsonb,'taxRates','[]'::jsonb,'taxAmounts','[]'::jsonb,
    'proration',false,'subscriptionId',null,'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'invoicePayments','[]'::jsonb,
  'customer',jsonb_build_object('id','cus_g4_item_delete','deleted',false,'balance',0,'invoiceCreditBalance',jsonb_build_object('usd',0),
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false')),
  'invoice',jsonb_build_object('id','in_g4_item_delete','customerId','cus_g4_item_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','draft',
    'autoAdvance',false,'collectionMethod','charge_automatically','billingReason','manual','currency','usd',
    'subscriptionId',null,'parentType',null,'amountDue',1000,'amountPaid',0,'amountRemaining',1000,
    'amountOverpaid',0,'amountShipping',0,'subtotal',1000,'total',1000,'startingBalance',0,
    'automaticTaxEnabled',false,'defaultPaymentMethodId','pm_g4_item_delete','discounts','[]'::jsonb,
    'totalDiscountAmounts','[]'::jsonb,'defaultTaxRates','[]'::jsonb,'totalTaxes','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))))
select set_config('test.g4_item_delete_snapshot',snapshot::text,true)
from item_snapshot;
select ok(coalesce(
  jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice')='object'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'id'='in_g4_item_delete'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'customerId'='cus_g4_item_delete'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'status'='draft'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountDue'='1000'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountPaid'='0'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountRemaining'='1000'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'total'='1000'
  and jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'customer')='object'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'customer'->>'id'='cus_g4_item_delete'
  and jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'lines')='array'
  and case when jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'lines')='array'
    then jsonb_array_length(current_setting('test.g4_item_delete_snapshot')::jsonb->'lines')=1 else false end,
  false),'item-bound draft fixture has exact root Invoice, Customer, amount, and one-line shape');
reset role;
select set_config('test.g4_item_delete_invoice_rows_before',coalesce((
  select jsonb_agg(to_jsonb(invoice_row) order by invoice_row.installment_number,invoice_row.checkout_attempt_number)
  from public.program_billing_installment_invoices invoice_row
  where invoice_row.order_id=current_setting('test.g4_item_delete_order_id')::uuid),'[]'::jsonb)::text,true);
select set_config('test.g4_item_delete_operations_before',coalesce((
  select jsonb_agg(to_jsonb(operation) order by operation.id)
  from public.program_billing_operations operation
  where operation.order_id=current_setting('test.g4_item_delete_order_id')::uuid),'[]'::jsonb)::text,true);
select is((select count(*)::text from public.program_billing_operations
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and operation_kind='invoice_delete'),
  '0','unknown invoice finalization has no draft-delete intent before the eligibility check');
select is((select count(*)::text from public.program_billing_invoice_delete_proofs
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  '0','unknown invoice finalization has no draft-delete proof before the eligibility check');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.prepare_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  current_setting('test.g4_item_delete_revision')::bigint,2::smallint,'in_g4_item_delete',
  current_setting('test.g4_item_delete_snapshot')::jsonb,repeat('c',64))->>'status'),
  'invoice_delete_identity_mismatch','unknown finalization fails the invoice identity fence before draft deletion');
reset role;
select set_config('test.g4_item_delete_invoice_rows_after',coalesce((
  select jsonb_agg(to_jsonb(invoice_row) order by invoice_row.installment_number,invoice_row.checkout_attempt_number)
  from public.program_billing_installment_invoices invoice_row
  where invoice_row.order_id=current_setting('test.g4_item_delete_order_id')::uuid),'[]'::jsonb)::text,true);
select set_config('test.g4_item_delete_operations_after',coalesce((
  select jsonb_agg(to_jsonb(operation) order by operation.id)
  from public.program_billing_operations operation
  where operation.order_id=current_setting('test.g4_item_delete_order_id')::uuid),'[]'::jsonb)::text,true);
select is(current_setting('test.g4_item_delete_invoice_rows_after'),
  current_setting('test.g4_item_delete_invoice_rows_before'),
  'unknown finalization leaves the complete invoice row unchanged');
select is(current_setting('test.g4_item_delete_operations_after'),
  current_setting('test.g4_item_delete_operations_before'),
  'unknown finalization leaves every deterministically ordered billing operation unchanged');
select is((select count(*)::text from public.program_billing_operations
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and operation_kind='invoice_delete'),
  '0','unknown finalization creates no draft-delete intent');
select is((select count(*)::text from public.program_billing_invoice_delete_proofs
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  '0','unknown finalization creates no draft-delete proof');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
with item_evidence(evidence) as (select jsonb_build_object(
  'invoice',jsonb_build_object('id','in_g4_item_delete','customer_id','cus_g4_item_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'auto_advance',false,
    'currency','usd','status','draft','billing_reason','manual','starting_balance',0,'amount_shipping',0,
    'subtotal',1000,'total',1000,'discounts','[]'::jsonb,'total_discount_amounts','[]'::jsonb,
    'default_tax_rates','[]'::jsonb,'total_taxes','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false')),
  'invoice_lines',jsonb_build_array(jsonb_build_object('invoice_id','in_g4_item_delete','invoice_item_id','ii_g4_item_delete',
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'amount',1000,'currency','usd','proration',false,'subscription_id',null,'discounts','[]'::jsonb,
    'tax_rates','[]'::jsonb,'tax_amounts','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'invoice_payments','[]'::jsonb))
select is((public.reconcile_program_billing_drain_resource(current_setting('test.g4_item_delete_order_id')::uuid,
  current_setting('test.g4_item_delete_revision')::bigint,'invoice_finalize',1::smallint,2::smallint,0::smallint,
  'in_g4_item_delete',evidence,repeat('d',64))->>'status'),'finalize_not_applied_invoice_remains_unpaid',
  'unknown finalization reconciles only to the exact draft Invoice and item-bound line')
from item_evidence;
reset role;
select is((select finalize_outcome from public.program_billing_installment_invoices
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and installment_number=2),
  'not_started','exact draft readback clears the stale unknown finalization outcome');
select set_config('test.g4_item_delete_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
with item_snapshot(snapshot) as (select jsonb_build_object(
  'customerId','cus_g4_item_delete','pendingInvoiceItemCount',0,
  'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
  'invoiceIds',jsonb_build_array('in_g4_item_delete'),'paymentIntents','[]'::jsonb,
  'pendingInvoiceItemIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
  'lines',jsonb_build_array(jsonb_build_object('id','il_g4_item_delete','invoiceId','in_g4_item_delete',
    'invoiceItemId','ii_g4_item_delete','customerId','cus_g4_item_delete','amount',1000,'currency','usd',
    'quantity',1,'discountable',false,'discounts','[]'::jsonb,'taxRates','[]'::jsonb,'taxAmounts','[]'::jsonb,
    'proration',false,'subscriptionId',null,'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'invoicePayments','[]'::jsonb,
  'customer',jsonb_build_object('id','cus_g4_item_delete','deleted',false,'balance',0,'invoiceCreditBalance',jsonb_build_object('usd',0),
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false')),
  'invoice',jsonb_build_object('id','in_g4_item_delete','customerId','cus_g4_item_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','draft',
    'autoAdvance',false,'collectionMethod','charge_automatically','billingReason','manual','currency','usd',
    'subscriptionId',null,'parentType',null,'amountDue',1000,'amountPaid',0,'amountRemaining',1000,
    'amountOverpaid',0,'amountShipping',0,'subtotal',1000,'total',1000,'startingBalance',0,
    'automaticTaxEnabled',false,'defaultPaymentMethodId','pm_g4_item_delete','discounts','[]'::jsonb,
    'totalDiscountAmounts','[]'::jsonb,'defaultTaxRates','[]'::jsonb,'totalTaxes','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))))
select set_config('test.g4_item_delete_open_snapshot',
  jsonb_set(snapshot,'{invoice,status}','"open"'::jsonb,true)::text,true)
from item_snapshot;
select ok(coalesce(
  jsonb_typeof(current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice')='object'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'id'='in_g4_item_delete'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'customerId'='cus_g4_item_delete'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'status'='open'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'amountDue'='1000'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'amountPaid'='0'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'amountRemaining'='1000'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'invoice'->>'total'='1000'
  and jsonb_typeof(current_setting('test.g4_item_delete_open_snapshot')::jsonb->'customer')='object'
  and current_setting('test.g4_item_delete_open_snapshot')::jsonb->'customer'->>'id'='cus_g4_item_delete'
  and case when jsonb_typeof(current_setting('test.g4_item_delete_open_snapshot')::jsonb->'lines')='array'
    then jsonb_array_length(current_setting('test.g4_item_delete_open_snapshot')::jsonb->'lines')=1 else false end,
  false),'open-invoice negative fixture changes the nested exact Invoice and keeps its Customer and line shape');
select is((public.prepare_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  current_setting('test.g4_item_delete_revision')::bigint,2::smallint,'in_g4_item_delete',
  current_setting('test.g4_item_delete_open_snapshot')::jsonb,repeat('c',64))->>'status'),
  'delete_snapshot_invoice_mismatch','a finalized/open Invoice cannot pass the draft delete fence');
reset role;

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
with item_snapshot(snapshot) as (select jsonb_build_object(
  'customerId','cus_g4_item_delete','pendingInvoiceItemCount',0,
  'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
  'invoiceIds',jsonb_build_array('in_g4_item_delete'),'paymentIntents','[]'::jsonb,
  'pendingInvoiceItemIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
  'lines',jsonb_build_array(jsonb_build_object('id','il_g4_item_delete','invoiceId','in_g4_item_delete',
    'invoiceItemId','ii_g4_item_delete','customerId','cus_g4_item_delete','amount',1000,'currency','usd',
    'quantity',1,'discountable',false,'discounts','[]'::jsonb,'taxRates','[]'::jsonb,'taxAmounts','[]'::jsonb,
    'proration',false,'subscriptionId',null,'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment_line',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'invoicePayments','[]'::jsonb,
  'customer',jsonb_build_object('id','cus_g4_item_delete','deleted',false,'balance',0,'invoiceCreditBalance',jsonb_build_object('usd',0),
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false')),
  'invoice',jsonb_build_object('id','in_g4_item_delete','customerId','cus_g4_item_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','draft',
    'autoAdvance',false,'collectionMethod','charge_automatically','billingReason','manual','currency','usd',
    'subscriptionId',null,'parentType',null,'amountDue',1000,'amountPaid',0,'amountRemaining',1000,
    'amountOverpaid',0,'amountShipping',0,'subtotal',1000,'total',1000,'startingBalance',0,
    'automaticTaxEnabled',false,'defaultPaymentMethodId','pm_g4_item_delete','discounts','[]'::jsonb,
    'totalDiscountAmounts','[]'::jsonb,'defaultTaxRates','[]'::jsonb,'totalTaxes','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))))
select set_config('test.g4_item_delete_snapshot',snapshot::text,true)
from item_snapshot;
select ok(coalesce(
  jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice')='object'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'id'='in_g4_item_delete'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'customerId'='cus_g4_item_delete'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'status'='draft'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountDue'='1000'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountPaid'='0'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'amountRemaining'='1000'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'invoice'->>'total'='1000'
  and jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'customer')='object'
  and current_setting('test.g4_item_delete_snapshot')::jsonb->'customer'->>'id'='cus_g4_item_delete'
  and case when jsonb_typeof(current_setting('test.g4_item_delete_snapshot')::jsonb->'lines')='array'
    then jsonb_array_length(current_setting('test.g4_item_delete_snapshot')::jsonb->'lines')=1 else false end,
  false),'positive item-bound fixture has a draft Invoice, exact Customer, and one immutable line');
select is((public.prepare_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  current_setting('test.g4_item_delete_revision')::bigint,2::smallint,'in_g4_item_delete',
  current_setting('test.g4_item_delete_snapshot')::jsonb,repeat('c',64))->>'status'),
  'prepared','exact item-bound draft snapshot is durably persisted before deletion');
reset role;
select set_config('test.g4_item_delete_key',(select idempotency_key from public.program_billing_operations
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and operation_kind='invoice_delete'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_item_delete_tombstone_id','f9300000-0000-0000-0000-000000000011',true);
select set_config('test.g4_item_delete_request_id','f9400000-0000-0000-0000-000000000011',true);
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_item_delete_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000011',current_setting('test.g4_item_delete_request_id')::uuid,
  repeat('2',64),'f9500000-0000-0000-0000-000000000011',repeat('3',64))->>'outcome'),'reserved',
  'account deletion starts after the buyer has durably prepared a draft delete');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000011'),
  'account deletion fences the buyer before promoting the cancellation');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_item_delete_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','account deletion promotes cancellation while retaining its exact draft cleanup intent');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_item_delete_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','repeated account-deletion setup leaves the same exact draft cleanup intent usable');
reset role;
select is((select cancellation_request_id from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),'f9000000-0000-0000-0000-000000000011',
  'delete promotion preserves the immutable original buyer cancellation request ID');
select is((select operation_state from public.program_billing_operations
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and operation_kind='invoice_delete'),
  'intent','exact prepared draft deletion remains actionable after account-deletion promotion');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.get_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete')->>'status'),'found',
  'trusted recovery reads the persisted same-invoice delete proof through its narrow RPC');
select is((public.get_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete')->>'idempotencyKey'),current_setting('test.g4_item_delete_key'),
  'draft delete recovery returns the original immutable operation key');
select is((public.get_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete')->'snapshot'->'lines'->0->>'invoiceItemId'),'ii_g4_item_delete',
  'persisted draft delete getter returns the exact original item-bound snapshot');
select ok(public.mark_program_billing_draft_invoice_delete_unknown(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete'),'item-bound delete intent is durably unknown before sending the provider request');
select ok(not public.mark_program_billing_draft_invoice_delete_unknown(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete'),'an already-unknown DELETE is not claimed for a second provider request');
select is((public.reconcile_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete',current_setting('test.g4_item_delete_key'),repeat('c',64),
  jsonb_build_object('status','missing','invoiceId','in_g4_item_delete','httpStatus',404,'errorCode','resource_missing',
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false)),repeat('e',64))->>'status'),
  'delete_absence_proof_incomplete','a bare 404 without complete fresh same-scope inventory remains unresolved');
select is((public.reconcile_program_billing_draft_invoice_delete(current_setting('test.g4_item_delete_order_id')::uuid,
  2::smallint,'in_g4_item_delete',current_setting('test.g4_item_delete_key'),repeat('c',64),
  jsonb_build_object('status','missing','invoiceId','in_g4_item_delete','httpStatus',404,'errorCode','resource_missing',
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'inventory',jsonb_build_object('completeInventory',true,'customerId','cus_g4_item_delete','pendingInvoiceItemCount',0,
      'pendingInvoiceItemIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,'invoices','[]'::jsonb,
      'paymentIntents','[]'::jsonb,'customer',jsonb_build_object('id','cus_g4_item_delete','deleted',false,'balance',0,
        'invoiceCreditBalance',jsonb_build_object('usd',0),'discountId',null,'taxExempt','none','livemode',false,
        'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
        'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_item_delete_order_id'),
          'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false')))),
  repeat('e',64))->>'status'),'deleted_no_access_change',
  'qualified resource_missing 404 reconciles only with complete same-customer scoped inventories');
reset role;
select is((select proof_state from public.program_billing_invoice_delete_proofs
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid and installment_number=2),
  'missing','qualified 404 persists the immutable pre-delete proof and terminal absence evidence');

set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
with draft_snapshot(snapshot) as (select jsonb_build_object(
  'customerId','cus_g4_draft_only','pendingInvoiceItemCount',0,
  'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
  'invoiceIds',jsonb_build_array('in_g4_draft_only'),'paymentIntents','[]'::jsonb,
  'pendingInvoiceItemIds','[]'::jsonb,'subscriptionIds','[]'::jsonb,'scheduleIds','[]'::jsonb,
  'lines','[]'::jsonb,'invoicePayments','[]'::jsonb,
  'customer',jsonb_build_object('id','cus_g4_draft_only','deleted',false,'balance',0,'invoiceCreditBalance',jsonb_build_object('usd',0),
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_draft_only_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false')),
  'invoice',jsonb_build_object('id','in_g4_draft_only','customerId','cus_g4_draft_only','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),'status','draft',
    'autoAdvance',false,'collectionMethod','charge_automatically','billingReason','manual','currency','usd',
    'subscriptionId',null,'parentType',null,'amountDue',0,'amountPaid',0,'amountRemaining',0,
    'amountOverpaid',0,'amountShipping',0,'subtotal',0,'total',0,'startingBalance',0,
    'automaticTaxEnabled',false,'defaultPaymentMethodId','pm_g4_draft_only','discounts','[]'::jsonb,
    'totalDiscountAmounts','[]'::jsonb,'defaultTaxRates','[]'::jsonb,'totalTaxes','[]'::jsonb,
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_draft_only_order_id'),
      'program_installment_number','2','program_attempt_number','1','program_billing_kind','standalone_installment',
      'program_platform_account_id','acct_g4platform','program_livemode','false'))))
select set_config('test.g4_draft_only_snapshot',snapshot::text,true)
from draft_snapshot;
select ok(coalesce(
  jsonb_typeof(current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice')='object'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'id'='in_g4_draft_only'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'customerId'='cus_g4_draft_only'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'status'='draft'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'amountDue'='0'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'amountPaid'='0'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'amountRemaining'='0'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'invoice'->>'total'='0'
  and jsonb_typeof(current_setting('test.g4_draft_only_snapshot')::jsonb->'customer')='object'
  and current_setting('test.g4_draft_only_snapshot')::jsonb->'customer'->>'id'='cus_g4_draft_only'
  and case when jsonb_typeof(current_setting('test.g4_draft_only_snapshot')::jsonb->'lines')='array'
    then jsonb_array_length(current_setting('test.g4_draft_only_snapshot')::jsonb->'lines')=0 else false end,
  false),'zero-line fixture has its exact draft Invoice and Customer with no line objects');
select is((public.prepare_program_billing_draft_invoice_delete(current_setting('test.g4_draft_only_order_id')::uuid,
  current_setting('test.g4_draft_only_revision')::bigint,2::smallint,'in_g4_draft_only',
  current_setting('test.g4_draft_only_snapshot')::jsonb,repeat('f',64))->>'status'),
  'prepared','exact zero-line draft Invoice is safely prepared for deletion');
reset role;
select set_config('test.g4_draft_only_key',(select idempotency_key from public.program_billing_operations
  where order_id=current_setting('test.g4_draft_only_order_id')::uuid and operation_kind='invoice_delete'),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_billing_draft_invoice_delete_unknown(current_setting('test.g4_draft_only_order_id')::uuid,
  2::smallint,'in_g4_draft_only'),'draft-only DELETE intent is persisted before provider call');
select is((public.reconcile_program_billing_draft_invoice_delete(current_setting('test.g4_draft_only_order_id')::uuid,
  2::smallint,'in_g4_draft_only',current_setting('test.g4_draft_only_key'),repeat('f',64),
  jsonb_build_object('status','deleted','invoiceId','in_g4_draft_only','object','invoice','deleted',true,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false)),repeat('1',64))->>'status'),
  'deleted_no_access_change','exact DeletedInvoice response durably reconciles a draft-only deletion without touching access');
reset role;
select is((select proof_state from public.program_billing_invoice_delete_proofs
  where order_id=current_setting('test.g4_draft_only_order_id')::uuid and installment_number=2),
  'deleted','exact invoice delete response persists the immutable snapshot and terminal proof');
select set_config('test.g4_item_delete_billing_state_before_gate3',(
  select billing_state from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);
select set_config('test.g4_item_delete_billing_revision_before_gate3',(
  select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);
select set_config('test.g4_item_delete_gate_state_before_gate3',(
  select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);
select set_config('test.g4_item_delete_gate_revision_before_gate3',(
  select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);
select set_config('test.g4_item_delete_receipt_count_before_gate3',(
  select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9500000-0000-0000-0000-000000000011',
  'f9800000-0000-0000-0000-000000000011',repeat('8',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 finalization closes F11 media cleanup after all draft-delete proof assertions');
reset role;
select is((select state.operation_state from public.stream_media_operation_states state
  where state.operation_id='f9500000-0000-0000-0000-000000000011'),'retained',
  'F11 account cleanup ends in its retained terminal operation state');
select ok(exists(select 1 from public.stream_media_operation_uid_state uid_state
  where uid_state.operation_id='f9500000-0000-0000-0000-000000000011'
    and uid_state.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and uid_state.raw_provider_uid='g4-synthetic-retention-uid' and uid_state.uid_state='retained_attached'),
  'F11 finalization preserves the exact shared UID as retained and attached');
select ok(not private.stream_uid_blocks_new_media_reference(current_setting('test.g4_media_registry_id')::uuid,
  'g4-synthetic-retention-uid'),'F11 terminal retained media leaves no active cleanup reservation');
select is((select billing_state from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  current_setting('test.g4_item_delete_billing_state_before_gate3'),
  'F11 media finalization leaves still-pending billing state unchanged');
select is((select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  current_setting('test.g4_item_delete_billing_revision_before_gate3'),
  'F11 media finalization leaves billing revision unchanged');
select is((select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  current_setting('test.g4_item_delete_gate_state_before_gate3'),
  'F11 media finalization leaves Gate 1 state unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  current_setting('test.g4_item_delete_gate_revision_before_gate3'),
  'F11 media finalization leaves Gate 1 revision unchanged');
select is((select count(*)::text from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_item_delete_order_id')::uuid),
  current_setting('test.g4_item_delete_receipt_count_before_gate3'),
  'F11 media finalization does not create a Program billing completion receipt');

-- A buyer-only cancellation can recover an open Session with no PaymentIntent,
-- bind it only in Gate 4, then durably expire it without claiming access.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_buyer_null_pi_drain_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000012','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-program-buyer-null-pi-drain-001',null
)::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,0::bigint,
  repeat('4',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'buyer-only null-PI drain fixture freezes its one-time terms');
select is((public.prepare_program_billing_customer(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,1::bigint,
  'acct_g4platform',false)->>'status'),'prepared','buyer-only null-PI fixture persists captured merchant scope before Customer setup');
select ok(public.bind_program_billing_customer(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,2::bigint,
  'cus_g4_buyer_drain',jsonb_build_object('id','cus_g4_buyer_drain','deleted',false,'balance',0,
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_buyer_null_pi_drain_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('5',64)),
  'buyer-only null-PI fixture binds only its exact scoped isolated Customer');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/buyer-drain-success','https://gymx2.test/programs/buyer-drain-cancel')->>'status'),
  'prepared','buyer-only null-PI fixture persists the exact Checkout request');
reset role;
select set_config('test.g4_buyer_null_pi_drain_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,1::smallint),
  'buyer-only null-PI Checkout creation is durably unknown before recovery');
reset role;
set local role authenticated;
set local request.jwt.claim.role = 'authenticated';
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000012","role":"authenticated"}';
select is((public.request_program_billing_cancellation(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,
  'f9000000-0000-0000-0000-000000000012')->>'status'),'cancellation_requested',
  'buyer-only cancellation fences the unresolved Checkout before binding');
reset role;
select set_config('test.g4_buyer_null_pi_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.reconcile_program_billing_drain_resource(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,
  current_setting('test.g4_buyer_null_pi_drain_revision')::bigint,'checkout_create',1::smallint,0::smallint,0::smallint,
  'cs_g4_buyer_open_no_pi',jsonb_build_object('id','cs_g4_buyer_open_no_pi','customer_id','cus_g4_buyer_drain',
    'client_reference_id',current_setting('test.g4_buyer_null_pi_drain_attempt_id'),'livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'mode','payment','currency','usd','amount_total',2000,'status','open','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_buyer_null_pi_drain_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_buyer_null_pi_drain_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false'),
    'payment_intent_id',null,'payment_intent','null'::jsonb,'payment_intent_inventory_complete',true,
    'payment_intents','[]'::jsonb),repeat('6',64))->>'status'),'resource_reconciled_no_access',
  'buyer-only drain binds the exact open unpaid Session from complete empty PI inventory');
reset role;
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),null::text,
  'buyer-only drain does not populate the Gate 1 Session field');
select is((select payment_intent_id from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid and attempt_number=1),null::text,
  'buyer-only drain does not fabricate or claim a PaymentIntent');
select set_config('test.g4_buyer_null_pi_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_billing_cancellation_operation_unknown(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,
  'checkout_expire',1::smallint,0::smallint),'buyer-only drain records its exact expiry attempt before provider mutation');
reset role;
select set_config('test.g4_buyer_null_pi_drain_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid,
  current_setting('test.g4_buyer_null_pi_drain_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_buyer_null_pi_drain_order_id'),
    'customerId','cus_g4_buyer_drain','customer',jsonb_build_object('id','cus_g4_buyer_drain','deleted',false,'balance',0,
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_buyer_null_pi_drain_order_id'),
        'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
      'invoiceCreditBalance',jsonb_build_object('usd',0)),
    'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_buyer_open_no_pi','customerId','cus_g4_buyer_drain',
      'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
      'paymentIntentId',null,'status','expired','paymentStatus','unpaid',
      'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_buyer_null_pi_drain_order_id'),
        'program_checkout_attempt_id',current_setting('test.g4_buyer_null_pi_drain_attempt_id'),
        'program_platform_account_id','acct_g4platform','program_livemode','false'))),
    'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('7',64))->>'status'),
  'canceled','buyer-only cancellation completes only after the exact recovered Session is verified expired and unpaid');
reset role;
select is((select operation_state from public.program_billing_operations
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid and operation_kind='checkout_expire'),
  'succeeded','buyer-only expiry operation completes from terminal inventory');
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),null::text,
  'buyer-only terminal completion leaves the Gate 1 Session field null');
select is((select count(*) from public.program_payment_intent_claims claim
  where claim.order_id=current_setting('test.g4_buyer_null_pi_drain_order_id')::uuid),0::bigint,
  'buyer-only null-PI drain creates no PaymentIntent claim or access');

-- Deletion can be the first cancellation request. Terminal Gate 1 writes need
-- the exact private receipt minted only after complete, resolved inventory.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_first_delete_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000013','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-first-delete-001','G4FIRSTDELETE')::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_first_delete_order_id')::uuid,0::bigint,
  repeat('a',64),array[]::date[],false,null::smallint)->>'status'),'saved',
  'first-deletion fixture has a nonzero one-time billing row but no Customer or Checkout');
reset role;
select is((select cancellation_request_id from public.program_billing_orders
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),null::uuid,
  'first-deletion fixture has no buyer cancellation request');
select is((select effective_total_cents from public.program_orders
  where id=current_setting('test.g4_first_delete_order_id')::uuid),1800,
  'first-deletion fixture reserves one unpaid fixed-discount promotion');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_first_delete_tombstone_id','f9300000-0000-0000-0000-000000000013',true);
select set_config('test.g4_first_delete_request_id','f9400000-0000-0000-0000-000000000013',true);
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_first_delete_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000013',current_setting('test.g4_first_delete_request_id')::uuid,
  repeat('e',64),'f9500000-0000-0000-0000-000000000013',repeat('f',64))->>'outcome'),'reserved',
  'first billing cancellation starts from the exact account deletion tombstone');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000013'),
  'first billing cancellation account is permanently fenced before handoff');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_first_delete_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','account deletion itself establishes cancellation without a prior buyer request');
reset role;
select is((select cancellation_request_id from public.program_billing_orders
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),
  current_setting('test.g4_first_delete_request_id')::uuid,
  'first deletion binds its own exact durable cancellation request identity');
select is((select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),'cancel_requested',
  'account deletion first moves Gate 1 only into the monotonic cancel-requested state');
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_first_delete_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'first-deletion unpaid checkout retention survives cancel_requested before terminal proof');
select set_config('test.g4_first_delete_retention_events_before',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_first_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
select set_config('test.g4_first_delete_active_checkout_rows_before',(
  select count(*)::text from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_first_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),true);
select set_config('test.g4_first_delete_edge_count_before_terminal',(
  select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000013' and edge.relation_kind='assigned_member'),true);
select is((select count(*)::integer from private.program_order_closing_receipts
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),0,
  'no terminal receipt exists before complete inventory reconciliation');
select set_config('test.g4_first_delete_precomplete_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),true);
select set_config('test.g4_first_delete_gate_row_before_access_negative',(
  select to_jsonb(state)::text from public.program_order_state state
  where state.order_id=current_setting('test.g4_first_delete_order_id')::uuid),true);
select set_config('test.g4_first_delete_gate_revision_before_access_negative',(
  select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),true);
select ok((select access_started_on is null from public.program_order_state
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),
  'access start is absent before the rejected direct transition');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select throws_ok($$update public.program_order_state set billing_state='canceled',revision=revision+1
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid$$,
  '55000',null,'service-only direct terminal update is rejected without the private completion receipt');
select throws_ok($$update public.program_order_state set checkout_session_id='cs_g4_forged',revision=revision+1
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid$$,
  '55000',null,'closing transition cannot replace the exact Gate 1 Session binding');
select throws_ok($$update public.program_order_state set access_started_on=current_date,revision=revision+1
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid$$,
  '23514','A paid access start requires the first net-settled installment',
  'closing transition cannot fabricate an access start date');
reset role;
select is((select to_jsonb(state)::text from public.program_order_state state
  where state.order_id=current_setting('test.g4_first_delete_order_id')::uuid),
  current_setting('test.g4_first_delete_gate_row_before_access_negative'),
  'rejected access start leaves the complete Gate 1 row unchanged');
select is((select revision::text from public.program_order_state
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),
  current_setting('test.g4_first_delete_gate_revision_before_access_negative'),
  'rejected access start leaves the Gate 1 revision unchanged');
select is((select access_started_on from public.program_order_state
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),null::date,
  'rejected access start leaves access_started_on null');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_first_delete_order_id')::uuid,
  current_setting('test.g4_first_delete_precomplete_revision')::bigint,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_first_delete_order_id'),
    'customerId',null,'customer',null,'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('1',64))->>'status'),
  'canceled','complete pre-Customer inventory releases only the proven unpaid promotion and closes the first-deletion order');
reset role;
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),'released',
  'first deletion releases its never-bound unpaid promotion reservation exactly once');
select is((select billing_state from public.program_billing_orders
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),'deletion_pending',
  'terminal cancellation preserves account-deletion billing history');
select is((select count(*)::integer from public.program_billing_provider_observations
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),0,
  'first deletion creates no provider observations or synthetic settlement facts');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),0,
  'first deletion creates no payment claim or access grant');
select is((select count(*)::integer from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000013' and edge.relation_kind='assigned_member'),
  current_setting('test.g4_first_delete_edge_count_before_terminal')::integer,
  'closing branch preserves existing buyer source-account edges without adding new ones');
select is((select obligation.obligation_state from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_first_delete_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid' and obligation.obligation_kind='checkout_intent'),
  'released','unpaid checkout retention releases only after exact terminal cancellation proof');
select is((select count(*)::integer from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_first_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_first_delete_retention_events_before')::integer
    + current_setting('test.g4_first_delete_active_checkout_rows_before')::integer,
  'first deletion terminal proof adds one release event for each active unpaid checkout obligation');
select set_config('test.g4_first_delete_retention_events_terminal',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_first_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
select set_config('test.g4_first_delete_terminal_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_first_delete_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_first_delete_order_id')::uuid,
  current_setting('test.g4_first_delete_terminal_revision')::bigint-1,
  jsonb_build_object('completeInventory',true,'orderId',current_setting('test.g4_first_delete_order_id'),
    'customerId',null,'customer',null,'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
    'sessions','[]'::jsonb,'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb),repeat('1',64))->>'status'),
  'canceled','exact inventory and evidence receipt permits idempotent terminal replay');
reset role;
select is((select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_first_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_first_delete_retention_events_terminal'),
  'first deletion exact terminal replay creates no duplicate checkout release event');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9500000-0000-0000-0000-000000000013',
  'f9800000-0000-0000-0000-000000000013',repeat('6',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 finalization closes the first-deletion cleanup reservation after exact release replay');
reset role;
select ok(exists(select 1 from public.stream_media_operation_states operation_state
  join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=operation_state.operation_id
  where operation_state.operation_id='f9500000-0000-0000-0000-000000000013'
    and operation_state.operation_state in ('retained','completed')
    and uid_state.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and uid_state.raw_provider_uid='g4-synthetic-retention-uid'
    and uid_state.uid_state in ('retained_attached','deleted_confirmed','already_absent_confirmed')),
  'first deletion leaves the exact media UID in an accepted terminal cleanup state');

-- A Gate 1-bound expired unpaid Session releases its promotion only after the
-- terminal receipt is recorded. This is distinct from the Gate 4-only drain above.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_bound_delete_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000014','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',1::smallint,'g4-bound-delete-001','G4BOUNDDELETE')::text,true);
select is((public.prepare_program_billing_terms(current_setting('test.g4_bound_delete_order_id')::uuid,0::bigint,
  repeat('b',64),array[]::date[],false,null::smallint)->>'status'),'saved','bound-session deletion fixture saves one-time terms');
select is((public.prepare_program_billing_customer(current_setting('test.g4_bound_delete_order_id')::uuid,1::bigint,
  'acct_g4platform',false)->>'status'),'prepared','bound-session deletion fixture persists exact customer-create intent');
select ok(public.bind_program_billing_customer(current_setting('test.g4_bound_delete_order_id')::uuid,2::bigint,
  'cus_g4_bound_delete',jsonb_build_object('id','cus_g4_bound_delete','deleted',false,'balance',0,
    'discountId',null,'taxExempt','none','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_bound_delete_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),repeat('c',64)),
  'bound-session deletion fixture binds only exact zero-balance Customer facts');
select is((public.prepare_program_checkout_attempt(current_setting('test.g4_bound_delete_order_id')::uuid,3::bigint,
  'https://gymx2.test/programs/bound-delete-success','https://gymx2.test/programs/bound-delete-cancel')->>'status'),
  'prepared','bound-session deletion fixture persists exact Checkout request');
reset role;
select set_config('test.g4_bound_delete_attempt_id',(select attempt_id::text from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid and attempt_number=1),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select ok(public.mark_program_checkout_create_unknown(current_setting('test.g4_bound_delete_order_id')::uuid,1::smallint),
  'bound-session Checkout create has a durable unknown result before binding');
select ok(public.bind_program_billing_checkout_session(current_setting('test.g4_bound_delete_order_id')::uuid,4::bigint,
  1::smallint,'cs_g4_bound_delete',null,
  jsonb_build_object('id','cs_g4_bound_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
     'customer_id','cus_g4_bound_delete','client_reference_id',current_setting('test.g4_bound_delete_attempt_id'),
     'payment_intent_id',null,'payment_intent','null'::jsonb,'mode','payment','currency','usd','amount_total',1800,
     'status','open','payment_status','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_bound_delete_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_bound_delete_attempt_id'),
      'program_checkout_attempt_number','1','program_installment_number','1','program_billing_kind','program_sale',
      'program_platform_account_id','acct_g4platform','program_livemode','false')),repeat('d',64)),
  'exact open unpaid null-PI Session binds at Gate 1');
reset role;
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'cs_g4_bound_delete',
  'unpaid Session fixture is bound at Gate 1, separate from the Gate 4-only drain');

-- Foreign order evidence cannot close a second order. A same-order private
-- receipt is minted only after this order's exact cancellation inventory passes.
select set_config('test.g4_bound_delete_tombstone_id','f9300000-0000-0000-0000-000000000014',true);
select set_config('test.g4_bound_delete_request_id','f9400000-0000-0000-0000-000000000014',true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_bound_delete_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000014',current_setting('test.g4_bound_delete_request_id')::uuid,
  repeat('2',64),'f9500000-0000-0000-0000-000000000014',repeat('3',64))->>'outcome'),'reserved',
  'Gate 1-bound unpaid Session deletion begins from its exact account tombstone');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000014'),
  'Gate 1-bound unpaid Session account receives its permanent deletion fence');
select is((public.request_program_billing_account_deletion(current_setting('test.g4_bound_delete_tombstone_id')::uuid)->>'status'),
  'deletion_billing_fenced','direct account deletion requests cancellation of the bound unpaid Session');
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_bound_delete_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'Gate 1-bound unpaid checkout retention stays active during cancel_requested');
select set_config('test.g4_bound_delete_retention_events_before',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_bound_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
select set_config('test.g4_bound_delete_active_checkout_rows_before',(
  select count(*)::text from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_bound_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),true);
select set_config('test.g4_bound_delete_edge_count_before_terminal',(
  select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000014' and edge.relation_kind='assigned_member'),true);
select set_config('test.g4_bound_delete_billing_revision',(select revision::text from public.program_billing_orders
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),true);
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select throws_ok($$update public.program_order_state set billing_state='canceled',revision=revision+1
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid$$,
  '55000',null,'another buyer account no-op receipt cannot authorize this terminal transition');
select throws_ok($$update public.program_order_state set billing_state='awaiting_checkout',revision=revision+1
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid$$,
  '55000',null,'closing never reopens a checkout or cancel-requested order');
select set_config('test.g4_bound_delete_inventory',jsonb_build_object(
  'completeInventory',true,'orderId',current_setting('test.g4_bound_delete_order_id'),
  'customerId','cus_g4_bound_delete','customer',jsonb_build_object('id','cus_g4_bound_delete','deleted',false,'balance',0,
    'livemode',false,'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'discountId',null,'taxExempt','none','metadata',jsonb_build_object('program_order_id',current_setting('test.g4_bound_delete_order_id'),
      'program_billing_purpose','program_order','program_platform_account_id','acct_g4platform','program_livemode','false'),
    'invoiceCreditBalance',jsonb_build_object('usd',0)),
  'pendingInvoiceItemCount',0,'subscriptions','[]'::jsonb,'schedules','[]'::jsonb,
  'sessions',jsonb_build_array(jsonb_build_object('id','cs_g4_bound_delete','customerId','cus_g4_bound_delete','livemode',false,
    'providerScope',jsonb_build_object('platformAccountId','acct_g4platform','livemode',false),
    'paymentIntentId',null,'status','expired','paymentStatus','unpaid',
    'metadata',jsonb_build_object('program_order_id',current_setting('test.g4_bound_delete_order_id'),
      'program_checkout_attempt_id',current_setting('test.g4_bound_delete_attempt_id'),
      'program_platform_account_id','acct_g4platform','program_livemode','false'))),
  'paymentIntents','[]'::jsonb,'invoices','[]'::jsonb,'deletedInvoices','[]'::jsonb)::text,true);
reset role;
savepoint g4_bound_checkout_release_probe;
select ok((select private.stream_set_retention_obligation(obligation.registry_id,obligation.raw_provider_uid,
  'program_order',obligation.source_identity,obligation.source_revision,'checkout_intent',false,
  'f1000000-0000-0000-0000-000000000002','qa_checkout_retention_release_probe',
  'f9700000-0000-0000-0000-000000000014',repeat('7',64)) is not null
  from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_bound_delete_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='checkout_intent' and obligation.obligation_state='active'),
  'isolated savepoint releases the exact unpaid checkout obligation for a fail-closed probe');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select throws_ok($$select public.complete_program_billing_cancellation(current_setting('test.g4_bound_delete_order_id')::uuid,
  current_setting('test.g4_bound_delete_billing_revision')::bigint,
  current_setting('test.g4_bound_delete_inventory')::jsonb,repeat('4',64))$$,
  '55000',null,'closing fails closed when the exact unpaid checkout retention row was released');
reset role;
rollback to savepoint g4_bound_checkout_release_probe;
release savepoint g4_bound_checkout_release_probe;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_bound_delete_order_id')::uuid,
  current_setting('test.g4_bound_delete_billing_revision')::bigint,
  jsonb_set(current_setting('test.g4_bound_delete_inventory')::jsonb,'{sessions,0,status}','"open"'::jsonb),
  repeat('4',64))->>'status'),'provider_inventory_incomplete',
  'fresh open Session inventory cannot terminalize a bound deletion checkout');
reset role;
select is((select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'cancel_requested',
  'pending Session evidence leaves the Gate 1 cancellation state unchanged');
select is((select attempt_state from public.program_billing_checkout_attempts
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid and attempt_number=1),'open',
  'pending Session evidence leaves the attempt open');
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'reserved',
  'pending Session evidence leaves the exact promotion reserved');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_bound_delete_order_id')::uuid,
  current_setting('test.g4_bound_delete_billing_revision')::bigint,
  current_setting('test.g4_bound_delete_inventory')::jsonb,repeat('4',64))->>'status'),'canceled',
  'exact bound expired unpaid Session releases its promotion during deletion reconciliation');
reset role;
select is((select billing_state from public.program_order_state
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'closed',
  'legacy promotion release closes Gate 1 without a redundant canceled rewrite');
select is((select checkout_session_id from public.program_order_state
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'cs_g4_bound_delete',
  'closing preserves the exact original Session binding');
select is((select access_started_on from public.program_order_state
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),null::date,
  'expired unpaid Session cancellation does not create an access start date');
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),'released',
  'only the exact proven unpaid promotion is released');
select is((select obligation.obligation_state from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_bound_delete_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid' and obligation.obligation_kind='checkout_intent'),
  'released','bound unpaid checkout retention releases only after exact terminal Session proof');
select is((select count(*)::integer from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_bound_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_bound_delete_retention_events_before')::integer
    + current_setting('test.g4_bound_delete_active_checkout_rows_before')::integer,
  'Gate 1-bound terminal proof adds one release event for each active unpaid checkout obligation');
select set_config('test.g4_bound_delete_retention_events_terminal',(
  select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_bound_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),true);
select is((select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000014' and edge.relation_kind='assigned_member'),
  current_setting('test.g4_bound_delete_edge_count_before_terminal'),
  'bound-session closing preserves existing account edges without new closing edges');
select is((select count(*)::integer from public.program_payment_intent_claims
  where order_id=current_setting('test.g4_bound_delete_order_id')::uuid),0,
  'expired unpaid Session deletion never creates a PI claim');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.complete_program_billing_cancellation(current_setting('test.g4_bound_delete_order_id')::uuid,
  current_setting('test.g4_bound_delete_billing_revision')::bigint,
  current_setting('test.g4_bound_delete_inventory')::jsonb,repeat('4',64))->>'status'),'canceled',
  'exact receipt replays terminal completion without changing the closed Gate 1 state');
reset role;
select is((select count(*)::text from public.stream_media_retention_events event
  join public.stream_media_retention_obligations obligation on obligation.id=event.obligation_id
  where obligation.source_kind='program_order'
    and obligation.source_identity like current_setting('test.g4_bound_delete_order_id')||':%'
    and obligation.obligation_kind='checkout_intent'),
  current_setting('test.g4_bound_delete_retention_events_terminal'),
  'Gate 1-bound exact terminal replay creates no duplicate checkout release event');
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select is((public.finalize_stream_media_cleanup('f9500000-0000-0000-0000-000000000014',
  'f9800000-0000-0000-0000-000000000014',repeat('5',64))->>'outcome'),'account_cleanup_complete',
  'normal Gate 3 finalization closes the bound-session cleanup reservation after its terminal proof');
reset role;
select ok(exists(select 1 from public.stream_media_operation_states operation_state
  join public.stream_media_operation_uid_state uid_state on uid_state.operation_id=operation_state.operation_id
  where operation_state.operation_id='f9500000-0000-0000-0000-000000000014'
    and operation_state.operation_state in ('retained','completed')
    and uid_state.registry_id=current_setting('test.g4_media_registry_id')::uuid
    and uid_state.raw_provider_uid='g4-synthetic-retention-uid'
    and uid_state.uid_state in ('retained_attached','deleted_confirmed','already_absent_confirmed')),
  'bound-session deletion leaves the exact media UID in an accepted terminal cleanup state');

-- Zero-total access is durable history: deletion blocks mutation without
-- rewinding the grant or changing its original access date.
set local role service_role;
set local request.jwt.claim.role = 'service_role';
set local request.jwt.claims = '{}';
select set_config('test.g4_zero_total_order_id',public.create_program_order_reservation(
  'f1000000-0000-0000-0000-000000000015','f3000000-0000-0000-0000-000000000001',
  'f7000000-0000-0000-0000-000000000001',0::smallint,'g4-zero-total-delete-001','G4ZERO')::text,true);
reset role;
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_zero_total_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='zero_total_order' and obligation.obligation_state='active'),
  'zero-total order begins with active lesson retention');
select is((select effective_total_cents from public.program_orders
  where id=current_setting('test.g4_zero_total_order_id')::uuid),0,
  '100 percent promotion creates zero-total access without billing collection');
select ok((select state.billing_state='free_grant' and state.access_started_on is not null
    from public.program_order_state state where state.order_id=current_setting('test.g4_zero_total_order_id')::uuid),
  'zero-total order retains its exact historical access start');
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_zero_total_order_id')::uuid),'redeemed',
  'zero-total deletion retains the immutable redeemed promotion reservation');
select is((select count(*)::integer from public.program_promotion_redemptions
  where order_id=current_setting('test.g4_zero_total_order_id')::uuid),1,
  'zero-total deletion preserves the original redemption claim');
select set_config('test.g4_zero_total_tombstone_id','f9300000-0000-0000-0000-000000000015',true);
select set_config('test.g4_zero_total_request_id','f9400000-0000-0000-0000-000000000015',true);
set local role service_role;
select is((public.begin_stream_account_media_cleanup(current_setting('test.g4_zero_total_tombstone_id')::uuid,
  'f1000000-0000-0000-0000-000000000015',current_setting('test.g4_zero_total_request_id')::uuid,
  repeat('5',64),'f9500000-0000-0000-0000-000000000015',repeat('6',64))->>'outcome'),'reserved',
  'zero-total deletion also establishes its exact account tombstone');
select ok(public.lock_platform_membership_account_for_deletion('f1000000-0000-0000-0000-000000000015'),
  'zero-total deletion fences further membership writes');
reset role;
select set_config('test.g4_zero_total_edge_count_before_terminal',(
  select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000015' and edge.relation_kind='assigned_member'),true);
select throws_ok($$update public.program_order_state set access_started_on=access_started_on+1,revision=revision+1
  where order_id=current_setting('test.g4_zero_total_order_id')::uuid$$,
  '55000',null,'zero-total deletion cannot extend or rewrite the original access interval');
select ok((select state.billing_state='free_grant' and state.access_started_on is not null
    from public.program_order_state state where state.order_id=current_setting('test.g4_zero_total_order_id')::uuid),
  'zero-total order remains an unchanged historical grant with no new access date');
select is((select state from public.program_promotion_reservations
  where order_id=current_setting('test.g4_zero_total_order_id')::uuid),'redeemed',
  'deletion cannot release a zero-total promo redemption');
select ok(exists(select 1 from public.stream_media_retention_obligations obligation
  where obligation.source_kind='program_order'
    and obligation.source_identity=current_setting('test.g4_zero_total_order_id')||':'||
      (select lesson.id::text from public.program_content_version_lessons lesson where lesson.lesson_ordinal=1
        and lesson.content_version_id='f6000000-0000-0000-0000-000000000001')
    and obligation.raw_provider_uid='g4-synthetic-retention-uid'
    and obligation.obligation_kind='zero_total_order' and obligation.obligation_state='active'),
  'zero-total media retention and grant remain active after account fencing');
select is((select count(*)::text from public.stream_media_source_account_edges edge
  where edge.account_id='f1000000-0000-0000-0000-000000000015' and edge.relation_kind='assigned_member'),
  current_setting('test.g4_zero_total_edge_count_before_terminal'),
  'zero-total account fencing preserves its existing member media edge');
select throws_ok($$update public.program_billing_orders set account_tombstone_id='f9300000-0000-0000-0000-000000000015',
  revision=revision+1 where order_id=current_setting('test.g4_one_time_order_id')::uuid$$,
  '55000',null,'a different account tombstone cannot replace the billing row exact deletion identity');

select * from finish();
rollback;
