-- Private one-on-one live sessions use a distinct provider input for each participant.
-- Provider identifiers and cleanup leases are deliberately kept outside participant-readable rows.

alter table public.calendar_sessions
  add column live_mode text not null default 'broadcast'
  check (live_mode in ('broadcast', 'one_on_one'));

create table public.private_session_grants (
  grant_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  generation bigint not null check (generation > 0),
  chosen_member_id uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'offered'
    check (state in ('offered', 'accepted', 'live', 'revoking', 'revoked')),
  member_camera_allowed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  coach_live_at timestamptz,
  member_live_at timestamptz,
  revoking_at timestamptz,
  revoked_at timestamptz,
  unique (session_id, generation),
  check ((state in ('revoking', 'revoked')) or revoking_at is null),
  check ((state = 'revoked') or revoked_at is null)
);

-- Private video stays disabled until the application cleanup worker proves it is running.
-- The singleton is updated only by the authenticated cleanup route after a full successful batch.
create table public.private_live_runtime (
  id boolean primary key default true check (id),
  cloudflare_account_id text check (
    cloudflare_account_id is null or cloudflare_account_id ~ '^[0-9a-f]{32}$'
  ),
  last_cleanup_at timestamptz
);
insert into public.private_live_runtime (id, cloudflare_account_id, last_cleanup_at)
values (true, null, null);
alter table public.private_live_runtime enable row level security;
revoke all on public.private_live_runtime from public, anon, authenticated, service_role;

create unique index private_session_grants_one_active_per_session
  on public.private_session_grants (session_id)
  where state in ('offered', 'accepted', 'live', 'revoking');
create index private_session_grants_expiry_idx
  on public.private_session_grants (expires_at, session_id)
  where state in ('offered', 'accepted', 'live');

-- There is one current row per direction. It has no FK to sessions, profiles, or grants: provider
-- teardown must remain possible after those rows are deleted by account/session cascades.
create table public.private_live_provider_state (
  session_id uuid not null,
  grant_id uuid not null,
  generation bigint not null check (generation > 0),
  direction text not null check (direction in ('coach', 'member')),
  provider_tag text not null,
  state text not null
    check (state in ('provisioning', 'ready', 'live', 'cleanup_pending', 'revoked')),
  input_uid text unique check (input_uid is null or char_length(input_uid) between 1 and 64),
  playback_id text check (playback_id is null or char_length(playback_id) between 1 and 128),
  provision_actor_id uuid,
  provision_lease_token uuid,
  provision_lease_expires_at timestamptz,
  cleanup_requested_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (session_id, generation, direction),
  unique (grant_id, direction),
  unique (provider_tag),
  check (
    (state = 'provisioning'
      and provision_actor_id is not null
      and provision_lease_token is not null
      and provision_lease_expires_at is not null)
    or state <> 'provisioning'
  )
);
create index private_live_provider_state_cleanup_idx
  on public.private_live_provider_state (state, provision_lease_expires_at, session_id)
  where state in ('provisioning', 'cleanup_pending');

-- Cleanup jobs have no FKs and are not deleted with a session/account. A NULL input_uid asks the
-- worker to reconcile by provider_tag after an expired provisioning lease.
create table public.private_live_cleanup_jobs (
  cleanup_id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  grant_id uuid not null,
  generation bigint not null check (generation > 0),
  direction text not null check (direction in ('coach', 'member')),
  provider_tag text not null,
  input_uid text check (input_uid is null or char_length(input_uid) between 1 and 64),
  reason text not null check (char_length(reason) between 1 and 80),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'complete')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((state = 'claimed') = (lease_token is not null and lease_expires_at is not null)),
  check ((state = 'complete') = (completed_at is not null))
);
create unique index private_live_cleanup_uid_active_idx
  on public.private_live_cleanup_jobs (input_uid)
  where input_uid is not null and state in ('pending', 'claimed');
create unique index private_live_cleanup_reconcile_active_idx
  on public.private_live_cleanup_jobs (session_id, generation, direction)
  where input_uid is null and state in ('pending', 'claimed');
create index private_live_cleanup_batch_idx
  on public.private_live_cleanup_jobs (available_at, queued_at, cleanup_id)
  where state in ('pending', 'claimed');

create function public.private_live_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.private_live_runtime r
    where r.id is true
      and r.cloudflare_account_id is not null
      and r.last_cleanup_at >= now() - interval '3 minutes'
      and r.last_cleanup_at <= now()
  );
$$;

create function public.record_private_live_cleanup_heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.private_live_runtime;
begin
  select * into runtime_row
  from public.private_live_runtime
  where id is true
  for update;
  if not found then
    raise exception 'Private live runtime row is missing' using errcode = 'P0001';
  end if;

  if runtime_row.cloudflare_account_id is null then
    raise exception 'Private live provider account is not bound' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.private_live_cleanup_jobs j
    where j.state <> 'complete'
  ) then
    raise exception 'Private live cleanup queue is not empty' using errcode = 'P0001';
  end if;

  update public.private_live_runtime set last_cleanup_at = now() where id is true;
end;
$$;

revoke all on function public.private_live_ready() from public, anon, authenticated, service_role;
revoke all on function public.record_private_live_cleanup_heartbeat()
  from public, anon, authenticated, service_role;
grant execute on function public.private_live_ready() to service_role;
grant execute on function public.record_private_live_cleanup_heartbeat() to service_role;

create function public.bind_private_live_account(target_account_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.private_live_runtime;
  normalized_account_id text := lower(target_account_id);
begin
  if normalized_account_id !~ '^[0-9a-f]{32}$' then
    raise exception 'Invalid Cloudflare account ID' using errcode = '22023';
  end if;

  select * into runtime_row
  from public.private_live_runtime
  where id is true
  for update;
  if not found then
    raise exception 'Private live runtime row is missing' using errcode = 'P0001';
  end if;

  if runtime_row.cloudflare_account_id is not null then
    return runtime_row.cloudflare_account_id = normalized_account_id;
  end if;

  if exists (
    select 1 from public.private_session_grants g where g.state <> 'revoked'
  ) or exists (
    select 1 from public.private_live_provider_state p where p.state <> 'revoked'
  ) or exists (
    select 1 from public.private_live_cleanup_jobs j where j.state <> 'complete'
  ) then
    return false;
  end if;

  update public.private_live_runtime
  set cloudflare_account_id = normalized_account_id
  where id is true and cloudflare_account_id is null;
  return found;
end;
$$;

create function public.private_live_account_matches(target_account_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    target_account_id ~* '^[0-9a-f]{32}$'
    and exists (
      select 1 from public.private_live_runtime r
      where r.id is true and r.cloudflare_account_id = lower(target_account_id)
    ),
    false
  );
$$;

revoke all on function public.bind_private_live_account(text) from public, anon, authenticated;
revoke all on function public.private_live_account_matches(text) from public, anon, authenticated;
grant execute on function public.bind_private_live_account(text) to service_role;
grant execute on function public.private_live_account_matches(text) to service_role;

alter table public.private_session_grants enable row level security;
alter table public.private_live_provider_state enable row level security;
alter table public.private_live_cleanup_jobs enable row level security;

revoke all on public.private_session_grants, public.private_live_provider_state,
  public.private_live_cleanup_jobs from public, anon, authenticated, service_role;
grant select on public.private_session_grants to authenticated;

create function private.can_read_private_session_grant(target_grant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where g.grant_id = target_grant_id
      and (s.coach_id = (select auth.uid()) or g.chosen_member_id = (select auth.uid()))
  );
$$;

create policy "Private grants are visible to the coach and chosen member"
on public.private_session_grants for select to authenticated
using ((select private.can_read_private_session_grant(grant_id)));

revoke all on function private.can_read_private_session_grant(uuid) from public, anon;
grant execute on function private.can_read_private_session_grant(uuid) to authenticated;

create function private.private_pair_is_current(
  target_session_id uuid,
  target_grant_id uuid,
  target_generation bigint,
  target_actor_id uuid,
  require_live boolean,
  require_live_window boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendar_sessions s
    join public.private_session_grants g
      on g.session_id = s.id
    join public.profiles coach_profile
      on coach_profile.id = s.coach_id and coach_profile.role::text = 'coach'
    join public.profiles member_profile
      on member_profile.id = g.chosen_member_id and member_profile.role::text = 'member'
    where s.id = target_session_id
      and s.live_mode = 'one_on_one'
      and g.grant_id = target_grant_id
      and g.generation = target_generation
      and g.state in ('accepted', 'live')
      and (not require_live or g.state = 'live')
      and g.expires_at > now()
      and (s.coach_id = target_actor_id or g.chosen_member_id = target_actor_id)
      and (select count(*) from public.session_invites i where i.session_id = s.id) = 1
      and exists (
        select 1 from public.session_invites i
        where i.session_id = s.id
          and i.member_id = g.chosen_member_id
      )
      and (
        not require_live_window
        or now() between s.starts_at - interval '30 minutes' and s.ends_at + interval '60 minutes'
      )
  );
$$;

revoke all on function private.private_pair_is_current(uuid, uuid, bigint, uuid, boolean, boolean)
  from public, anon, authenticated;

create function private.private_session_has_blockers(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1 from public.private_session_grants g
      where g.session_id = target_session_id and g.state <> 'revoked'
    )
    or exists (
      select 1 from public.private_live_provider_state p
      where p.session_id = target_session_id and p.state <> 'revoked'
    )
    or exists (
      select 1 from public.private_live_cleanup_jobs j
      where j.session_id = target_session_id and j.state <> 'complete'
    );
$$;
revoke all on function private.private_session_has_blockers(uuid) from public, anon, authenticated;

create function private.enqueue_private_live_cleanup(
  target_session_id uuid,
  target_grant_id uuid,
  target_generation bigint,
  target_direction text,
  target_provider_tag text,
  target_input_uid text,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.private_live_runtime where id is true for update;
  insert into public.private_live_cleanup_jobs (
    session_id, grant_id, generation, direction, provider_tag, input_uid, reason
  ) values (
    target_session_id, target_grant_id, target_generation, target_direction,
    target_provider_tag, target_input_uid, target_reason
  )
  on conflict do nothing;
end;
$$;
revoke all on function private.enqueue_private_live_cleanup(uuid, uuid, bigint, text, text, text, text)
  from public, anon, authenticated;

create function private.maybe_finalize_private_grant(target_session_id uuid, target_generation bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.private_session_grants g
  set state = 'revoked', revoked_at = coalesce(revoked_at, now()),
      coach_live_at = null, member_live_at = null
  where g.session_id = target_session_id
    and g.generation = target_generation
    and g.state = 'revoking'
    and not exists (
      select 1 from public.private_live_provider_state p
      where p.session_id = target_session_id
        and p.generation = target_generation
        and p.state <> 'revoked'
    )
    and not exists (
      select 1 from public.private_live_cleanup_jobs j
      where j.session_id = target_session_id
        and j.generation = target_generation
        and j.state <> 'complete'
    );
end;
$$;
revoke all on function private.maybe_finalize_private_grant(uuid, bigint) from public, anon, authenticated;

create function private.revoke_private_generation(
  target_session_id uuid,
  target_grant_id uuid,
  target_generation bigint,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_row record;
begin
  perform 1 from public.calendar_sessions
  where id = target_session_id
  for update;
  perform 1 from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
    and generation = target_generation
  for update;

  update public.private_session_grants
  set state = 'revoking', revoking_at = coalesce(revoking_at, now()),
      coach_live_at = null, member_live_at = null, member_camera_allowed = false
  where session_id = target_session_id
    and grant_id = target_grant_id
    and generation = target_generation
    and state <> 'revoked';

  for provider_row in
    select direction, provider_tag, input_uid, state, provision_lease_expires_at
    from public.private_live_provider_state
    where session_id = target_session_id and generation = target_generation
    for update
  loop
    if provider_row.input_uid is not null and provider_row.state <> 'revoked' then
      update public.private_live_provider_state
      set state = 'cleanup_pending', cleanup_requested_at = coalesce(cleanup_requested_at, now()),
          updated_at = now()
      where session_id = target_session_id and generation = target_generation
        and direction = provider_row.direction;
      perform private.enqueue_private_live_cleanup(
        target_session_id, target_grant_id, target_generation, provider_row.direction,
        provider_row.provider_tag, provider_row.input_uid, target_reason
      );
    elsif provider_row.state = 'provisioning'
      and provider_row.provision_lease_expires_at <= now() then
      update public.private_live_provider_state
      set state = 'cleanup_pending', cleanup_requested_at = coalesce(cleanup_requested_at, now()),
          updated_at = now()
      where session_id = target_session_id and generation = target_generation
        and direction = provider_row.direction;
      perform private.enqueue_private_live_cleanup(
        target_session_id, target_grant_id, target_generation, provider_row.direction,
        provider_row.provider_tag, null, target_reason || '_reconcile'
      );
    else
      update public.private_live_provider_state
      set cleanup_requested_at = coalesce(cleanup_requested_at, now()), updated_at = now()
      where session_id = target_session_id and generation = target_generation
        and direction = provider_row.direction;
    end if;
  end loop;

  perform private.maybe_finalize_private_grant(target_session_id, target_generation);
end;
$$;
revoke all on function private.revoke_private_generation(uuid, uuid, bigint, text)
  from public, anon, authenticated;

create function private.enqueue_private_session_cleanup(target_session_id uuid, target_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row record;
begin
  for grant_row in
    select grant_id, generation
    from public.private_session_grants
    where session_id = target_session_id and state <> 'revoked'
  loop
    perform private.revoke_private_generation(
      target_session_id, grant_row.grant_id, grant_row.generation, target_reason
    );
  end loop;

  -- Defensive cleanup for a provider row whose grant was already removed.
  for grant_row in
    select grant_id, generation, direction, provider_tag, input_uid, state,
           provision_lease_expires_at
    from public.private_live_provider_state
    where session_id = target_session_id and state <> 'revoked'
    for update
  loop
    if grant_row.input_uid is not null then
      update public.private_live_provider_state
      set state = 'cleanup_pending', cleanup_requested_at = coalesce(cleanup_requested_at, now()),
          updated_at = now()
      where session_id = target_session_id and generation = grant_row.generation
        and direction = grant_row.direction;
      perform private.enqueue_private_live_cleanup(
        target_session_id, grant_row.grant_id, grant_row.generation, grant_row.direction,
        grant_row.provider_tag, grant_row.input_uid, target_reason
      );
    elsif grant_row.state = 'provisioning'
      and grant_row.provision_lease_expires_at <= now() then
      update public.private_live_provider_state
      set state = 'cleanup_pending', cleanup_requested_at = coalesce(cleanup_requested_at, now()),
          updated_at = now()
      where session_id = target_session_id and generation = grant_row.generation
        and direction = grant_row.direction;
      perform private.enqueue_private_live_cleanup(
        target_session_id, grant_row.grant_id, grant_row.generation, grant_row.direction,
        grant_row.provider_tag, null, target_reason || '_reconcile'
      );
    end if;
  end loop;
end;
$$;
revoke all on function private.enqueue_private_session_cleanup(uuid, text)
  from public, anon, authenticated;

create function private.cleanup_private_sessions_for_actor(target_actor_id uuid, target_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row record;
begin
  for grant_row in
    select g.session_id, g.grant_id, g.generation
    from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where g.state <> 'revoked'
      and (s.coach_id = target_actor_id or g.chosen_member_id = target_actor_id)
  loop
    perform private.revoke_private_generation(
      grant_row.session_id, grant_row.grant_id, grant_row.generation, target_reason
    );
  end loop;
end;
$$;
revoke all on function private.cleanup_private_sessions_for_actor(uuid, text)
  from public, anon, authenticated;

create function private.profiles_cleanup_private_sessions_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.cleanup_private_sessions_for_actor(old.id, 'profile_deleted');
  return old;
end;
$$;

create function private.profiles_cleanup_private_sessions_after_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from new.role then
    perform private.cleanup_private_sessions_for_actor(new.id, 'profile_role_changed');
  end if;
  return new;
end;
$$;

create function private.calendar_sessions_cleanup_private_live_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.enqueue_private_session_cleanup(old.id, 'session_deleted');
  return old;
end;
$$;

create function private.coach_members_cleanup_private_live_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row record;
begin
  for grant_row in
    select g.session_id, g.grant_id, g.generation
    from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where s.coach_id = old.coach_id
      and g.chosen_member_id = old.member_id
      and g.state <> 'revoked'
  loop
    perform private.revoke_private_generation(
      grant_row.session_id, grant_row.grant_id, grant_row.generation, 'coach_member_link_removed'
    );
  end loop;
  return old;
end;
$$;

create trigger profiles_cleanup_private_sessions_before_delete
before delete on public.profiles
for each row execute function private.profiles_cleanup_private_sessions_before_delete();
create trigger profiles_cleanup_private_sessions_after_role_change
after update of role on public.profiles
for each row execute function private.profiles_cleanup_private_sessions_after_role_change();
create trigger calendar_sessions_cleanup_private_live_before_delete
before delete on public.calendar_sessions
for each row execute function private.calendar_sessions_cleanup_private_live_before_delete();
create trigger coach_members_cleanup_private_live_before_delete
before delete on public.coach_members
for each row execute function private.coach_members_cleanup_private_live_before_delete();

create function private.guard_private_session_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.live_mode is distinct from old.live_mode
    and (select auth.uid()) is distinct from old.coach_id then
    raise exception 'Only the session coach can change live mode' using errcode = '42501';
  end if;

  if new.live_mode = 'one_on_one' and exists (
    select 1 from public.session_live where session_id = old.id
  ) then
    raise exception 'Remove the previous broadcast input before making this session private'
      using errcode = 'P0001';
  end if;

  if private.private_session_has_blockers(old.id)
    and (
      new.coach_id is distinct from old.coach_id
      or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at
      or new.live_mode is distinct from old.live_mode
    ) then
    raise exception 'Private live access must be revoked and provider cleanup confirmed first'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger calendar_sessions_private_live_guard
before update of coach_id, starts_at, ends_at, live_mode on public.calendar_sessions
for each row execute function private.guard_private_session_updates();

create function private.guard_private_session_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_session_id uuid;
  target_member_id uuid;
  session_coach_id uuid;
  session_id_to_lock uuid;
begin
  if tg_op = 'DELETE' then
    target_session_id := old.session_id;
    target_member_id := old.member_id;
  else
    target_session_id := new.session_id;
    target_member_id := new.member_id;
  end if;

  if tg_op = 'UPDATE' then
    for session_id_to_lock in
      select s.id
      from public.calendar_sessions s
      where s.id in (old.session_id, new.session_id)
      order by s.id
      for update
    loop
      null;
    end loop;
  else
    perform 1 from public.calendar_sessions
    where id = target_session_id
    for update;
  end if;

  if tg_op = 'UPDATE'
    and (private.private_session_has_blockers(old.session_id)
      or private.private_session_has_blockers(new.session_id)) then
    if new.session_id is distinct from old.session_id
      or new.member_id is distinct from old.member_id then
      raise exception 'Private session invites cannot change until provider cleanup is confirmed'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  select coach_id into session_coach_id
  from public.calendar_sessions
  where id = target_session_id and live_mode = 'one_on_one';
  if not found or not private.private_session_has_blockers(target_session_id) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  -- Account deletion or a role change has already revoked the grant and queued cleanup, allowing
  -- the cascaded invite deletion to complete without removing a live participant's invite.
  if tg_op = 'DELETE'
    and (
      not exists (select 1 from public.profiles p where p.id = target_member_id)
      or not exists (
        select 1 from public.profiles p
        where p.id = target_member_id and p.role::text = 'member'
      )
      or not exists (
        select 1 from public.profiles p
        where p.id = session_coach_id and p.role::text = 'coach'
      )
      or (
        not exists (
          select 1 from public.coach_members cm
          where cm.coach_id = session_coach_id and cm.member_id = target_member_id
        )
        and not exists (
          select 1 from public.private_session_grants g
          where g.session_id = target_session_id
            and g.chosen_member_id = target_member_id
            and g.state in ('offered', 'accepted', 'live')
        )
      )
    ) then
    return old;
  end if;

  raise exception 'Private session invites cannot change until provider cleanup is confirmed'
    using errcode = 'P0001';
end;
$$;
create trigger session_invites_private_live_guard
before insert or update or delete on public.session_invites
for each row execute function private.guard_private_session_invites();

create function private.guard_private_session_live_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.calendar_sessions
  where id = new.session_id
  for update;
  if exists (
    select 1 from public.calendar_sessions s
    where s.id = new.session_id and s.live_mode = 'one_on_one'
  ) then
    raise exception 'Private sessions use private provider state, not session_live'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger session_live_private_mode_guard
before insert or update on public.session_live
for each row execute function private.guard_private_session_live_rows();

create function private.can_read_session_live(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_sessions s
    where s.id = target_session_id
      and s.live_mode = 'broadcast'
      and ((select private.in_session(s.id)) or (select private.is_admin()))
  ) or exists (
    select 1
    from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where g.session_id = target_session_id
      and s.live_mode = 'one_on_one'
      and g.state in ('accepted', 'live')
      and g.expires_at > now()
      and (
        s.coach_id = (select auth.uid())
        or g.chosen_member_id = (select auth.uid())
      )
      and (select count(*) from public.session_invites i where i.session_id = s.id) = 1
      and exists (
        select 1 from public.session_invites i
        where i.session_id = s.id
          and i.member_id = g.chosen_member_id
      )
      and exists (
        select 1 from public.profiles p where p.id = s.coach_id and p.role::text = 'coach'
      )
      and exists (
        select 1 from public.profiles p where p.id = g.chosen_member_id and p.role::text = 'member'
      )
  );
$$;
revoke all on function private.can_read_session_live(uuid) from public, anon;
grant execute on function private.can_read_session_live(uuid) to authenticated;

drop policy "Session people and admins see the live room" on public.session_live;
create policy "Session people and admins see the live room"
on public.session_live for select to authenticated
using ((select private.can_read_session_live(session_id)));

create or replace function private.session_is_live(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.session_live l
    join public.calendar_sessions s on s.id = l.session_id
    where l.session_id = target_session_id
      and s.live_mode = 'broadcast'
      and l.live_started_at is not null
      and l.live_ended_at is null
  ) or exists (
    select 1 from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where g.session_id = target_session_id
      and s.live_mode = 'one_on_one'
      and g.state = 'live'
      and g.coach_live_at is not null
      and g.expires_at > now()
      and (select public.private_live_ready())
  );
$$;
revoke all on function private.session_is_live(uuid) from public, anon;
grant execute on function private.session_is_live(uuid) to authenticated;

create function public.set_session_live_mode(
  target_session_id uuid,
  target_mode text,
  target_member_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_row public.calendar_sessions;
  current_grant public.private_session_grants;
  invite_count integer;
  chosen_count integer;
  next_generation bigint;
  new_grant_id uuid;
begin
  if caller is null or not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if target_mode not in ('broadcast', 'one_on_one') then
    raise exception 'Choose broadcast or one_on_one mode' using errcode = '22023';
  end if;

  select * into session_row
  from public.calendar_sessions
  where id = target_session_id and coach_id = caller
  for update;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;

  if target_mode = 'broadcast' then
    if target_member_id is not null then
      raise exception 'Broadcast sessions do not have a chosen member' using errcode = '22023';
    end if;
    if session_row.live_mode = 'one_on_one' and private.private_session_has_blockers(target_session_id) then
      raise exception 'Private provider cleanup must be confirmed before switching to broadcast'
        using errcode = 'P0001';
    end if;
    update public.calendar_sessions set live_mode = 'broadcast' where id = target_session_id;
    return null;
  end if;

  if not public.private_live_ready() then
    raise exception 'Private live cleanup is not ready' using errcode = 'P0001';
  end if;

  if target_member_id is null then
    raise exception 'Choose the invited member for a private session' using errcode = '22023';
  end if;
  if session_row.ends_at + interval '60 minutes' <= now() then
    raise exception 'The session live window has ended' using errcode = 'P0001';
  end if;

  -- Expired offers that never started provisioning can be retired without provider cleanup.
  update public.private_session_grants g
  set state = 'revoked', revoked_at = now()
  where g.session_id = target_session_id
    and g.state in ('offered', 'accepted')
    and g.expires_at <= now()
    and not exists (
      select 1 from public.private_live_provider_state p
      where p.session_id = g.session_id and p.generation = g.generation
    )
    and not exists (
      select 1 from public.private_live_cleanup_jobs j
      where j.session_id = g.session_id and j.generation = g.generation
    );

  if session_row.live_mode = 'broadcast'
    and exists (select 1 from public.session_live where session_id = target_session_id) then
    raise exception 'Remove the previous broadcast input before making this session private'
      using errcode = 'P0001';
  end if;

  if private.private_session_has_blockers(target_session_id) then
    select * into current_grant
    from public.private_session_grants g
    where g.session_id = target_session_id
      and g.state in ('offered', 'accepted', 'live')
      and g.expires_at > now()
    for update;
    if found and current_grant.chosen_member_id = target_member_id then
      return current_grant.grant_id;
    end if;
    raise exception 'Private provider cleanup must be confirmed before a new grant'
      using errcode = 'P0001';
  end if;

  select count(*)::integer,
         count(*) filter (where i.member_id = target_member_id)::integer
  into invite_count, chosen_count
  from public.session_invites i
  where i.session_id = target_session_id;
  if invite_count <> 1 or chosen_count <> 1 then
    raise exception 'A private session needs exactly one invitation for the chosen member'
      using errcode = 'P0001';
  end if;
  if not private.has_role(target_member_id, 'member') then
    raise exception 'The chosen invitee must currently be a member'
      using errcode = 'P0001';
  end if;

  update public.calendar_sessions
  set live_mode = 'one_on_one'
  where id = target_session_id and live_mode is distinct from 'one_on_one';

  select greatest(
    coalesce((select max(generation) from public.private_session_grants
      where session_id = target_session_id), 0),
    coalesce((select max(generation) from public.private_live_provider_state
      where session_id = target_session_id), 0),
    coalesce((select max(generation) from public.private_live_cleanup_jobs
      where session_id = target_session_id), 0)
  ) + 1 into next_generation;
  insert into public.private_session_grants (
    session_id, generation, chosen_member_id, state, expires_at
  ) values (
    target_session_id, next_generation, target_member_id, 'offered',
    session_row.ends_at + interval '60 minutes'
  ) returning grant_id into new_grant_id;
  return new_grant_id;
end;
$$;

create function public.accept_private_session_grant(
  target_session_id uuid,
  target_grant_id uuid,
  allow_member_camera boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  grant_row public.private_session_grants;
  session_row public.calendar_sessions;
  invite_count integer;
begin
  select * into session_row
  from public.calendar_sessions
  where id = target_session_id
  for update;
  if not found then
    raise exception 'Private session not found' using errcode = 'P0002';
  end if;
  select * into grant_row
  from public.private_session_grants g
  where g.session_id = target_session_id and g.grant_id = target_grant_id
  for update;
  if not found or caller is distinct from grant_row.chosen_member_id then
    raise exception 'Private session grant not found' using errcode = 'P0002';
  end if;
  if not public.private_live_ready() then
    raise exception 'Private live cleanup is not ready' using errcode = 'P0001';
  end if;

  select count(*)::integer into invite_count
  from public.session_invites where session_id = target_session_id;
  if session_row.live_mode <> 'one_on_one'
    or grant_row.expires_at <= now()
    or invite_count <> 1
    or not exists (
      select 1 from public.session_invites i
      where i.session_id = target_session_id and i.member_id = caller
    )
    or not private.has_role(caller, 'member')
    or not private.has_role(session_row.coach_id, 'coach')
    then
    raise exception 'This private session grant is no longer available' using errcode = 'P0001';
  end if;

  if grant_row.state = 'accepted' then
    if grant_row.member_camera_allowed is distinct from allow_member_camera then
      raise exception 'Revoke this grant before changing camera consent' using errcode = 'P0001';
    end if;
    return true;
  end if;
  if grant_row.state <> 'offered' then
    raise exception 'This private session grant is no longer available' using errcode = 'P0001';
  end if;

  update public.private_session_grants
  set state = 'accepted', accepted_at = now(), member_camera_allowed = allow_member_camera
  where grant_id = target_grant_id;
  return true;
end;
$$;

create function public.revoke_private_live_access(target_session_id uuid, target_grant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_row public.calendar_sessions;
  grant_row public.private_session_grants;
begin
  select * into session_row
  from public.calendar_sessions
  where id = target_session_id
  for update;
  select * into grant_row
  from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
  for update;
  if not found or caller is null then
    raise exception 'Private session grant not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.calendar_sessions s
    where s.id = target_session_id and s.coach_id = caller
  ) and caller <> grant_row.chosen_member_id then
    raise exception 'Private session grant not found' using errcode = 'P0002';
  end if;
  if grant_row.state = 'revoked' then
    return false;
  end if;

  perform private.revoke_private_generation(
    target_session_id, target_grant_id, grant_row.generation, 'participant_revoked'
  );
  return true;
end;
$$;

revoke all on function public.set_session_live_mode(uuid, text, uuid) from public, anon;
revoke all on function public.accept_private_session_grant(uuid, uuid, boolean) from public, anon;
revoke all on function public.revoke_private_live_access(uuid, uuid) from public, anon;
grant execute on function public.set_session_live_mode(uuid, text, uuid) to authenticated;
grant execute on function public.accept_private_session_grant(uuid, uuid, boolean) to authenticated;
grant execute on function public.revoke_private_live_access(uuid, uuid) to authenticated;

create function public.claim_private_live_provision(
  target_session_id uuid,
  target_grant_id uuid,
  actor_id uuid
)
returns table (
  session_id uuid,
  grant_id uuid,
  direction text,
  generation bigint,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_tag text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  grant_row public.private_session_grants;
  provider_row public.private_live_provider_state;
  chosen_direction text;
  new_lease_token uuid := gen_random_uuid();
  new_provider_tag text;
  pair_live_required boolean;
begin
  if not public.private_live_ready() then
    raise exception 'Private live cleanup is not ready' using errcode = 'P0001';
  end if;
  select * into session_row
  from public.calendar_sessions
  where id = target_session_id
  for update;
  if not found then
    raise exception 'Private session not found' using errcode = 'P0002';
  end if;
  select * into grant_row
  from public.private_session_grants g
  where g.session_id = target_session_id and g.grant_id = target_grant_id
  for update;
  if not found then
    raise exception 'Private session grant not found' using errcode = 'P0002';
  end if;

  if actor_id = session_row.coach_id then
    chosen_direction := 'coach';
    pair_live_required := false;
  elsif actor_id = grant_row.chosen_member_id then
    chosen_direction := 'member';
    pair_live_required := true;
    if not grant_row.member_camera_allowed then
      raise exception 'The member has not opted in to camera and microphone' using errcode = '42501';
    end if;
  else
    raise exception 'Private session actor is not a participant' using errcode = '42501';
  end if;

  if not private.private_pair_is_current(
    target_session_id, target_grant_id, grant_row.generation,
    actor_id, pair_live_required, true
  ) then
    raise exception 'Private session is outside its active live window or is no longer valid'
      using errcode = 'P0001';
  end if;
  if chosen_direction = 'member' and grant_row.state <> 'live' then
    raise exception 'The coach must start the private session before member camera access'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.private_live_cleanup_jobs j
    where j.session_id = target_session_id
      and j.generation = grant_row.generation
      and j.direction = chosen_direction
      and j.state <> 'complete'
  ) then
    raise exception 'Provider cleanup for this stream is still pending' using errcode = 'P0001';
  end if;

  new_provider_tag := format(
    'gymx2-private:%s:%s:%s', target_session_id, grant_row.generation, chosen_direction
  );
  insert into public.private_live_provider_state (
    session_id, grant_id, generation, direction, provider_tag, state,
    provision_actor_id, provision_lease_token, provision_lease_expires_at
  ) values (
    target_session_id, target_grant_id, grant_row.generation, chosen_direction,
    new_provider_tag, 'provisioning', actor_id, new_lease_token, now() + interval '90 seconds'
  )
  on conflict on constraint private_live_provider_state_pkey do update
  set grant_id = excluded.grant_id,
      provider_tag = excluded.provider_tag,
      state = 'provisioning',
      input_uid = null,
      playback_id = null,
      provision_actor_id = excluded.provision_actor_id,
      provision_lease_token = excluded.provision_lease_token,
      provision_lease_expires_at = excluded.provision_lease_expires_at,
      cleanup_requested_at = null,
      updated_at = now()
  where public.private_live_provider_state.state = 'provisioning'
    and public.private_live_provider_state.input_uid is null
    and public.private_live_provider_state.provision_lease_expires_at <= now()
  returning * into provider_row;
  if not found then
    raise exception 'This stream is already provisioned, being provisioned, or retired'
      using errcode = 'P0001';
  end if;

  return query select provider_row.session_id, provider_row.grant_id,
    provider_row.direction, provider_row.generation, provider_row.provision_lease_token,
    provider_row.provision_lease_expires_at, provider_row.provider_tag;
end;
$$;

create function public.complete_private_live_provision(
  target_session_id uuid,
  target_grant_id uuid,
  target_direction text,
  target_generation bigint,
  target_lease_token uuid,
  target_input_uid text,
  target_playback_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  grant_row public.private_session_grants;
  provider_row public.private_live_provider_state;
  pair_is_valid boolean := false;
  reason_value text := 'stale_provision_completion';
begin
  if target_direction not in ('coach', 'member')
    or coalesce(char_length(target_input_uid), 0) not between 1 and 64
    or coalesce(char_length(target_playback_id), 0) not between 1 and 128 then
    raise exception 'Invalid provider identifiers' using errcode = '22023';
  end if;

  -- Match the session -> grant -> provider lock order used by offer, accept, start and revoke.
  perform 1 from public.calendar_sessions where id = target_session_id for update;
  perform 1 from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
  for update;

  select * into provider_row
  from public.private_live_provider_state
  where session_id = target_session_id
    and generation = target_generation
    and direction = target_direction
  for update;

  if found and provider_row.provision_lease_token = target_lease_token
    and provider_row.state in ('ready', 'live')
    and provider_row.input_uid = target_input_uid then
    return public.private_live_ready() and private.private_pair_is_current(
      target_session_id, target_grant_id, target_generation,
      provider_row.provision_actor_id, target_direction = 'member', true
    );
  end if;

  if found and provider_row.provision_lease_token = target_lease_token
    and provider_row.state = 'cleanup_pending'
    and provider_row.input_uid = target_input_uid then
    return false;
  end if;

  if found and provider_row.grant_id = target_grant_id
    and provider_row.provision_lease_token = target_lease_token
    and provider_row.state = 'provisioning'
    and provider_row.provision_lease_expires_at > now()
    and public.private_live_ready()
    and private.private_pair_is_current(
      target_session_id, target_grant_id, target_generation,
      provider_row.provision_actor_id, target_direction = 'member', true
    ) then
    if target_direction = 'member' and not exists (
      select 1 from public.private_session_grants g
      where g.grant_id = target_grant_id and g.state = 'live' and g.member_camera_allowed
    ) then
      pair_is_valid := false;
    else
      pair_is_valid := true;
    end if;
  end if;

  if pair_is_valid then
    update public.private_live_provider_state
    set state = 'ready', input_uid = target_input_uid, playback_id = target_playback_id,
        updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and direction = target_direction and provision_lease_token = target_lease_token;
    return true;
  end if;

  if found and provider_row.grant_id = target_grant_id
    and provider_row.provision_lease_token = target_lease_token
    and provider_row.state = 'provisioning' then
    update public.private_live_provider_state
    set state = 'cleanup_pending', input_uid = target_input_uid, playback_id = target_playback_id,
        cleanup_requested_at = coalesce(cleanup_requested_at, now()), updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and direction = target_direction and provision_lease_token = target_lease_token;
    perform private.enqueue_private_live_cleanup(
      target_session_id, target_grant_id, target_generation, target_direction,
      provider_row.provider_tag, target_input_uid, reason_value
    );
    perform private.maybe_finalize_private_grant(target_session_id, target_generation);
    return false;
  end if;

  -- A provision response that lost the race with revoke, invite/role change, or a new lease is
  -- recorded only in the service-only cleanup queue. The caller receives no provider metadata.
  if found and provider_row.input_uid = target_input_uid
    and provider_row.state in ('ready', 'live', 'cleanup_pending') then
    return false;
  end if;
  if not found then
    provider_row.provider_tag := format(
      'gymx2-private:%s:%s:%s', target_session_id, target_generation, target_direction
    );
  end if;
  if found then
    provider_row.provider_tag := coalesce(provider_row.provider_tag, format(
      'gymx2-private:%s:%s:%s', target_session_id, target_generation, target_direction
    ));
  end if;
  perform private.enqueue_private_live_cleanup(
    target_session_id, target_grant_id, target_generation, target_direction,
    provider_row.provider_tag, target_input_uid, reason_value
  );
  perform private.maybe_finalize_private_grant(target_session_id, target_generation);
  return false;
end;
$$;

create function public.mark_private_live_started(
  target_session_id uuid,
  target_grant_id uuid,
  target_direction text,
  target_generation bigint,
  target_lease_token uuid,
  actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  provider_row public.private_live_provider_state;
  grant_row public.private_session_grants;
begin
  if target_direction not in ('coach', 'member') then
    raise exception 'Invalid stream direction' using errcode = '22023';
  end if;
  select * into session_row
  from public.calendar_sessions where id = target_session_id for update;
  if not found then
    return false;
  end if;
  select * into grant_row
  from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
    and generation = target_generation
  for update;
  if not found then
    return false;
  end if;
  if target_direction = 'member' and grant_row.state <> 'live' then
    return false;
  end if;
  if not private.private_pair_is_current(
    target_session_id, target_grant_id, target_generation,
    actor_id, target_direction = 'member', true
  ) then
    return false;
  end if;

  select * into provider_row
  from public.private_live_provider_state
  where session_id = target_session_id and grant_id = target_grant_id
    and generation = target_generation and direction = target_direction
  for update;
  if not found or provider_row.provision_actor_id is distinct from actor_id
    or provider_row.provision_lease_token is distinct from target_lease_token
    or provider_row.state not in ('ready', 'live')
    or not public.private_live_ready()
    or (provider_row.state = 'ready' and provider_row.provision_lease_expires_at <= now())
    or provider_row.input_uid is null then
    return false;
  end if;

  update public.private_live_provider_state
  set state = 'live', updated_at = now()
  where session_id = target_session_id and generation = target_generation
    and direction = target_direction;
  if target_direction = 'coach' then
    update public.private_session_grants
    set state = 'live', coach_live_at = coalesce(coach_live_at, now())
    where grant_id = target_grant_id and state in ('accepted', 'live');
  else
    update public.private_session_grants
    set member_live_at = coalesce(member_live_at, now())
    where grant_id = target_grant_id and state = 'live' and member_camera_allowed;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_private_live_provision(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_private_live_provision(uuid, uuid, text, bigint, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_private_live_started(uuid, uuid, text, bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_private_live_provision(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_private_live_provision(uuid, uuid, text, bigint, uuid, text, text)
  to service_role;
grant execute on function public.mark_private_live_started(uuid, uuid, text, bigint, uuid, uuid)
  to service_role;

create function public.authorize_private_live_publish(
  target_session_id uuid,
  target_grant_id uuid,
  target_generation bigint,
  actor_id uuid
)
returns table (input_uid text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  grant_row public.private_session_grants;
  provider_row public.private_live_provider_state;
  session_coach_id uuid;
  chosen_member_id uuid;
  chosen_direction text;
begin
  if not public.private_live_ready() then return; end if;
  select s.coach_id, g.chosen_member_id into session_coach_id, chosen_member_id
  from public.calendar_sessions s
  join public.private_session_grants g on g.session_id = s.id
  where s.id = target_session_id and g.grant_id = target_grant_id
    and g.generation = target_generation;
  if not found then return; end if;

  perform 1 from public.calendar_sessions where id = target_session_id for update;
  perform 1 from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
    and generation = target_generation
  for update;
  select s.coach_id, g.chosen_member_id into session_coach_id, chosen_member_id
  from public.calendar_sessions s
  join public.private_session_grants g on g.session_id = s.id
  where s.id = target_session_id and g.grant_id = target_grant_id
    and g.generation = target_generation;
  if not found then return; end if;

  if actor_id = session_coach_id then
    chosen_direction := 'coach';
  elsif actor_id = chosen_member_id then
    chosen_direction := 'member';
  else
    return;
  end if;
  if not private.private_pair_is_current(
    target_session_id, target_grant_id, target_generation, actor_id, true, true
  ) then
    return;
  end if;
  if chosen_direction = 'member' and not exists (
    select 1 from public.private_session_grants g
    where g.grant_id = target_grant_id and g.member_camera_allowed
  ) then
    return;
  end if;
  select p.* into provider_row
  from public.private_live_provider_state p
  where p.session_id = target_session_id
    and p.grant_id = target_grant_id
    and p.generation = target_generation
    and p.direction = chosen_direction
    and p.state = 'live'
    and p.input_uid is not null
  for update;
  if found then return query select provider_row.input_uid; end if;
end;
$$;

create function public.authorize_private_live_playback(
  target_session_id uuid,
  target_grant_id uuid,
  target_generation bigint,
  viewer_id uuid,
  target_source_direction text
)
returns table (playback_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_row public.private_live_provider_state;
  session_coach_id uuid;
  chosen_member_id uuid;
  member_camera_allowed boolean;
begin
  if not public.private_live_ready() then return; end if;
  if target_source_direction not in ('coach', 'member') then return; end if;
  select s.coach_id, g.chosen_member_id, g.member_camera_allowed
  into session_coach_id, chosen_member_id, member_camera_allowed
  from public.calendar_sessions s
  join public.private_session_grants g on g.session_id = s.id
  where s.id = target_session_id and g.grant_id = target_grant_id
    and g.generation = target_generation;
  if not found then return; end if;

  perform 1 from public.calendar_sessions where id = target_session_id for update;
  perform 1 from public.private_session_grants
  where session_id = target_session_id and grant_id = target_grant_id
    and generation = target_generation
  for update;
  select s.coach_id, g.chosen_member_id, g.member_camera_allowed
  into session_coach_id, chosen_member_id, member_camera_allowed
  from public.calendar_sessions s
  join public.private_session_grants g on g.session_id = s.id
  where s.id = target_session_id and g.grant_id = target_grant_id
    and g.generation = target_generation;
  if not found then return; end if;

  -- A member can view only the coach input. The coach can view only the chosen member input.
  if (viewer_id = chosen_member_id and target_source_direction <> 'coach')
    or (viewer_id = session_coach_id and target_source_direction <> 'member')
    or (viewer_id <> chosen_member_id and viewer_id <> session_coach_id)
    or (target_source_direction = 'member' and not member_camera_allowed) then
    return;
  end if;
  if not private.private_pair_is_current(
    target_session_id, target_grant_id, target_generation, viewer_id, true, true
  ) then
    return;
  end if;
  select p.* into provider_row
  from public.private_live_provider_state p
  where p.session_id = target_session_id
    and p.grant_id = target_grant_id
    and p.generation = target_generation
    and p.direction = target_source_direction
    and p.state = 'live'
    and p.playback_id is not null
  for update;
  if found then return query select provider_row.playback_id; end if;
end;
$$;

create function public.claim_private_live_cleanup_batch(
  target_account_id text,
  target_limit integer default 20
)
returns table (
  cleanup_id uuid,
  session_id uuid,
  grant_id uuid,
  generation bigint,
  direction text,
  lease_token uuid,
  input_uid text,
  provider_tag text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row record;
  provider_row record;
begin
  if target_limit < 1 or target_limit > 50 then
    raise exception 'Cleanup batch size must be between 1 and 50' using errcode = '22023';
  end if;
  if not public.private_live_account_matches(target_account_id) then
    raise exception 'Cleanup account does not match the bound provider account'
      using errcode = '42501';
  end if;

  -- Expired grants and expired provisioning leases become cleanup work, never a fresh credential.
  for grant_row in
    select g.session_id, g.grant_id, g.generation
    from public.private_session_grants g
    join public.calendar_sessions s on s.id = g.session_id
    where g.state in ('offered', 'accepted', 'live') and g.expires_at <= now()
    order by g.expires_at
    limit target_limit
    for update of s skip locked
  loop
    perform 1 from public.private_session_grants g
    where g.session_id = grant_row.session_id
      and g.grant_id = grant_row.grant_id
      and g.generation = grant_row.generation
      and g.state in ('offered', 'accepted', 'live')
      and g.expires_at <= now()
    for update skip locked;
    if found then
      perform private.revoke_private_generation(
        grant_row.session_id, grant_row.grant_id, grant_row.generation, 'grant_expired'
      );
    end if;
  end loop;

  for provider_row in
    select p.session_id, p.grant_id, p.generation, p.direction, p.provider_tag
    from public.private_live_provider_state p
    where p.state = 'provisioning'
      and p.input_uid is null
      and p.provision_lease_expires_at <= now()
    order by p.provision_lease_expires_at
    limit target_limit
  loop
    perform 1 from public.calendar_sessions s
    where s.id = provider_row.session_id
    for update;
    perform 1 from public.private_session_grants g
    where g.session_id = provider_row.session_id and g.grant_id = provider_row.grant_id
    for update;
    select p.* into provider_row
    from public.private_live_provider_state p
    where p.session_id = provider_row.session_id
      and p.grant_id = provider_row.grant_id
      and p.generation = provider_row.generation
      and p.direction = provider_row.direction
      and p.state = 'provisioning'
      and p.input_uid is null
      and p.provision_lease_expires_at <= now()
    for update skip locked;
    if found and exists (
      select 1 from public.private_session_grants g
      where g.grant_id = provider_row.grant_id and g.state <> 'revoked'
    ) then
      perform private.revoke_private_generation(
        provider_row.session_id, provider_row.grant_id,
        provider_row.generation, 'provision_lease_expired'
      );
    elsif found then
      update public.private_live_provider_state p
      set state = 'cleanup_pending', cleanup_requested_at = coalesce(cleanup_requested_at, now()),
          updated_at = now()
      where p.session_id = provider_row.session_id
        and p.generation = provider_row.generation and p.direction = provider_row.direction;
      perform private.enqueue_private_live_cleanup(
        provider_row.session_id, provider_row.grant_id, provider_row.generation,
        provider_row.direction, provider_row.provider_tag, null, 'orphan_reconcile'
      );
    end if;
  end loop;

  return query
  with due_jobs as (
    select j.cleanup_id
    from public.private_live_cleanup_jobs j
    where (j.state = 'pending' and j.available_at <= now())
       or (j.state = 'claimed' and j.lease_expires_at <= now())
    order by j.available_at, j.queued_at, j.cleanup_id
    limit target_limit
    for update skip locked
  ), claimed as (
    update public.private_live_cleanup_jobs j
    set state = 'claimed', attempts = attempts + 1,
        lease_token = gen_random_uuid(), lease_expires_at = now() + interval '2 minutes'
    from due_jobs d
    where j.cleanup_id = d.cleanup_id
    returning j.cleanup_id, j.session_id, j.grant_id, j.generation, j.direction,
      j.lease_token, j.input_uid, j.provider_tag
  )
  select c.cleanup_id, c.session_id, c.grant_id, c.generation, c.direction,
    c.lease_token, c.input_uid, c.provider_tag
  from claimed c;
end;
$$;

create function public.complete_private_live_cleanup(
  target_cleanup_id uuid,
  target_session_id uuid,
  target_generation bigint,
  target_direction text,
  target_lease_token uuid,
  provider_delete_confirmed boolean,
  target_account_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  provider_row public.private_live_provider_state;
  cleanup_row public.private_live_cleanup_jobs;
begin
  if not public.private_live_account_matches(target_account_id) then
    return false;
  end if;
  if target_direction not in ('coach', 'member') then
    raise exception 'Invalid stream direction' using errcode = '22023';
  end if;

  -- Discover the job first without a lock, then take locks in the shared session -> grant ->
  -- provider -> job order used by revocation. This avoids deadlocks with a concurrent revoke.
  select * into cleanup_row
  from public.private_live_cleanup_jobs
  where cleanup_id = target_cleanup_id
    and session_id = target_session_id
    and generation = target_generation
    and direction = target_direction
    and state = 'claimed'
    and lease_token = target_lease_token;
  if not found then return false; end if;

  perform 1 from public.calendar_sessions
  where id = target_session_id
  for update;
  perform 1 from public.private_session_grants
  where session_id = target_session_id and grant_id = cleanup_row.grant_id
  for update;
  perform 1 from public.private_live_provider_state
  where session_id = target_session_id
    and generation = target_generation
    and direction = target_direction
  for update;
  select * into cleanup_row
  from public.private_live_cleanup_jobs
  where cleanup_id = target_cleanup_id
    and session_id = target_session_id
    and generation = target_generation
    and direction = target_direction
    and state = 'claimed'
    and lease_token = target_lease_token
  for update;
  if not found then return false; end if;

  if not provider_delete_confirmed then
    update public.private_live_cleanup_jobs
    set state = 'pending', available_at = now() + interval '1 minute',
        lease_token = null, lease_expires_at = null
    where cleanup_id = cleanup_row.cleanup_id;
    return false;
  end if;

  update public.private_live_cleanup_jobs
  set state = 'complete', completed_at = now(), lease_token = null, lease_expires_at = null
  where cleanup_id = cleanup_row.cleanup_id;

  if cleanup_row.input_uid is null then
    update public.private_live_provider_state
    set state = 'revoked', input_uid = null, playback_id = null,
        provision_actor_id = null, provision_lease_token = null,
        provision_lease_expires_at = null, updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and direction = target_direction and provider_tag = cleanup_row.provider_tag
      and input_uid is null and state = 'cleanup_pending';
  else
    update public.private_live_provider_state
    set state = 'revoked', input_uid = null, playback_id = null,
        provision_actor_id = null, provision_lease_token = null,
        provision_lease_expires_at = null, updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and direction = target_direction and input_uid = cleanup_row.input_uid;
  end if;
  perform private.maybe_finalize_private_grant(target_session_id, target_generation);
  return true;
end;
$$;

revoke all on function public.authorize_private_live_publish(uuid, uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.authorize_private_live_playback(uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_private_live_cleanup_batch(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_private_live_cleanup(uuid, uuid, bigint, text, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.authorize_private_live_publish(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.authorize_private_live_playback(uuid, uuid, bigint, uuid, text) to service_role;
grant execute on function public.claim_private_live_cleanup_batch(text, integer) to service_role;
grant execute on function public.complete_private_live_cleanup(uuid, uuid, bigint, text, uuid, boolean, text)
  to service_role;
