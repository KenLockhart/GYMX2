begin;
select no_plan();

-- Synthetic fixtures only. No provider calls, live identities, or customer rows.
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1000000-0000-4000-8000-000000000001', 'printful-owner@example.test', '{"display_name":"Printful owner"}'),
  ('d1000000-0000-4000-8000-000000000002', 'printful-admin-b@example.test', '{"display_name":"Printful admin B"}');
update public.profiles set role = 'admin'
where id in ('d1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002');

create temporary table printful_test_context (
  session_id uuid,
  product_local_id uuid,
  reserved_item_id uuid,
  blue_local_id uuid,
  red_local_id uuid,
  full_catalog jsonb not null,
  one_variant jsonb not null,
  renamed_catalog jsonb not null
);
grant select on printful_test_context to authenticated, service_role;
insert into printful_test_context (full_catalog, one_variant, renamed_catalog)
select full_value,
  jsonb_set(jsonb_set(full_value, '{products,0,syncedVariantCount}', '1'::jsonb),
    '{products,0,variants}', jsonb_build_array(full_value #> '{products,0,variants,0}')),
  jsonb_set(jsonb_set(full_value, '{products,0,variants,1,color}', '"Green"'::jsonb),
    '{products,0,variants,1,name}', '"Green / M"'::jsonb)
from (
  select jsonb_build_object(
    'storeId','19050731','storeName','GYMX2','storeType','native',
    'completeness','consistent_paginated_read','atomicProviderSnapshotProven',false,
    'listTotal',1,'pageCount',1,'readStartedAt',now()-interval '10 minutes',
    'readCompletedAt',now()-interval '9 minutes','observedAt',now()-interval '9 minutes',
    'products',jsonb_build_array(jsonb_build_object(
      'syncProductId','7001','name','Synthetic Training Tee','ignored',false,'syncedVariantCount',2,
      'variants',jsonb_build_array(
        jsonb_build_object('syncVariantId','8001','externalId','synthetic-blue','catalogVariantId','9001',
          'name','Blue / M','color','Blue','size','M','synced',true,'ignored',false,'availabilityStatus','active',
          'configurationFingerprint',repeat('a',64),'configurationComplete',true,
          'placementTypes',jsonb_build_array('front'),'optionNames',jsonb_build_array('technique')),
        jsonb_build_object('syncVariantId','8002','externalId','synthetic-red','catalogVariantId','9002',
          'name','Red / M','color','Red','size','M','synced',true,'ignored',false,'availabilityStatus','active',
          'configurationFingerprint',repeat('b',64),'configurationComplete',true,
          'placementTypes',jsonb_build_array('front'),'optionNames',jsonb_build_array('technique'))
      )
    ))
  ) as full_value
) fixture;

select ok(
  not has_table_privilege('anon','private.printful_catalog_variants','SELECT')
  and not has_table_privilege('authenticated','private.printful_armory_drafts','SELECT')
  and not has_function_privilege('authenticated','public.import_printful_armory_preview(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.apply_printful_catalog_snapshot(bigint,jsonb)','EXECUTE'),
  'private provider data and import RPCs are isolated from members and guests'
);
select lives_ok(
  $$select public.apply_printful_catalog_snapshot(0,(select full_catalog from printful_test_context))$$,
  'a complete synthetic provider snapshot stages atomically'
);
select is((select revision from private.printful_catalog_sync_state where singleton),1::bigint,'first full stage increments revision');
select throws_ok(
  $$select public.apply_printful_catalog_snapshot(0,(select full_catalog from printful_test_context))$$,
  '40001',null,'stale catalog read is rejected before writes'
);
select is((select revision from private.printful_catalog_sync_state where singleton),1::bigint,'stale read leaves revision unchanged');

update printful_test_context
set session_id=public.begin_printful_ui_cost_review('d1000000-0000-4000-8000-000000000001'),
    product_local_id=(select p.id from private.printful_catalog_products p where p.external_product_id='7001');
update private.printful_cost_review_sessions set started_at=now()-interval '5 minutes'
where id=(select session_id from printful_test_context);
select is(
  public.apply_printful_catalog_snapshot(
    1,(with t as (select clock_timestamp() s,clock_timestamp()+interval '1 millisecond' c)
       select jsonb_set(jsonb_set(jsonb_set(full_catalog,'{readStartedAt}',to_jsonb(t.s)),
         '{readCompletedAt}',to_jsonb(t.c)),'{observedAt}',to_jsonb(t.c))
       from printful_test_context cross join t)
  ),2::bigint,'a fresh complete read commits after the UI review observation'
);
select is(
  public.apply_printful_ui_cost_evidence(
    (select session_id from printful_test_context),'d1000000-0000-4000-8000-000000000001',2,
    jsonb_build_object('source','official_printful_ui_edit_retail_prices','storeId','19050731',
      'currency','USD','currencyContext','USD account preferences','observedAt',now()-interval '1 minute',
      'readOnly',true,'priceChangesSaved',false,'products',jsonb_build_array(jsonb_build_object(
        'syncProductId','7001','selectedSyncVariantIds',jsonb_build_array('8001','8002'),
        'priceRows',jsonb_build_array(
          jsonb_build_object('externalId','synthetic-blue','printfulPrice','$12.00'),
          jsonb_build_object('externalId','synthetic-red','printfulPrice','$14.00'))))),
    jsonb_build_array(
      jsonb_build_object('syncProductId','7001','syncVariantId','8001','externalId','synthetic-blue','catalogVariantId','9001',
        'productionCostMinCents',1200,'productionCostMaxCents',1200,'currency','USD','source','admin-reviewed-printful-ui',
        'observedAt',now()-interval '1 minute','configurationFingerprint',repeat('a',64),'evidenceSha256',repeat('c',64)),
      jsonb_build_object('syncProductId','7001','syncVariantId','8002','externalId','synthetic-red','catalogVariantId','9002',
        'productionCostMinCents',1400,'productionCostMaxCents',1400,'currency','USD','source','admin-reviewed-printful-ui',
        'observedAt',now()-interval '1 minute','configurationFingerprint',repeat('b',64),'evidenceSha256',repeat('c',64))),
    repeat('c',64)
  ),2,'positive SQL evidence application maps exact external IDs to variants'
);
select is(
  (select array_agg(production_cost_min_cents order by external_variant_id)
   from private.printful_catalog_variants where product_id=(select product_local_id from printful_test_context)),
  array[1200,1400]::integer[],'exact USD cost observations are saved without retail-price derivation'
);
select throws_ok(
  $$select public.apply_printful_ui_cost_evidence((select session_id from printful_test_context),
    'd1000000-0000-4000-8000-000000000001',2,'{}'::jsonb,'[]'::jsonb,repeat('c',64))$$,
  'P0001',null,'completed cost-review evidence is immutable'
);

update printful_test_context
set reserved_item_id=public.import_printful_armory_preview(product_local_id,'d1000000-0000-4000-8000-000000000001'),
    blue_local_id=(select id from private.printful_catalog_variants where external_variant_id='8001'),
    red_local_id=(select id from private.printful_catalog_variants where external_variant_id='8002');
select is((select price_cents from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context)),
  3400,'private draft customer price starts at max exact cost plus twenty dollars');
select is((select shipping_cents from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context)),
  0,'private draft defaults to free customer shipping');
select ok(
  not exists(select 1 from public.armory_items where id=(select reserved_item_id from printful_test_context))
  and (select image_path is null and published_at is null from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context)),
  'import creates only a private image-less draft, never an Armory row'
);
select is(public.import_printful_armory_preview((select product_local_id from printful_test_context),'d1000000-0000-4000-8000-000000000001'),
  (select reserved_item_id from printful_test_context),'repeated import reuses the reserved UUID and draft');
select is(public.get_printful_armory_draft_upload_owner((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002'),
  'd1000000-0000-4000-8000-000000000001'::uuid,'another admin resolves the authoritative upload owner');

-- Seed an ordinary row as the migration/test owner; authenticated callers only have
-- narrow column grants, so the reserved-ID guard below is also exercised with the
-- service role that backs application RPC writes.
insert into public.armory_items(id,coach_id,kind,category,title,price_cents,buy_url)
values('d1000000-0000-4000-8000-000000000099','d1000000-0000-4000-8000-000000000002','link','gear','Ordinary link',1000,'https://example.test/item');

set local role authenticated;
set local request.jwt.claims='{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select item_id from private.printful_armory_drafts$$,'42501',null,'members cannot read private draft tables');
select throws_ok(
  $$insert into public.armory_items(id,coach_id,kind,category,title,price_cents,visible_to_all,sizes,shipping_cents)
    values((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002','preview','gear','Bypass',3400,true,array['Blue / M'],0)$$,
  '42501',null,'direct authenticated preview insertion cannot claim an unpublished reserved UUID'
);
select throws_ok(
  $$insert into public.armory_items(id,coach_id,kind,category,title,price_cents,visible_to_all,sizes,shipping_cents)
    values((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002','product','gear','Bypass',3400,true,array['Blue / M'],0)$$,
  '42501',null,'direct insertion cannot make a reserved UUID sellable'
);
reset role;
select throws_ok($$update public.armory_items set id=(select reserved_item_id from printful_test_context)
  where id='d1000000-0000-4000-8000-000000000099'$$,'23514',null,'ordinary rows cannot move onto a reserved UUID');

select throws_ok($$select public.publish_printful_armory_preview((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002')$$,
  'P0001',null,'publishing requires a saved image and curation');
select ok(not exists(select 1 from public.armory_items where id=(select reserved_item_id from printful_test_context))
  and not exists(select 1 from private.printful_armory_write_permits where item_id=(select reserved_item_id from printful_test_context)),
  'failed publication leaves no row or write permit');

select is(public.apply_printful_catalog_snapshot(
  2,(with t as (select clock_timestamp() s,clock_timestamp()+interval '1 millisecond' c)
     select jsonb_set(jsonb_set(jsonb_set(one_variant,'{readStartedAt}',to_jsonb(t.s)),
       '{readCompletedAt}',to_jsonb(t.c)),'{observedAt}',to_jsonb(t.c))
     from printful_test_context cross join t)),3::bigint,'complete read can omit a temporarily unavailable variant');
select ok((select not available and availability_status='missing' and id=(select red_local_id from printful_test_context)
  from private.printful_catalog_variants where external_variant_id='8002'),'omitted variant remains unavailable under its stable UUID');
select is(public.apply_printful_catalog_snapshot(
  3,(with t as (select clock_timestamp() s,clock_timestamp()+interval '1 millisecond' c)
     select jsonb_set(jsonb_set(jsonb_set(full_catalog,'{readStartedAt}',to_jsonb(t.s)),
       '{readCompletedAt}',to_jsonb(t.c)),'{observedAt}',to_jsonb(t.c))
     from printful_test_context cross join t)),4::bigint,'restock read reuses the existing provider variant identity');
select ok((select available and id=(select red_local_id from printful_test_context)
  from private.printful_catalog_variants where external_variant_id='8002'),'returning variant reuses its local UUID');
select is(public.apply_printful_catalog_snapshot(
  4,(with t as (select clock_timestamp() s,clock_timestamp()+interval '1 millisecond' c)
     select jsonb_set(jsonb_set(jsonb_set(renamed_catalog,'{readStartedAt}',to_jsonb(t.s)),
       '{readCompletedAt}',to_jsonb(t.c)),'{observedAt}',to_jsonb(t.c))
     from printful_test_context cross join t)),5::bigint,'provider label refresh commits before publish');

select is(public.update_printful_armory_preview(
  (select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002',
  'Reviewed Training Tee','Approved synthetic description','d1000000-0000-4000-8000-000000000001/tee.webp',3844,600,true),
  true,'another admin can curate without changing the original owner');
select throws_ok($$select public.update_printful_armory_preview(
  (select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002',
  'Wrong owner image','Approved synthetic description','d1000000-0000-4000-8000-000000000002/tee.webp',3844,600,true)$$,
  '22023',null,'draft cannot claim an image uploaded under another owner');
select lives_ok($query$do $force$
  begin
    begin
      perform public.publish_printful_armory_preview((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002');
      raise exception 'synthetic failure after publish';
    exception when others then
      if sqlerrm <> 'synthetic failure after publish' then raise; end if;
    end;
  end
$force$;$query$,'a downstream failure rolls back publish row, state, and write permit');
select ok(not exists(select 1 from public.armory_items where id=(select reserved_item_id from printful_test_context))
  and (select published_at is null from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context))
  and not exists(select 1 from private.printful_armory_write_permits where item_id=(select reserved_item_id from printful_test_context)),
  'forced publish failure leaves the draft private and permit-free');
select is(public.publish_printful_armory_preview((select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002'),
  (select reserved_item_id from printful_test_context),'explicit publish creates the Gear preview under its draft owner');
select ok((select coach_id='d1000000-0000-4000-8000-000000000001'::uuid and kind='preview' and category='gear'
  and visible_to_all and price_cents=3844 and shipping_cents=600 and not made_to_order
  and delivery_min_weeks is null and delivery_max_weeks is null and sizes=array['Blue / M','Green / M']::text[]
  and printful_sku is null and printful_sync_variant_id is null and printful_variant_mappings='[]'::jsonb
  from public.armory_items where id=(select reserved_item_id from printful_test_context)),
  'publish recomputes current labels, preserves curation and omits provider IDs');
select throws_ok($$select public.update_printful_armory_preview(
  (select reserved_item_id from printful_test_context),'d1000000-0000-4000-8000-000000000002',
  'Reviewed Training Tee','Approved synthetic description',null,3844,600,true)$$,
  'P0001',null,'published preview cannot be saved without an image');
select throws_ok($$update public.armory_items set kind='product' where id=(select reserved_item_id from printful_test_context)$$,
  '23514',null,'a managed preview cannot be converted by direct SQL');
select throws_ok($$insert into public.armory_checkout_intents(item_id)
  select reserved_item_id from printful_test_context$$,'23514',null,'checkout-intent trigger blocks managed identity');
select is(public.create_armory_checkout_intent(
  'd2000000-0000-4000-8000-000000000001',(select reserved_item_id from printful_test_context),null,'buyer@example.test','en',null,3844,
  (select updated_at from public.armory_items where id=(select reserved_item_id from printful_test_context)),3844,0,'Reviewed Training Tee','preview','gear',null,null),
  false,'central checkout RPC rejects a managed display-only preview');
select is((select count(*)::int from public.armory_checkout_intents where id='d2000000-0000-4000-8000-000000000001'),
  0,'rejected preview checkout creates no intent');

insert into private.printful_cost_review_sessions(reviewer_id,base_revision,review_snapshot)
values('d1000000-0000-4000-8000-000000000001',5,private.printful_catalog_snapshot_json());
delete from auth.users where id='d1000000-0000-4000-8000-000000000001';
select ok(not exists(select 1 from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context))
  and not exists(select 1 from public.armory_items where id=(select reserved_item_id from printful_test_context))
  and exists(select 1 from private.printful_managed_items where item_id=(select reserved_item_id from printful_test_context)),
  'owner deletion removes private/public rows but leaves the permanent origin tombstone');
select is((select count(*)::int from private.printful_cost_review_sessions
  where reviewer_id='d1000000-0000-4000-8000-000000000001' and completed_at is null),0,'owner deletion removes unfinished review sessions');
select is((select count(*)::int from private.printful_cost_review_sessions
  where reviewer_id='d1000000-0000-4000-8000-000000000001' and completed_at is not null),1,'completed cost audit survives reviewer deletion');
select is(public.import_printful_armory_preview((select product_local_id from printful_test_context),'d1000000-0000-4000-8000-000000000002'),
  (select reserved_item_id from printful_test_context),'new admin reuses tombstone only as a fresh private draft');
select ok((select owner_id='d1000000-0000-4000-8000-000000000002'::uuid and image_path is null and published_at is null
  from private.printful_armory_drafts where item_id=(select reserved_item_id from printful_test_context))
  and not exists(select 1 from public.armory_items where id=(select reserved_item_id from printful_test_context)),
  'reimport after deletion does not restore old publication or curation');

select * from finish();
rollback;
