-- Account photos are private. Only the signed-in owner and admins can read the current path;
-- all mutations and private-storage signing happen after server-side account checks.
create table public.profile_photo_uploads (
  path text primary key,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  state text not null check (state in ('pending', 'active', 'retired')),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  expected_size integer not null check (expected_size between 1 and 5242880),
  created_at timestamptz not null default now(),
  unique (owner_id, path),
  check (
    path ~ ('^' || owner_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$')
  )
);

create unique index profile_photo_uploads_one_active_per_owner
  on public.profile_photo_uploads (owner_id) where state = 'active';

create table public.profile_photos (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  photo_path text not null,
  updated_at timestamptz not null default now(),
  foreign key (user_id, photo_path)
    references public.profile_photo_uploads (owner_id, path) on delete cascade
);

alter table public.profile_photo_uploads enable row level security;
alter table public.profile_photos enable row level security;

revoke all on public.profile_photo_uploads, public.profile_photos from public, anon, authenticated;
grant select on public.profile_photos to authenticated;
grant all on public.profile_photo_uploads, public.profile_photos to service_role;

create policy "People can read their own profile photo and admins can review them"
on public.profile_photos for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

create function public.register_profile_photo_upload(
  target_owner_id uuid,
  target_path text,
  target_content_type text,
  target_expected_size integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = target_owner_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  insert into public.profile_photo_uploads (path, owner_id, state, content_type, expected_size)
  values (target_path, target_owner_id, 'pending', target_content_type, target_expected_size);
end;
$$;

-- The profile-row lock serializes finalization with remove and account deletion. A path can move
-- from pending to active only once, and old paths remain tombstoned so a stale upload cannot
-- restore a replaced or removed photo.
create function public.commit_profile_photo_upload(target_owner_id uuid, target_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload_state text;
  previous_path text;
begin
  perform 1 from public.profiles where id = target_owner_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  select state into upload_state
  from public.profile_photo_uploads
  where owner_id = target_owner_id and path = target_path
  for update;
  if not found then
    raise exception 'Photo upload not found' using errcode = 'P0002';
  end if;

  if upload_state = 'active' then
    if exists (
      select 1 from public.profile_photos
      where user_id = target_owner_id and photo_path = target_path
    ) then
      return null;
    end if;
    raise exception 'Photo upload is no longer active' using errcode = 'P0001';
  end if;
  if upload_state <> 'pending' then
    raise exception 'Photo upload is no longer available' using errcode = 'P0001';
  end if;

  select photo_path into previous_path
  from public.profile_photos
  where user_id = target_owner_id
  for update;

  if previous_path is not null then
    update public.profile_photo_uploads
    set state = 'retired'
    where owner_id = target_owner_id and path = previous_path and state = 'active';
  end if;

  update public.profile_photo_uploads
  set state = 'active'
  where owner_id = target_owner_id and path = target_path and state = 'pending';
  if not found then
    raise exception 'Photo upload is no longer available' using errcode = 'P0001';
  end if;

  insert into public.profile_photos (user_id, photo_path, updated_at)
  values (target_owner_id, target_path, now())
  on conflict (user_id) do update
  set photo_path = excluded.photo_path, updated_at = excluded.updated_at;

  return previous_path;
end;
$$;

create function public.retire_profile_photo_upload(target_owner_id uuid, target_path text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = target_owner_id for update;
  if not found then
    return false;
  end if;

  update public.profile_photo_uploads
  set state = 'retired'
  where owner_id = target_owner_id and path = target_path and state = 'pending';
  return found;
end;
$$;

create function public.remove_profile_photo(target_owner_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_path text;
begin
  perform 1 from public.profiles where id = target_owner_id for update;
  if not found then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  -- Expire uploads that were prepared before Remove. Their paths stay reserved forever.
  update public.profile_photo_uploads
  set state = 'retired'
  where owner_id = target_owner_id and state = 'pending';

  select photo_path into previous_path
  from public.profile_photos
  where user_id = target_owner_id
  for update;

  if previous_path is not null then
    update public.profile_photo_uploads
    set state = 'retired'
    where owner_id = target_owner_id and path = previous_path and state = 'active';
  end if;

  delete from public.profile_photos where user_id = target_owner_id;
  return previous_path;
end;
$$;

revoke all on function public.register_profile_photo_upload(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.commit_profile_photo_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.retire_profile_photo_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.remove_profile_photo(uuid) from public, anon, authenticated;
grant execute on function public.register_profile_photo_upload(uuid, text, text, integer) to service_role;
grant execute on function public.commit_profile_photo_upload(uuid, text) to service_role;
grant execute on function public.retire_profile_photo_upload(uuid, text) to service_role;
grant execute on function public.remove_profile_photo(uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);
