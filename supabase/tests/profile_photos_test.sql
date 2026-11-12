begin;
select no_plan();

-- The test uses fixed identities so every assertion can run inside this rollback-only transaction.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'photos-admin@example.test', '{"display_name":"Photo Admin"}'),
  ('f1000000-0000-0000-0000-000000000002', 'photos-owner@example.test', '{"display_name":"Photo Owner"}'),
  ('f1000000-0000-0000-0000-000000000003', 'photos-other@example.test', '{"display_name":"Photo Other"}'),
  ('f1000000-0000-0000-0000-000000000004', 'photos-coach@example.test', '{"display_name":"Photo Coach"}'),
  ('f1000000-0000-0000-0000-000000000005', 'photos-moderator@example.test', '{"display_name":"Photo Moderator"}');
update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-000000000001';
update public.profiles set role = 'coach' where id = 'f1000000-0000-0000-0000-000000000004';
update public.profiles set role = 'moderator' where id = 'f1000000-0000-0000-0000-000000000005';

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profile_photos'::regclass)
    and (select relrowsecurity from pg_class where oid = 'public.profile_photo_uploads'::regclass),
  'photo tables have row level security enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.profile_photos', 'SELECT')
    and not has_table_privilege('authenticated', 'public.profile_photos', 'INSERT')
    and not has_table_privilege('authenticated', 'public.profile_photos', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.profile_photos', 'DELETE'),
  'authenticated users can select photos but have no direct photo DML grants'
);
select ok(
  not has_table_privilege('authenticated', 'public.profile_photo_uploads', 'SELECT')
    and not has_table_privilege('authenticated', 'public.profile_photo_uploads', 'INSERT')
    and not has_table_privilege('authenticated', 'public.profile_photo_uploads', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.profile_photo_uploads', 'DELETE'),
  'authenticated users have no direct upload metadata access'
);
select ok(
  has_table_privilege('service_role', 'public.profile_photos', 'SELECT,INSERT,UPDATE,DELETE')
    and has_table_privilege('service_role', 'public.profile_photo_uploads', 'SELECT,INSERT,UPDATE,DELETE'),
  'the service role has the table access required by the server actions'
);
select ok(
  not has_function_privilege('anon', 'public.register_profile_photo_upload(uuid,text,text,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.register_profile_photo_upload(uuid,text,text,integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.commit_profile_photo_upload(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.commit_profile_photo_upload(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.retire_profile_photo_upload(uuid,text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.retire_profile_photo_upload(uuid,text)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.remove_profile_photo(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.remove_profile_photo(uuid)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.register_profile_photo_upload(uuid,text,text,integer)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.commit_profile_photo_upload(uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.retire_profile_photo_upload(uuid,text)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.remove_profile_photo(uuid)', 'EXECUTE'),
  'only the service role can execute photo lifecycle RPCs'
);

-- Register/commit one photo for each of two owners through the only permitted mutation path.
set local role service_role;
select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg',
    'image/jpeg', 2048)$$,
  'the service can register a valid owner-bound upload'
);
select ok(
  public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg'
  ) is null,
  'the first commit has no previous path to clean up'
);
select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000003/20000000-0000-0000-0000-000000000001.png',
    'image/png', 3072)$$,
  'the service can register a second owner upload'
);
select ok(
  public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000003/20000000-0000-0000-0000-000000000001.png'
  ) is null,
  'a second owner can activate an independent photo'
);

-- Each owner sees one current path; coaches and moderators receive no special visibility.
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.profile_photos), 1, 'an owner sees their own photo');
select is(
  (select photo_path from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'),
  'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg',
  'the owner sees their current storage path'
);
select is(
  (select count(*)::int from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000003'),
  0,
  'an owner cannot read another member photo'
);
select throws_ok(
  $$insert into public.profile_photos (user_id, photo_path)
    values ('f1000000-0000-0000-0000-000000000002', 'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000001.webp')$$,
  '42501', null, 'a member cannot insert a photo row directly'
);
select throws_ok(
  $$update public.profile_photos set photo_path = 'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000001.webp'$$,
  '42501', null, 'a member cannot update a photo row directly'
);
select throws_ok(
  $$delete from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'a member cannot delete a photo row directly'
);
select throws_ok(
  'select * from public.profile_photo_uploads',
  '42501', null, 'a member cannot read upload metadata'
);
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000001.webp',
    'image/webp', 2048)$$,
  '42501', null, 'a member cannot execute the upload registration RPC'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.profile_photos), 1, 'another member sees only their own photo');
select is(
  (select count(*)::int from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'),
  0,
  'another member cannot read the first owner photo'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.profile_photos), 0, 'a coach cannot read member photos');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.profile_photos), 0, 'a moderator cannot read member photos');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.profile_photos), 2, 'an admin can review every current photo');
select throws_ok(
  $$insert into public.profile_photos (user_id, photo_path)
    values ('f1000000-0000-0000-0000-000000000001', 'f1000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.webp')$$,
  '42501', null, 'an admin still cannot insert photo rows directly'
);
select throws_ok(
  $$update public.profile_photos set photo_path = 'f1000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001.webp'$$,
  '42501', null, 'an admin still cannot update photo rows directly'
);
select throws_ok(
  $$delete from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'an admin still cannot delete photo rows directly'
);
select throws_ok(
  $$update public.profiles set role = 'admin' where id = 'f1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'a signed-in user cannot change their own role'
);
select throws_ok(
  $$select public.remove_profile_photo('f1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'an admin cannot invoke a service-only removal RPC'
);
reset role;

set local role anon;
select throws_ok('select * from public.profile_photos', '42501', null, 'anonymous visitors cannot read profile photos');
reset role;

-- The path check ties every object name to its owner; the composite foreign key independently
-- prevents a profile from pointing at a different owner's registered path.
set local role service_role;
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000003/30000000-0000-0000-0000-000000000001.jpg',
    'image/jpeg', 2048)$$,
  '23514', null, 'registration rejects a path rooted at another owner'
);
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'not-a-owner-path.jpg', 'image/jpeg', 2048)$$,
  '23514', null, 'registration rejects malformed object paths'
);
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000001.gif',
    'image/gif', 2048)$$,
  '23514', null, 'registration rejects unapproved content types'
);
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000002.jpg',
    'image/jpeg', 0)$$,
  '23514', null, 'registration rejects empty uploads'
);
select throws_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/30000000-0000-0000-0000-000000000003.jpg',
    'image/jpeg', 5242881)$$,
  '23514', null, 'registration rejects uploads larger than 5 MB'
);
select throws_ok(
  $$insert into public.profile_photos (user_id, photo_path)
    values ('f1000000-0000-0000-0000-000000000004', 'f1000000-0000-0000-0000-000000000003/20000000-0000-0000-0000-000000000001.png')$$,
  '23503', null, 'the composite foreign key rejects another owner path'
);
select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000003/20000000-0000-0000-0000-000000000002.png',
    'image/png', 1024)$$,
  'a second upload can remain pending for the same owner'
);
select throws_ok(
  $$update public.profile_photo_uploads set state = 'active'
    where owner_id = 'f1000000-0000-0000-0000-000000000003'$$,
  '23505', null, 'the partial unique index permits only one active photo per owner'
);
reset role;

-- The bucket remains private, size-limited, MIME-limited, and has no storage.objects policy.
select is((select public from storage.buckets where id = 'profile-photos'), false, 'the photo bucket is private');
select is((select file_size_limit from storage.buckets where id = 'profile-photos'), 5242880::bigint, 'the bucket caps uploads at 5 MB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'profile-photos'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'the bucket accepts only JPEG, PNG, and WebP'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)
    and not exists (
      select 1 from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
    ),
  'storage objects use RLS with no read or write policies'
);
set local role service_role;
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'profile-photos',
  'f1000000-0000-0000-0000-000000000002/40000000-0000-0000-0000-000000000001.jpg',
  'f1000000-0000-0000-0000-000000000002',
  '{"mimetype":"image/jpeg","size":1024}'::jsonb
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos'),
  0,
  'even the object owner cannot read private bucket objects through the Data API'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('profile-photos', 'f1000000-0000-0000-0000-000000000002/direct.jpg', 'f1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'authenticated users cannot write directly to the photo bucket'
);
with changed as (
  update storage.objects set metadata = '{"mimetype":"image/png","size":2}'::jsonb
  where bucket_id = 'profile-photos' returning 1
)
select is(
  (select count(*)::int from changed),
  0,
  'authenticated users cannot update photo bucket objects'
);
select throws_ok(
  $$delete from storage.objects where bucket_id = 'profile-photos'$$,
  '42501', null, 'authenticated users cannot delete photo bucket objects'
);
reset role;

-- Replacement retires the previous path before activating the new one. The active commit is
-- idempotent, while a retired path cannot be replayed to restore an older photo.
set local role service_role;
select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp',
    'image/webp', 4096)$$,
  'a replacement can be prepared before commit'
);
select is(
  public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp'
  ),
  'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg',
  'replacement returns the previous path for cleanup'
);
select is(
  (select state from public.profile_photo_uploads
    where path = 'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg'),
  'retired', 'replacement retires the old upload'
);
select is(
  (select photo_path from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'),
  'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp',
  'replacement atomically points the profile at the new path'
);
select ok(
  public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp'
  ) is null,
  'committing the current active upload again is idempotent'
);
select throws_ok(
  $$select public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/10000000-0000-0000-0000-000000000001.jpg')$$,
  'P0001', 'Photo upload is no longer available', 'a retired path cannot be replayed'
);
select is(
  (select photo_path from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'),
  'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp',
  'a rejected replay leaves the current photo unchanged'
);

select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000001.jpg',
    'image/jpeg', 512)$$,
  'an upload can be retired before commit'
);
select is(
  public.retire_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000001.jpg'
  ),
  true, 'retiring a pending upload succeeds'
);
select throws_ok(
  $$select public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000001.jpg')$$,
  'P0001', 'Photo upload is no longer available', 'a retired pending upload cannot be committed'
);
select is(
  public.retire_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/60000000-0000-0000-0000-000000000001.jpg'
  ),
  false, 'retiring the same upload again reports no change'
);

select lives_ok(
  $$select public.register_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/70000000-0000-0000-0000-000000000001.png',
    'image/png', 1536)$$,
  'a pending upload can exist while the current photo is active'
);
select is(
  public.remove_profile_photo('f1000000-0000-0000-0000-000000000002'),
  'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp',
  'remove returns the active path for storage cleanup'
);
select is(
  (select count(*)::int from public.profile_photos where user_id = 'f1000000-0000-0000-0000-000000000002'),
  0, 'remove clears the current profile photo row'
);
select is(
  (select state from public.profile_photo_uploads
    where path = 'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp'),
  'retired', 'remove retires the former active path'
);
select is(
  (select state from public.profile_photo_uploads
    where path = 'f1000000-0000-0000-0000-000000000002/70000000-0000-0000-0000-000000000001.png'),
  'retired', 'remove invalidates uploads that were pending before removal'
);
select throws_ok(
  $$select public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/70000000-0000-0000-0000-000000000001.png')$$,
  'P0001', 'Photo upload is no longer available', 'a pre-remove pending upload cannot restore the photo'
);
select ok(
  public.remove_profile_photo('f1000000-0000-0000-0000-000000000002') is null,
  'removing an already empty profile is idempotent'
);
select throws_ok(
  $$select public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp')$$,
  'P0001', 'Photo upload is no longer available', 'a path retired by remove cannot be replayed'
);
select throws_ok(
  $$select public.commit_profile_photo_upload(
    'f1000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000002/50000000-0000-0000-0000-000000000001.webp')$$,
  'P0002', 'Photo upload not found', 'one owner cannot finalize another owner upload'
);

-- Keep the foundation regression close to this feature: ordinary users cannot grant themselves
-- admin, and the established last-admin guard still rejects an admin demotion.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$select public.admin_set_user_role('f1000000-0000-0000-0000-000000000001', 'member')$$,
  'P0001', 'GYMX2 must keep at least one admin', 'the last admin still cannot be demoted'
);
reset role;

select * from finish();
rollback;
