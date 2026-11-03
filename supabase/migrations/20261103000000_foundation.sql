-- GYMX2 foundation: profiles, roles and the admin operations that manage them.
-- A user's role can only change through admin_set_user_role, never from the client.

create type public.user_role as enum ('member', 'coach', 'admin');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'member',
  display_name text not null check (char_length(display_name) between 1 and 80),
  bio text not null default '' check (char_length(bio) <= 1000),
  coach_requested boolean not null default false,
  instagram_url text check (instagram_url ~ '^https://'),
  tiktok_url text check (tiktok_url ~ '^https://'),
  youtube_url text check (youtube_url ~ '^https://'),
  x_url text check (x_url ~ '^https://'),
  website_url text check (website_url ~ '^https://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Sign-up metadata is client-supplied, so it can request coach status but never set a role.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
begin
  insert into public.profiles (id, display_name, coach_requested)
  values (
    new.id,
    coalesce(nullif(requested_name, ''), 'New member'),
    coalesce(new.raw_user_meta_data ->> 'coach_requested', '') = 'true'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Signed-in users can read coach profiles"
on public.profiles for select to authenticated
using (role = 'coach');

create policy "Admins can read all profiles"
on public.profiles for select to authenticated
using ((select public.is_admin()));

create policy "Users can update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Column grants keep role out of reach even for a user updating their own row.
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant update (
  display_name,
  bio,
  coach_requested,
  instagram_url,
  tiktok_url,
  youtube_url,
  x_url,
  website_url
) on public.profiles to authenticated;

create function public.admin_list_users()
returns table (
  id uuid,
  email text,
  display_name text,
  role public.user_role,
  coach_requested boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select p.id, u.email::text, p.display_name, p.role, p.coach_requested, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.id
  order by p.coach_requested desc, p.created_at desc;
end;
$$;

create function public.admin_set_user_role(target_user_id uuid, new_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_role_value public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  -- Lock every admin row so two simultaneous demotions can't remove the last admin.
  perform 1 from public.profiles where role = 'admin' for update;

  select role into current_role_value
  from public.profiles
  where id = target_user_id
  for update;

  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if current_role_value = 'admin' and new_role <> 'admin'
    and (select count(*) from public.profiles where role = 'admin') = 1 then
    raise exception 'GYMX2 must keep at least one admin' using errcode = 'P0001';
  end if;

  update public.profiles
  set role = new_role, coach_requested = false
  where id = target_user_id;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_list_users() from public, anon;
revoke all on function public.admin_set_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_set_user_role(uuid, public.user_role) to authenticated;
