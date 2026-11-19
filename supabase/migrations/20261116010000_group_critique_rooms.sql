-- Group critique rooms use Cloudflare RealtimeKit and remain separate from the
-- existing public broadcast row and private one-on-one provider lifecycle.

create table public.group_critique_rooms (
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  generation bigint not null check (generation > 0),
  state text not null default 'provisioning'
    check (state in ('provisioning', 'open', 'ending', 'ended')),
  created_by uuid not null,
  join_expires_at timestamptz not null,
  all_members_muted boolean not null default false,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  ended_at timestamptz,
  primary key (session_id, generation),
  check ((state = 'ended') = (ended_at is not null))
);
create unique index group_critique_rooms_one_active_per_session_idx
  on public.group_critique_rooms (session_id)
  where state in ('provisioning', 'open', 'ending');

-- No profile FK: role/account deletion must leave a revocation marker until the provider confirms
-- removal. This table contains consent only for the member themself and the coach's roster view.
create table public.group_critique_members (
  session_id uuid not null,
  generation bigint not null,
  member_id uuid not null,
  membership_state text not null default 'eligible'
    check (membership_state in ('eligible', 'removing', 'removed')),
  offered_at timestamptz,
  camera_allowed boolean not null default false,
  microphone_allowed boolean not null default false,
  participant_epoch bigint not null default 0 check (participant_epoch >= 0),
  coach_muted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, generation, member_id),
  foreign key (session_id, generation)
    references public.group_critique_rooms (session_id, generation) on delete cascade
);
create index group_critique_members_member_idx
  on public.group_critique_members (member_id, session_id, generation);

-- This runtime is intentionally independent of private_live_runtime. A group cleanup failure
-- must not disable the already-shipped one-on-one feature, and vice versa.
create table public.group_critique_runtime (
  id boolean primary key default true check (id),
  cloudflare_account_id text check (
    cloudflare_account_id is null or cloudflare_account_id ~ '^[0-9a-f]{32}$'
  ),
  realtimekit_app_id text check (
    realtimekit_app_id is null or char_length(realtimekit_app_id) between 1 and 128
  ),
  last_cleanup_at timestamptz,
  check ((cloudflare_account_id is null) = (realtimekit_app_id is null))
);
insert into public.group_critique_runtime (id) values (true);

-- Provider identifiers are not participant-readable and intentionally have no FKs. Teardown
-- jobs must survive session/profile cascades.
create table public.group_critique_provider_rooms (
  session_id uuid not null,
  generation bigint not null check (generation > 0),
  provider_meeting_id text check (
    provider_meeting_id is null or char_length(provider_meeting_id) between 1 and 128
  ),
  state text not null check (state in ('provisioning', 'ready', 'ending', 'removed')),
  provision_lease_token uuid,
  provision_lease_expires_at timestamptz,
  idempotency_key uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (session_id, generation),
  unique (provider_meeting_id),
  check (
    (state = 'provisioning' and provision_lease_token is not null
      and provision_lease_expires_at is not null)
    or state <> 'provisioning'
  ),
  check (state <> 'ready' or provider_meeting_id is not null)
);
create index group_critique_provider_rooms_cleanup_idx
  on public.group_critique_provider_rooms (state, provision_lease_expires_at, session_id)
  where state in ('provisioning', 'ending');

create table public.group_critique_provider_participants (
  session_id uuid not null,
  generation bigint not null check (generation > 0),
  actor_id uuid not null,
  actor_kind text not null check (actor_kind in ('coach', 'member')),
  provider_participant_id text check (
    provider_participant_id is null or char_length(provider_participant_id) between 1 and 128
  ),
  state text not null check (state in ('provisioning', 'ready', 'remove_pending', 'removed')),
  preset text not null check (preset in ('host', 'can_request', 'not_allowed')),
  participant_epoch bigint not null default 0 check (participant_epoch >= 0),
  provision_lease_token uuid,
  provision_lease_expires_at timestamptz,
  idempotency_key uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default now(),
  primary key (session_id, generation, actor_id),
  unique (provider_participant_id),
  check (
    (state = 'provisioning' and provision_lease_token is not null
      and provision_lease_expires_at is not null)
    or state <> 'provisioning'
  ),
  check (state <> 'ready' or provider_participant_id is not null)
);
create index group_critique_provider_participants_cleanup_idx
  on public.group_critique_provider_participants (state, provision_lease_expires_at, session_id)
  where state in ('provisioning', 'remove_pending');

create table public.group_critique_cleanup_jobs (
  job_id uuid primary key default gen_random_uuid(),
  session_id uuid not null,
  generation bigint not null check (generation > 0),
  actor_id uuid,
  provider_account_id text not null check (provider_account_id ~ '^[0-9a-f]{32}$'),
  realtimekit_app_id text not null check (char_length(realtimekit_app_id) between 1 and 128),
  provider_meeting_id text check (
    provider_meeting_id is null or char_length(provider_meeting_id) between 1 and 128
  ),
  provider_meeting_tag text not null check (char_length(provider_meeting_tag) between 1 and 128),
  provider_participant_id text check (
    provider_participant_id is null or char_length(provider_participant_id) between 1 and 128
  ),
  provider_participant_tag text check (
    provider_participant_tag is null or char_length(provider_participant_tag) between 1 and 128
  ),
  action text not null check (action in (
    'delete_participant', 'end_meeting', 'reconcile_meeting', 'reconcile_participant'
  )),
  reason text not null check (char_length(reason) between 1 and 80),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'complete')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (action = 'delete_participant' and provider_meeting_id is not null
      and provider_participant_id is not null and provider_participant_tag is not null)
    or (action = 'end_meeting' and provider_meeting_id is not null
      and provider_participant_id is null and provider_participant_tag is null)
    or (action = 'reconcile_meeting' and provider_meeting_id is null
      and provider_participant_id is null and provider_participant_tag is null)
    or (action = 'reconcile_participant' and provider_meeting_id is not null
      and provider_participant_id is null and provider_participant_tag is not null)
  ),
  check ((state = 'claimed') = (lease_token is not null and lease_expires_at is not null)),
  check ((state = 'complete') = (completed_at is not null))
);
create unique index group_critique_cleanup_participant_active_idx
  on public.group_critique_cleanup_jobs (provider_participant_id)
  where action = 'delete_participant' and state in ('pending', 'claimed');
create unique index group_critique_cleanup_reconcile_participant_active_idx
  on public.group_critique_cleanup_jobs (provider_participant_tag)
  where action = 'reconcile_participant' and state in ('pending', 'claimed');
create unique index group_critique_cleanup_meeting_active_idx
  on public.group_critique_cleanup_jobs (provider_meeting_id)
  where action = 'end_meeting' and state in ('pending', 'claimed');
create unique index group_critique_cleanup_reconcile_meeting_active_idx
  on public.group_critique_cleanup_jobs (provider_meeting_tag)
  where action = 'reconcile_meeting' and state in ('pending', 'claimed');
create index group_critique_cleanup_batch_idx
  on public.group_critique_cleanup_jobs (available_at, queued_at, job_id)
  where state in ('pending', 'claimed');

alter table public.group_critique_rooms enable row level security;
alter table public.group_critique_members enable row level security;
alter table public.group_critique_runtime enable row level security;
alter table public.group_critique_provider_rooms enable row level security;
alter table public.group_critique_provider_participants enable row level security;
alter table public.group_critique_cleanup_jobs enable row level security;

revoke all on public.group_critique_rooms, public.group_critique_members,
  public.group_critique_runtime, public.group_critique_provider_rooms,
  public.group_critique_provider_participants, public.group_critique_cleanup_jobs
  from public, anon, authenticated, service_role;
grant select on public.group_critique_rooms, public.group_critique_members to authenticated;
-- Backend initial-state/reuse checks need SELECT only; all provider state mutations remain RPC-only.
grant select on public.group_critique_provider_rooms,
  public.group_critique_provider_participants to service_role;

create function private.group_critique_has_blockers(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_critique_rooms r
    where r.session_id = target_session_id and r.state in ('provisioning', 'open', 'ending')
  ) or exists (
    select 1 from public.group_critique_provider_rooms r
    where r.session_id = target_session_id and r.state <> 'removed'
  ) or exists (
    select 1 from public.group_critique_provider_participants p
    where p.session_id = target_session_id and p.state <> 'removed'
  ) or exists (
    select 1 from public.group_critique_cleanup_jobs j
    where j.session_id = target_session_id and j.state <> 'complete'
  );
$$;
revoke all on function private.group_critique_has_blockers(uuid) from public, anon, authenticated;

create function private.group_critique_member_is_current(
  target_session_id uuid,
  target_generation bigint,
  target_member_id uuid
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
    join public.group_critique_rooms r on r.session_id = s.id
    join public.session_invites i on i.session_id = s.id
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where s.id = target_session_id
      and s.live_mode = 'broadcast'
      and r.generation = target_generation
      and r.state = 'open'
      and r.join_expires_at > now()
      and now() between s.starts_at - interval '30 minutes' and s.ends_at + interval '60 minutes'
      and i.member_id = target_member_id
  );
$$;
revoke all on function private.group_critique_member_is_current(uuid, bigint, uuid)
  from public, anon, authenticated;

create function private.group_critique_queue_cleanup(
  target_session_id uuid,
  target_generation bigint,
  target_actor_id uuid,
  target_meeting_id text,
  target_participant_id text,
  target_action text,
  target_reason text,
  target_participant_tag text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.group_critique_runtime;
  meeting_key uuid;
  participant_key uuid;
  participant_epoch_value bigint;
  meeting_tag text;
  participant_tag text;
begin
  if target_action not in (
    'delete_participant', 'end_meeting', 'reconcile_meeting', 'reconcile_participant'
  ) or coalesce(char_length(target_reason), 0) not between 1 and 80
    or (target_action in ('delete_participant', 'end_meeting', 'reconcile_participant')
      and coalesce(char_length(target_meeting_id), 0) not between 1 and 128)
    or (target_action = 'reconcile_meeting' and target_meeting_id is not null)
    or (target_action = 'delete_participant'
      and coalesce(char_length(target_participant_id), 0) not between 1 and 128)
    or (target_action in ('end_meeting', 'reconcile_meeting', 'reconcile_participant')
      and target_participant_id is not null) then
    raise exception 'Invalid group cleanup target' using errcode = '22023';
  end if;
  if target_participant_tag is not null
    and char_length(target_participant_tag) not between 1 and 128 then
    raise exception 'Invalid provider participant cleanup tag' using errcode = '22023';
  end if;

  select * into runtime_row
  from public.group_critique_runtime
  where id is true;
  if not found or runtime_row.cloudflare_account_id is null
    or runtime_row.realtimekit_app_id is null then
    raise exception 'Group critique provider is not bound' using errcode = 'P0001';
  end if;

  select r.idempotency_key into meeting_key
  from public.group_critique_provider_rooms r
  where r.session_id = target_session_id and r.generation = target_generation;
  if not found then raise exception 'Group meeting cleanup tag is missing' using errcode = 'P0001'; end if;
  meeting_tag := 'gymx2-group:' || meeting_key::text;
  if target_action in ('delete_participant', 'reconcile_participant') then
    select p.idempotency_key, p.participant_epoch
      into participant_key, participant_epoch_value
    from public.group_critique_provider_participants p
    where p.session_id = target_session_id and p.generation = target_generation
      and p.actor_id = target_actor_id;
    if not found then raise exception 'Group participant cleanup tag is missing' using errcode = 'P0001'; end if;
    participant_tag := coalesce(
      target_participant_tag,
      participant_key::text || ':' || participant_epoch_value::text
    );
  end if;

  insert into public.group_critique_cleanup_jobs (
    session_id, generation, actor_id, provider_account_id, realtimekit_app_id,
    provider_meeting_id, provider_meeting_tag, provider_participant_id,
    provider_participant_tag, action, reason
  ) values (
    target_session_id, target_generation, target_actor_id,
    runtime_row.cloudflare_account_id, runtime_row.realtimekit_app_id,
    target_meeting_id, meeting_tag, target_participant_id, participant_tag,
    target_action, target_reason
  ) on conflict do nothing;
end;
$$;
revoke all on function private.group_critique_queue_cleanup(uuid, bigint, uuid, text, text, text, text, text)
  from public, anon, authenticated;

create function private.group_critique_remove_member(
  target_session_id uuid,
  target_generation bigint,
  target_member_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_room public.group_critique_rooms;
  participant_row public.group_critique_provider_participants;
  room_row public.group_critique_provider_rooms;
begin
  perform 1 from public.calendar_sessions s where s.id = target_session_id for update;
  select * into group_room
  from public.group_critique_rooms r
  where r.session_id = target_session_id and r.generation = target_generation
  for update;
  update public.group_critique_members m
  set membership_state = 'removed', camera_allowed = false, microphone_allowed = false,
      participant_epoch = participant_epoch + 1, updated_at = now()
  where m.session_id = target_session_id and m.generation = target_generation
    and m.member_id = target_member_id
    and (m.membership_state <> 'removed' or m.camera_allowed or m.microphone_allowed);

  select * into room_row
  from public.group_critique_provider_rooms r
  where r.session_id = target_session_id and r.generation = target_generation
  for update;
  select * into participant_row
  from public.group_critique_provider_participants p
  where p.session_id = target_session_id and p.generation = target_generation
    and p.actor_id = target_member_id
  for update;
  if found and participant_row.state <> 'removed' then
    update public.group_critique_provider_participants
    set state = 'remove_pending', updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and actor_id = target_member_id;
    if participant_row.provider_participant_id is not null then
      if found and room_row.provider_meeting_id is not null then
        perform private.group_critique_queue_cleanup(
          target_session_id, target_generation, target_member_id,
          room_row.provider_meeting_id, participant_row.provider_participant_id,
          'delete_participant', target_reason
        );
      end if;
    end if;
  end if;
end;
$$;
revoke all on function private.group_critique_remove_member(uuid, bigint, uuid, text)
  from public, anon, authenticated;

create function private.group_critique_begin_end(
  target_session_id uuid,
  target_generation bigint,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant_row record;
  provider_room public.group_critique_provider_rooms;
begin
  perform 1 from public.calendar_sessions s where s.id = target_session_id for update;
  update public.group_critique_rooms r
  set state = 'ending'
  where r.session_id = target_session_id and r.generation = target_generation
    and r.state in ('provisioning', 'open');

  select * into provider_room
  from public.group_critique_provider_rooms r
  where r.session_id = target_session_id and r.generation = target_generation
  for update;

  for participant_row in
    select p.actor_id, p.provider_participant_id
    from public.group_critique_provider_participants p
    where p.session_id = target_session_id and p.generation = target_generation
      and p.state <> 'removed'
    order by p.actor_id
    for update
  loop
    update public.group_critique_provider_participants
    set state = 'remove_pending', updated_at = now()
    where session_id = target_session_id and generation = target_generation
      and actor_id = participant_row.actor_id;
    if participant_row.provider_participant_id is not null
      and provider_room.provider_meeting_id is not null then
      perform private.group_critique_queue_cleanup(
        target_session_id, target_generation, participant_row.actor_id,
        provider_room.provider_meeting_id, participant_row.provider_participant_id,
        'delete_participant', target_reason
      );
    end if;
  end loop;

  if provider_room.session_id is not null and provider_room.provider_meeting_id is not null
    and provider_room.state <> 'removed' then
    update public.group_critique_provider_rooms
    set state = 'ending', updated_at = now()
    where session_id = target_session_id and generation = target_generation;
    perform private.group_critique_queue_cleanup(
      target_session_id, target_generation, null,
      provider_room.provider_meeting_id, null, 'end_meeting', target_reason
    );
  end if;
end;
$$;
revoke all on function private.group_critique_begin_end(uuid, bigint, text)
  from public, anon, authenticated;

create function private.group_critique_maybe_finalize(
  target_session_id uuid,
  target_generation bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.group_critique_rooms r
    where r.session_id = target_session_id and r.generation = target_generation
      and r.state = 'ending'
  ) and not exists (
    select 1 from public.group_critique_cleanup_jobs j
    where j.session_id = target_session_id and j.generation = target_generation
      and j.state <> 'complete'
  ) and not exists (
    select 1 from public.group_critique_provider_participants p
    where p.session_id = target_session_id and p.generation = target_generation
      and p.state <> 'removed'
  ) and not exists (
    select 1 from public.group_critique_provider_rooms r
    where r.session_id = target_session_id and r.generation = target_generation
      and r.state <> 'removed'
  ) then
    update public.group_critique_rooms
    set state = 'ended', ended_at = coalesce(ended_at, now())
    where session_id = target_session_id and generation = target_generation
      and state = 'ending';
  end if;
end;
$$;
revoke all on function private.group_critique_maybe_finalize(uuid, bigint)
  from public, anon, authenticated;

create function public.group_critique_provider_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_critique_runtime r
    where r.id is true
      and r.cloudflare_account_id is not null
      and r.realtimekit_app_id is not null
      and r.last_cleanup_at >= now() - interval '3 minutes'
      and r.last_cleanup_at <= now()
  );
$$;

create function public.group_critique_provider_bound()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_critique_runtime r
    where r.id is true and r.cloudflare_account_id is not null
      and r.realtimekit_app_id is not null
  );
$$;

create function public.bind_group_critique_provider(p_account_id text,p_app_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.group_critique_runtime;
  normalized_account_id text := lower(p_account_id);
  normalized_app_id text := nullif(trim(p_app_id), '');
begin
  if normalized_account_id !~ '^[0-9a-f]{32}$'
    or normalized_app_id is null or char_length(normalized_app_id) > 128 then
    raise exception 'Invalid group critique provider binding' using errcode = '22023';
  end if;
  select * into runtime_row from public.group_critique_runtime where id is true for update;
  if not found then raise exception 'Group critique runtime row is missing' using errcode = 'P0001'; end if;
  if runtime_row.cloudflare_account_id is not null then
    return runtime_row.cloudflare_account_id = normalized_account_id
      and runtime_row.realtimekit_app_id = normalized_app_id;
  end if;
  if exists (
    select 1 from public.private_live_runtime pr
    where pr.id is true and pr.cloudflare_account_id is not null
      and pr.cloudflare_account_id <> normalized_account_id
  ) then
    return false;
  end if;
  if exists (select 1 from public.group_critique_provider_rooms r where r.state <> 'removed')
    or exists (select 1 from public.group_critique_provider_participants p where p.state <> 'removed')
    or exists (select 1 from public.group_critique_cleanup_jobs j where j.state <> 'complete') then
    return false;
  end if;
  update public.group_critique_runtime
  set cloudflare_account_id = normalized_account_id, realtimekit_app_id = normalized_app_id
  where id is true and cloudflare_account_id is null and realtimekit_app_id is null;
  return found;
end;
$$;

create function public.record_group_critique_cleanup_heartbeat()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.group_critique_runtime;
begin
  select * into runtime_row from public.group_critique_runtime where id is true for update;
  if not found or runtime_row.cloudflare_account_id is null or runtime_row.realtimekit_app_id is null then
    raise exception 'Group critique provider is not bound' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.group_critique_cleanup_jobs j where j.state <> 'complete') then
    raise exception 'Group critique cleanup queue is not empty' using errcode = 'P0001';
  end if;
  update public.group_critique_runtime set last_cleanup_at = now() where id is true;
end;
$$;

revoke all on function public.group_critique_provider_ready() from public, anon, authenticated, service_role;
revoke all on function public.group_critique_provider_bound() from public, anon, authenticated, service_role;
revoke all on function public.bind_group_critique_provider(text,text) from public, anon, authenticated, service_role;
revoke all on function public.record_group_critique_cleanup_heartbeat()
  from public, anon, authenticated, service_role;
grant execute on function public.group_critique_provider_ready() to service_role;
grant execute on function public.group_critique_provider_bound() to service_role;
grant execute on function public.bind_group_critique_provider(text,text) to service_role;
grant execute on function public.record_group_critique_cleanup_heartbeat() to service_role;

create function private.can_read_group_critique_room(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_sessions s
    where s.id = target_session_id
      and not private.is_admin()
      and (
        (s.coach_id = (select auth.uid()) and private.has_role((select auth.uid()), 'coach'))
        or (private.is_session_invitee(s.id)
          and private.has_role((select auth.uid()), 'member'))
      )
  );
$$;

create function private.can_read_group_critique_member(
  target_session_id uuid,
  target_member_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (target_member_id = (select auth.uid()) and not private.is_admin()
      and private.has_role((select auth.uid()), 'member')) or exists (
    select 1 from public.calendar_sessions s
    where s.id = target_session_id and s.coach_id = (select auth.uid())
      and not private.is_admin()
      and private.has_role((select auth.uid()), 'coach')
  );
$$;

revoke all on function private.can_read_group_critique_room(uuid) from public, anon;
revoke all on function private.can_read_group_critique_member(uuid, uuid) from public, anon;
grant execute on function private.can_read_group_critique_room(uuid) to authenticated;
grant execute on function private.can_read_group_critique_member(uuid, uuid) to authenticated;

create policy "Invited people read group critique room metadata"
on public.group_critique_rooms for select to authenticated
using ((select private.can_read_group_critique_room(session_id)));
create policy "Members read their own critique state and coaches read the roster"
on public.group_critique_members for select to authenticated
using ((select private.can_read_group_critique_member(session_id, member_id)));

create function public.read_group_critique_room(
  p_session_id uuid,
  p_generation bigint default null
)
returns table (
  generation bigint,
  room_state text,
  join_expires_at timestamptz,
  all_members_muted boolean,
  member_id uuid,
  membership_state text,
  offered_at timestamptz,
  camera_allowed boolean,
  microphone_allowed boolean,
  coach_muted boolean,
  participant_epoch bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_coach uuid;
  chosen_generation bigint;
  room_row public.group_critique_rooms;
begin
  if caller is null or private.is_admin() then
    raise exception 'Session participant access required' using errcode = '42501';
  end if;
  select s.coach_id into session_coach
  from public.calendar_sessions s
  where s.id = p_session_id;
  if not found or not (
    (session_coach = caller and private.has_role(caller, 'coach'))
    or (private.is_session_invitee(p_session_id) and private.has_role(caller, 'member'))
  ) then
    return;
  end if;
  if p_generation is null then
    select max(r.generation) into chosen_generation
    from public.group_critique_rooms r where r.session_id = p_session_id;
  else
    chosen_generation := p_generation;
  end if;
  select * into room_row
  from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = chosen_generation;
  if not found then return; end if;

  if session_coach = caller then
    return query
    select room_row.generation, room_row.state, room_row.join_expires_at,
      room_row.all_members_muted, roster.member_id,
      coalesce(m.membership_state, 'eligible'), m.offered_at,
      coalesce(m.camera_allowed, false), coalesce(m.microphone_allowed, false),
      coalesce(m.coach_muted, room_row.all_members_muted), coalesce(m.participant_epoch, 0)
    from (
      select i.member_id
      from public.session_invites i
      join public.profiles p on p.id = i.member_id and p.role::text = 'member'
      where i.session_id = p_session_id
      union all
      select null::uuid
      where not exists (
        select 1 from public.session_invites i
        join public.profiles p on p.id = i.member_id and p.role::text = 'member'
        where i.session_id = p_session_id
      )
    ) roster
    left join public.group_critique_members m
      on m.session_id = p_session_id and m.generation = chosen_generation
      and m.member_id = roster.member_id;
  else
    return query
    select room_row.generation, room_row.state, room_row.join_expires_at,
      room_row.all_members_muted, caller, m.membership_state, m.offered_at,
      coalesce(m.camera_allowed, false), coalesce(m.microphone_allowed, false),
      coalesce(m.coach_muted, false), coalesce(m.participant_epoch, 0)
    from (select 1) singleton
    left join public.group_critique_members m
      on m.session_id = p_session_id and m.generation = chosen_generation
      and m.member_id = caller;
  end if;
end;
$$;
revoke all on function public.read_group_critique_room(uuid, bigint) from public, anon;
grant execute on function public.read_group_critique_room(uuid, bigint) to authenticated;

create function public.open_group_critique_room(p_session_id uuid)
returns table (generation bigint, state text, join_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_row public.calendar_sessions;
  next_generation bigint;
  new_generation bigint;
  expiry_at timestamptz;
  invite_count integer;
begin
  if caller is null or not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  select * into session_row
  from public.calendar_sessions s
  where s.id = p_session_id and s.coach_id = caller
  for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if session_row.live_mode <> 'broadcast' then
    raise exception 'Group critique requires broadcast session mode' using errcode = 'P0001';
  end if;
  if now() < session_row.starts_at - interval '30 minutes'
    or now() > session_row.ends_at + interval '60 minutes' then
    raise exception 'The session is outside its live window' using errcode = 'P0001';
  end if;
  if not public.group_critique_provider_ready() then
    raise exception 'Group critique cleanup is not ready' using errcode = 'P0001';
  end if;
  select count(*)::integer into invite_count
  from public.session_invites i
  where i.session_id = p_session_id;
  if invite_count > 25 then
    raise exception 'Group critique supports up to 25 invited members' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.session_live l where l.session_id = p_session_id) then
    raise exception 'Remove the existing broadcast input before opening group critique'
      using errcode = 'P0001';
  end if;
  if private.private_session_has_blockers(p_session_id) then
    raise exception 'Private session provider cleanup must finish first' using errcode = 'P0001';
  end if;
  if private.group_critique_has_blockers(p_session_id) then
    raise exception 'Previous group critique cleanup must finish first' using errcode = 'P0001';
  end if;

  select greatest(
    coalesce((select max(r.generation) from public.group_critique_rooms r where r.session_id = p_session_id), 0),
    coalesce((select max(r.generation) from public.group_critique_provider_rooms r where r.session_id = p_session_id), 0),
    coalesce((select max(p.generation) from public.group_critique_provider_participants p where p.session_id = p_session_id), 0),
    coalesce((select max(j.generation) from public.group_critique_cleanup_jobs j where j.session_id = p_session_id), 0)
  ) + 1 into next_generation;
  expiry_at := session_row.ends_at + interval '60 minutes';
  insert into public.group_critique_rooms (session_id, generation, created_by, join_expires_at)
  values (p_session_id, next_generation, caller, expiry_at)
  returning group_critique_rooms.generation into new_generation;
  insert into public.group_critique_members (session_id, generation, member_id)
  select p_session_id, new_generation, i.member_id
  from public.session_invites i
  join public.profiles p on p.id = i.member_id and p.role::text = 'member'
  where i.session_id = p_session_id
  on conflict do nothing;
  return query select new_generation, 'provisioning'::text, expiry_at;
end;
$$;

create function public.offer_group_critique_cameras(
  p_session_id uuid,
  p_generation bigint,
  p_member_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  changed_count integer;
begin
  if caller is null or not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id and s.coach_id = caller for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or room_row.state not in ('provisioning', 'open')
    or room_row.join_expires_at <= now() then
    raise exception 'Group critique room is not accepting camera offers' using errcode = 'P0001';
  end if;
  if session_row.live_mode <> 'broadcast' or not public.group_critique_provider_ready() then
    raise exception 'Group critique is not ready' using errcode = 'P0001';
  end if;
  if p_member_id is not null and not exists (
    select 1 from public.session_invites i
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where i.session_id = p_session_id and i.member_id = p_member_id
  ) then
    raise exception 'Choose a current invited member' using errcode = 'P0001';
  end if;

  insert into public.group_critique_members (
    session_id, generation, member_id, offered_at, membership_state, coach_muted
  )
  select p_session_id, p_generation, i.member_id, now(), 'eligible', room_row.all_members_muted
  from public.session_invites i
  join public.profiles p on p.id = i.member_id and p.role::text = 'member'
  where i.session_id = p_session_id
    and (p_member_id is null or i.member_id = p_member_id)
  on conflict (session_id, generation, member_id) do update
    set offered_at = coalesce(group_critique_members.offered_at, excluded.offered_at),
        membership_state = case
          when group_critique_members.membership_state = 'removed'
            and not exists (
              select 1 from public.group_critique_cleanup_jobs j
              where j.session_id = group_critique_members.session_id
                and j.generation = group_critique_members.generation
                and j.actor_id = group_critique_members.member_id and j.state <> 'complete'
            ) then 'eligible'
          else group_critique_members.membership_state
        end,
        coach_muted = case when group_critique_members.membership_state = 'removed'
          then room_row.all_members_muted else group_critique_members.coach_muted end,
        updated_at = now();
  get diagnostics changed_count = row_count;
  if changed_count = 0 then
    raise exception 'No current invited members found' using errcode = 'P0001';
  end if;
  return changed_count;
end;
$$;

create function public.accept_group_critique_offer(
  p_session_id uuid,
  p_generation bigint,
  p_allow_camera boolean,
  p_allow_microphone boolean
)
returns table (camera_allowed boolean, microphone_allowed boolean, participant_epoch bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  member_row public.group_critique_members;
  provider_row public.group_critique_provider_participants;
  room_provider_row public.group_critique_provider_rooms;
  next_epoch bigint;
begin
  if caller is null or not private.has_role(caller, 'member') then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if p_allow_camera is distinct from true or p_allow_microphone is distinct from true then
    raise exception 'Accept camera and microphone together, or decline the offer'
      using errcode = '22023';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or session_row.live_mode <> 'broadcast'
    or room_row.state not in ('provisioning', 'open') or room_row.join_expires_at <= now()
    or now() < session_row.starts_at - interval '30 minutes'
    or now() > session_row.ends_at + interval '60 minutes'
    or not public.group_critique_provider_ready() then
    raise exception 'Group critique is not accepting media consent' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.session_invites i
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where i.session_id = p_session_id and i.member_id = caller
  ) then
    raise exception 'Only a current invitee can accept this offer' using errcode = '42501';
  end if;
  select * into member_row from public.group_critique_members m
  where m.session_id = p_session_id and m.generation = p_generation and m.member_id = caller
  for update;
  if not found or member_row.offered_at is null then
    raise exception 'The coach has not offered camera access' using errcode = 'P0001';
  end if;
  if member_row.membership_state <> 'eligible' then
    raise exception 'This invite is no longer active in the room' using errcode = 'P0001';
  end if;
  if member_row.camera_allowed and member_row.microphone_allowed then
    return query select true, true, member_row.participant_epoch;
    return;
  end if;

  next_epoch := member_row.participant_epoch + 1;
  update public.group_critique_members
  set camera_allowed = true, microphone_allowed = true,
      participant_epoch = next_epoch, updated_at = now()
  where session_id = p_session_id and generation = p_generation and member_id = caller;

  select * into room_provider_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  select * into provider_row from public.group_critique_provider_participants p
  where p.session_id = p_session_id and p.generation = p_generation and p.actor_id = caller
  for update;
  if found and provider_row.state <> 'removed' then
    update public.group_critique_provider_participants
    set state = 'remove_pending', updated_at = now()
    where session_id = p_session_id and generation = p_generation and actor_id = caller;
    if provider_row.provider_participant_id is not null then
      if found and room_provider_row.provider_meeting_id is not null then
        perform private.group_critique_queue_cleanup(
          p_session_id, p_generation, caller, room_provider_row.provider_meeting_id,
          provider_row.provider_participant_id, 'delete_participant', 'consent_changed'
        );
      end if;
    end if;
  end if;
  return query select true, true, next_epoch;
end;
$$;

create function public.decline_group_critique_offer(p_session_id uuid,p_generation bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  member_row public.group_critique_members;
  provider_row public.group_critique_provider_participants;
  room_provider_row public.group_critique_provider_rooms;
  next_epoch bigint;
begin
  if caller is null or not private.has_role(caller, 'member') then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  perform 1 from public.calendar_sessions s where s.id = p_session_id for update;
  if not found then return false; end if;
  if not exists (select 1 from public.session_invites i
    where i.session_id = p_session_id and i.member_id = caller) then
    raise exception 'Only a current invitee can decline this offer' using errcode = '42501';
  end if;
  select * into member_row from public.group_critique_members m
  where m.session_id = p_session_id and m.generation = p_generation and m.member_id = caller
  for update;
  if not found or member_row.membership_state <> 'eligible' then return false; end if;
  if member_row.camera_allowed or member_row.microphone_allowed then
    next_epoch := member_row.participant_epoch + 1;
    update public.group_critique_members
    set offered_at = null, camera_allowed = false, microphone_allowed = false,
        participant_epoch = next_epoch, updated_at = now()
    where session_id = p_session_id and generation = p_generation and member_id = caller;
    select * into room_provider_row from public.group_critique_provider_rooms r
    where r.session_id = p_session_id and r.generation = p_generation for update;
    select * into provider_row from public.group_critique_provider_participants p
    where p.session_id = p_session_id and p.generation = p_generation and p.actor_id = caller
    for update;
    if found and provider_row.state <> 'removed' then
      update public.group_critique_provider_participants
      set state = 'remove_pending', updated_at = now()
      where session_id = p_session_id and generation = p_generation and actor_id = caller;
      if provider_row.provider_participant_id is not null then
        if found and room_provider_row.provider_meeting_id is not null then
          perform private.group_critique_queue_cleanup(
            p_session_id, p_generation, caller, room_provider_row.provider_meeting_id,
            provider_row.provider_participant_id, 'delete_participant', 'consent_withdrawn'
          );
        end if;
      end if;
    end if;
  else
    update public.group_critique_members
    set offered_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation and member_id = caller
      and offered_at is not null;
  end if;
  return true;
end;
$$;

create function public.set_group_critique_mute(
  p_session_id uuid,
  p_generation bigint,
  p_member_id uuid,
  p_muted boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  room_row public.group_critique_rooms;
begin
  if caller is null or not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if not public.group_critique_provider_ready() then
    raise exception 'Group critique cleanup is not ready' using errcode = 'P0001';
  end if;
  perform 1 from public.calendar_sessions s
  where s.id = p_session_id and s.coach_id = caller for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or room_row.state <> 'open' then return false; end if;
  if p_member_id is null then
    update public.group_critique_rooms
    set all_members_muted = coalesce(p_muted, false)
    where session_id = p_session_id and generation = p_generation;
    insert into public.group_critique_members (
      session_id, generation, member_id, coach_muted
    )
    select p_session_id, p_generation, i.member_id, coalesce(p_muted, false)
    from public.session_invites i
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where i.session_id = p_session_id
    on conflict (session_id, generation, member_id) do update
      set coach_muted = coalesce(p_muted, false), updated_at = now();
    return true;
  end if;
  if not exists (
    select 1 from public.session_invites i
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where i.session_id = p_session_id and i.member_id = p_member_id
  ) then
    raise exception 'Choose a current invited member' using errcode = 'P0001';
  end if;
  insert into public.group_critique_members (session_id, generation, member_id, coach_muted)
  values (p_session_id, p_generation, p_member_id, coalesce(p_muted, false))
  on conflict (session_id, generation, member_id) do update
  set coach_muted = coalesce(p_muted, false), updated_at = now();
  return true;
end;
$$;

create function public.end_group_critique_room(p_session_id uuid,p_generation bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  room_row public.group_critique_rooms;
begin
  if caller is null or not private.has_role(caller, 'coach') then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  perform 1 from public.calendar_sessions s
  where s.id = p_session_id and s.coach_id = caller for update;
  if not found then raise exception 'Session not found' using errcode = 'P0002'; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found then return false; end if;
  if room_row.state = 'ended' then return true; end if;
  perform private.group_critique_begin_end(p_session_id, p_generation, 'coach_ended_room');
  perform private.group_critique_maybe_finalize(p_session_id, p_generation);
  return true;
end;
$$;

create function public.claim_group_critique_meeting(p_session_id uuid,p_generation bigint)
returns table (
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_meeting_id text,
  create_required boolean,
  idempotency_key uuid,
  provider_meeting_tag text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  provider_row public.group_critique_provider_rooms;
  new_lease uuid;
  lease_until timestamptz;
begin
  if not public.group_critique_provider_ready() then
    raise exception 'Group critique cleanup is not ready' using errcode = 'P0001';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  if not found then return; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or room_row.state not in ('provisioning', 'open')
    or session_row.live_mode <> 'broadcast'
    or room_row.join_expires_at <= now()
    or now() < session_row.starts_at - interval '30 minutes'
    or now() > session_row.ends_at + interval '60 minutes'
    or exists (select 1 from public.session_live l where l.session_id = p_session_id)
    or private.private_session_has_blockers(p_session_id) then
    return;
  end if;
  if (select count(*) from public.session_invites i where i.session_id = p_session_id) > 25 then
    return;
  end if;

  select * into provider_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if found and provider_row.state = 'ready' and provider_row.provider_meeting_id is not null then
    return query select null::uuid, null::timestamptz, provider_row.provider_meeting_id,
      false, provider_row.idempotency_key, 'gymx2-group:' || provider_row.idempotency_key::text;
    return;
  end if;
  if found and provider_row.state in ('ending', 'removed') then return; end if;
  if found and provider_row.state = 'provisioning' then
    if provider_row.provision_lease_expires_at > now() - interval '1 minute' then
      return;
    end if;
    update public.group_critique_provider_rooms
    set state = 'ending', provision_lease_token = null,
        provision_lease_expires_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation;
    update public.group_critique_rooms
    set state = 'ending'
    where session_id = p_session_id and generation = p_generation
      and state = 'provisioning';
    perform private.group_critique_queue_cleanup(
      p_session_id, p_generation, null, null, null,
      'reconcile_meeting', 'meeting_provision_lease_expired'
    );
    return;
  end if;

  new_lease := gen_random_uuid();
  lease_until := now() + interval '2 minutes';
  if found then
    update public.group_critique_provider_rooms
    set state = 'provisioning', provision_lease_token = new_lease,
        provision_lease_expires_at = lease_until, updated_at = now()
    where session_id = p_session_id and generation = p_generation;
    select * into provider_row from public.group_critique_provider_rooms r
    where r.session_id = p_session_id and r.generation = p_generation;
  else
    insert into public.group_critique_provider_rooms (
      session_id, generation, state, provision_lease_token, provision_lease_expires_at
    ) values (p_session_id, p_generation, 'provisioning', new_lease, lease_until)
    returning * into provider_row;
  end if;
  return query select new_lease, lease_until, null::text, true,
    provider_row.idempotency_key, 'gymx2-group:' || provider_row.idempotency_key::text;
end;
$$;

create function public.complete_group_critique_meeting(
  p_session_id uuid,
  p_generation bigint,
  p_lease_token uuid,
  p_provider_meeting_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  provider_row public.group_critique_provider_rooms;
  session_exists boolean := false;
  valid_completion boolean := false;
begin
  if coalesce(char_length(p_provider_meeting_id), 0) not between 1 and 128 then
    raise exception 'Invalid provider meeting identifier' using errcode = '22023';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  session_exists := found;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  select * into provider_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found then return false; end if;

  if provider_row.state = 'ready' and provider_row.provider_meeting_id = p_provider_meeting_id
    and room_row.state = 'open' then
    return true;
  end if;
  if session_exists and found and provider_row.state = 'provisioning'
    and provider_row.provision_lease_token = p_lease_token
    and provider_row.provision_lease_expires_at > now()
    and room_row.state = 'provisioning'
    and session_row.live_mode = 'broadcast'
    and room_row.join_expires_at > now()
    and now() between session_row.starts_at - interval '30 minutes'
      and session_row.ends_at + interval '60 minutes'
    and public.group_critique_provider_ready()
    and not exists (select 1 from public.session_live l where l.session_id = p_session_id)
    and not private.private_session_has_blockers(p_session_id)
    and (select count(*) from public.session_invites i where i.session_id = p_session_id) <= 25 then
    valid_completion := true;
  end if;

  if valid_completion then
    update public.group_critique_provider_rooms
    set state = 'ready', provider_meeting_id = p_provider_meeting_id,
        provision_lease_token = null, provision_lease_expires_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation
      and provision_lease_token = p_lease_token;
    update public.group_critique_rooms
    set state = 'open', opened_at = coalesce(opened_at, now())
    where session_id = p_session_id and generation = p_generation and state = 'provisioning';
    insert into public.group_critique_members (session_id, generation, member_id)
    select p_session_id, p_generation, i.member_id
    from public.session_invites i
    join public.profiles p on p.id = i.member_id and p.role::text = 'member'
    where i.session_id = p_session_id
    on conflict (session_id, generation, member_id) do nothing;
    return true;
  end if;

  if provider_row.provider_meeting_id is null
    or provider_row.provider_meeting_id = p_provider_meeting_id
    or provider_row.state <> 'ready' then
    update public.group_critique_provider_rooms
    set state = 'ending', provider_meeting_id = p_provider_meeting_id,
        provision_lease_token = null, provision_lease_expires_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation;
  end if;
  perform private.group_critique_queue_cleanup(
    p_session_id, p_generation, null, p_provider_meeting_id, null,
    'end_meeting', 'stale_meeting_create'
  );
  if room_row.session_id is not null then
    perform private.group_critique_begin_end(p_session_id, p_generation, 'stale_meeting_create');
  end if;
  return false;
end;
$$;

create function public.claim_group_critique_participant(
  p_session_id uuid,
  p_generation bigint,
  p_actor_id uuid
)
returns table (
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_meeting_id text,
  provider_participant_id text,
  preset text,
  can_publish_audio boolean,
  can_publish_video boolean,
  muted boolean,
  token_expires_at timestamptz,
  participant_epoch bigint,
  provision_required boolean,
  idempotency_key uuid,
  provider_participant_tag text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  member_row public.group_critique_members;
  provider_room_row public.group_critique_provider_rooms;
  provider_row public.group_critique_provider_participants;
  actor_kind_value text;
  preset_value text;
  camera_value boolean := false;
  microphone_value boolean := false;
  muted_value boolean := false;
  epoch_value bigint := 0;
  active_count integer;
  new_lease uuid;
  lease_until timestamptz;
  new_idempotency_key uuid;
  has_provider_row boolean := false;
begin
  if not public.group_critique_provider_ready() then
    raise exception 'Group critique cleanup is not ready' using errcode = 'P0001';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  if not found then return; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or room_row.state <> 'open' or session_row.live_mode <> 'broadcast'
    or room_row.join_expires_at <= now()
    or now() < session_row.starts_at - interval '30 minutes'
    or now() > session_row.ends_at + interval '60 minutes'
    or exists (select 1 from public.session_live l where l.session_id = p_session_id)
    or private.private_session_has_blockers(p_session_id) then
    return;
  end if;
  if (select count(*) from public.session_invites i where i.session_id = p_session_id) > 25 then
    return;
  end if;

  if p_actor_id = session_row.coach_id and private.has_role(p_actor_id, 'coach') then
    actor_kind_value := 'coach';
    preset_value := 'host';
    camera_value := true;
    microphone_value := true;
  elsif private.has_role(p_actor_id, 'member') and exists (
    select 1 from public.session_invites i
    where i.session_id = p_session_id and i.member_id = p_actor_id
  ) then
    actor_kind_value := 'member';
    insert into public.group_critique_members (session_id, generation, member_id, coach_muted)
    values (p_session_id, p_generation, p_actor_id, room_row.all_members_muted)
    on conflict (session_id, generation, member_id) do nothing;
    select * into member_row from public.group_critique_members m
    where m.session_id = p_session_id and m.generation = p_generation and m.member_id = p_actor_id
    for update;
    if member_row.membership_state = 'removed'
      and not exists (
        select 1 from public.group_critique_cleanup_jobs j
        where j.session_id = p_session_id and j.generation = p_generation
          and j.actor_id = p_actor_id and j.state <> 'complete'
      ) then
      update public.group_critique_members
      set membership_state = 'eligible', offered_at = null,
          camera_allowed = false, microphone_allowed = false,
          coach_muted = room_row.all_members_muted,
          participant_epoch = participant_epoch + 1, updated_at = now()
      where session_id = p_session_id and generation = p_generation and member_id = p_actor_id
      returning * into member_row;
    end if;
    if member_row.membership_state <> 'eligible' then return; end if;
    camera_value := member_row.camera_allowed;
    microphone_value := member_row.microphone_allowed;
    epoch_value := member_row.participant_epoch;
    muted_value := member_row.coach_muted;
    preset_value := case when camera_value and microphone_value then 'can_request' else 'not_allowed' end;
  else
    return;
  end if;

  select * into provider_room_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or provider_room_row.state <> 'ready'
    or provider_room_row.provider_meeting_id is null then
    return;
  end if;
  if exists (
    select 1 from public.group_critique_cleanup_jobs j
    where j.session_id = p_session_id and j.generation = p_generation
      and j.actor_id = p_actor_id and j.state <> 'complete'
  ) then
    return;
  end if;

  select count(*)::integer into active_count
  from public.group_critique_provider_participants p
  where p.session_id = p_session_id and p.generation = p_generation
    and p.actor_id <> p_actor_id and p.actor_kind = 'member' and p.state <> 'removed';
  if actor_kind_value = 'member' and active_count >= 25 then
    raise exception 'Group room has reached its 25 member limit' using errcode = 'P0001';
  end if;

  select * into provider_row from public.group_critique_provider_participants p
  where p.session_id = p_session_id and p.generation = p_generation and p.actor_id = p_actor_id
  for update;
  has_provider_row := found;
  if has_provider_row and provider_row.state = 'ready'
    and provider_row.preset = preset_value
    and provider_row.participant_epoch = epoch_value
    and provider_row.provider_participant_id is not null then
    return query select null::uuid, null::timestamptz, provider_room_row.provider_meeting_id,
      provider_row.provider_participant_id, provider_row.preset, camera_value, microphone_value,
      muted_value, room_row.join_expires_at, epoch_value,
      false, provider_row.idempotency_key,
      provider_row.idempotency_key::text || ':' || provider_row.participant_epoch::text;
    return;
  end if;
  if has_provider_row and provider_row.state in ('ready', 'provisioning', 'remove_pending') then
    if provider_row.state = 'provisioning'
      and provider_row.provision_lease_expires_at > now() - interval '1 minute' then
      return;
    end if;
    if provider_row.state = 'ready' and provider_row.provider_participant_id is not null then
      update public.group_critique_provider_participants
      set state = 'remove_pending', updated_at = now()
      where session_id = p_session_id and generation = p_generation and actor_id = p_actor_id;
      perform private.group_critique_queue_cleanup(
        p_session_id, p_generation, p_actor_id, provider_room_row.provider_meeting_id,
        provider_row.provider_participant_id, 'delete_participant', 'participant_preset_changed'
      );
    elsif provider_row.state = 'provisioning'
      and provider_row.provision_lease_expires_at <= now() - interval '1 minute' then
      update public.group_critique_provider_participants
      set state = 'remove_pending', updated_at = now()
      where session_id = p_session_id and generation = p_generation and actor_id = p_actor_id;
      perform private.group_critique_queue_cleanup(
        p_session_id, p_generation, p_actor_id, provider_room_row.provider_meeting_id,
        null, 'reconcile_participant', 'provision_lease_expired'
      );
    end if;
    return;
  end if;

  new_lease := gen_random_uuid();
  lease_until := now() + interval '2 minutes';
  new_idempotency_key := gen_random_uuid();
  if has_provider_row then
    update public.group_critique_provider_participants
    set actor_kind = actor_kind_value, provider_participant_id = null, state = 'provisioning',
        preset = preset_value, participant_epoch = epoch_value,
        provision_lease_token = new_lease, provision_lease_expires_at = lease_until,
        idempotency_key = new_idempotency_key, updated_at = now()
    where session_id = p_session_id and generation = p_generation and actor_id = p_actor_id;
  else
    insert into public.group_critique_provider_participants (
      session_id, generation, actor_id, actor_kind, state, preset, participant_epoch,
      provision_lease_token, provision_lease_expires_at, idempotency_key
    ) values (
      p_session_id, p_generation, p_actor_id, actor_kind_value, 'provisioning', preset_value,
      epoch_value, new_lease, lease_until, new_idempotency_key
    );
  end if;
  return query select new_lease, lease_until, provider_room_row.provider_meeting_id,
    null::text, preset_value, camera_value, microphone_value, muted_value,
    room_row.join_expires_at, epoch_value,
    true, new_idempotency_key, new_idempotency_key::text || ':' || epoch_value::text;
end;
$$;

create function public.complete_group_critique_participant(
  p_session_id uuid,
  p_generation bigint,
  p_actor_id uuid,
  p_lease_token uuid,
  p_provider_participant_id text,
  p_provider_participant_tag text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  member_row public.group_critique_members;
  provider_room_row public.group_critique_provider_rooms;
  provider_row public.group_critique_provider_participants;
  has_session boolean := false;
  has_room boolean := false;
  has_member boolean := false;
  has_provider_room boolean := false;
  expected_kind text;
  expected_preset text;
  expected_epoch bigint := 0;
  expected_camera boolean := false;
  expected_microphone boolean := false;
  actor_is_current boolean := false;
  valid_completion boolean := false;
begin
  if coalesce(char_length(p_provider_participant_id), 0) not between 1 and 128 then
    raise exception 'Invalid provider participant identifier' using errcode = '22023';
  end if;
  if coalesce(char_length(p_provider_participant_tag), 0) not between 1 and 128 then
    raise exception 'Invalid provider participant tag' using errcode = '22023';
  end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  has_session := found;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  has_room := found;

  if has_session and has_room and p_actor_id = session_row.coach_id
    and private.has_role(p_actor_id, 'coach') then
    expected_kind := 'coach';
    expected_preset := 'host';
    expected_epoch := 0;
    expected_camera := true;
    expected_microphone := true;
    actor_is_current := true;
  elsif has_session and has_room and private.has_role(p_actor_id, 'member')
    and exists (select 1 from public.session_invites i
      where i.session_id = p_session_id and i.member_id = p_actor_id) then
    expected_kind := 'member';
    select * into member_row from public.group_critique_members m
    where m.session_id = p_session_id and m.generation = p_generation and m.member_id = p_actor_id
    for update;
    has_member := found;
    if has_member then
      expected_epoch := member_row.participant_epoch;
      expected_camera := member_row.camera_allowed;
      expected_microphone := member_row.microphone_allowed;
      expected_preset := case when expected_camera and expected_microphone
        then 'can_request' else 'not_allowed' end;
      actor_is_current := member_row.membership_state = 'eligible';
    end if;
  end if;

  select * into provider_room_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  has_provider_room := found;
  select * into provider_row from public.group_critique_provider_participants p
  where p.session_id = p_session_id and p.generation = p_generation and p.actor_id = p_actor_id
  for update;
  if not found then return false; end if;

  if provider_row.state = 'ready' and provider_row.provider_participant_id = p_provider_participant_id then
    return has_session and has_room and actor_is_current
      and provider_row.participant_epoch = expected_epoch
      and provider_row.preset = expected_preset
      and provider_row.idempotency_key::text || ':' || provider_row.participant_epoch::text
        = p_provider_participant_tag;
  end if;
  valid_completion := has_session and has_room and has_provider_room and actor_is_current
    and provider_row.state = 'provisioning'
    and provider_row.provision_lease_token = p_lease_token
    and provider_row.provision_lease_expires_at > now()
    and provider_row.participant_epoch = expected_epoch
    and provider_row.preset = expected_preset
    and provider_row.idempotency_key::text || ':' || provider_row.participant_epoch::text
      = p_provider_participant_tag
    and provider_room_row.state = 'ready'
    and provider_room_row.provider_meeting_id is not null
    and room_row.state = 'open'
    and session_row.live_mode = 'broadcast'
    and room_row.join_expires_at > now()
    and now() between session_row.starts_at - interval '30 minutes'
      and session_row.ends_at + interval '60 minutes'
    and public.group_critique_provider_ready()
    and not exists (select 1 from public.session_live l where l.session_id = p_session_id)
    and not private.private_session_has_blockers(p_session_id)
    and not exists (
      select 1 from public.group_critique_cleanup_jobs j
      where j.session_id = p_session_id and j.generation = p_generation
        and j.actor_id = p_actor_id and j.state <> 'complete'
    );

  if valid_completion then
    update public.group_critique_provider_participants
    set state = 'ready', provider_participant_id = p_provider_participant_id,
        provision_lease_token = null, provision_lease_expires_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation and actor_id = p_actor_id
      and provision_lease_token = p_lease_token;
    return found;
  end if;

  if provider_row.provision_lease_token = p_lease_token
    and provider_row.state in ('provisioning', 'remove_pending') then
    update public.group_critique_provider_participants
    set state = 'remove_pending', provider_participant_id = p_provider_participant_id,
        provision_lease_token = null, provision_lease_expires_at = null, updated_at = now()
    where session_id = p_session_id and generation = p_generation and actor_id = p_actor_id;
  end if;
  if has_provider_room and provider_room_row.provider_meeting_id is not null then
    perform private.group_critique_queue_cleanup(
      p_session_id, p_generation, p_actor_id, provider_room_row.provider_meeting_id,
      p_provider_participant_id, 'delete_participant', 'stale_participant_create',
      p_provider_participant_tag
    );
  end if;
  return false;
end;
$$;

create function public.authorize_group_critique_join(
  p_session_id uuid,
  p_generation bigint,
  p_actor_id uuid,
  p_expected_epoch bigint
)
returns table (
  provider_meeting_id text,
  provider_participant_id text,
  preset text,
  can_publish_audio boolean,
  can_publish_video boolean,
  muted boolean,
  token_expires_at timestamptz,
  participant_epoch bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.calendar_sessions;
  room_row public.group_critique_rooms;
  member_row public.group_critique_members;
  provider_room_row public.group_critique_provider_rooms;
  provider_row public.group_critique_provider_participants;
  actor_kind_value text;
  epoch_value bigint := 0;
  camera_value boolean := false;
  microphone_value boolean := false;
  muted_value boolean := false;
  preset_value text;
begin
  if not public.group_critique_provider_ready() then return; end if;
  select * into session_row from public.calendar_sessions s
  where s.id = p_session_id for update;
  if not found then return; end if;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or room_row.state <> 'open' or session_row.live_mode <> 'broadcast'
    or room_row.join_expires_at <= now()
    or now() < session_row.starts_at - interval '30 minutes'
    or now() > session_row.ends_at + interval '60 minutes'
    or exists (select 1 from public.session_live l where l.session_id = p_session_id)
    or private.private_session_has_blockers(p_session_id) then
    return;
  end if;
  if p_actor_id = session_row.coach_id and private.has_role(p_actor_id, 'coach') then
    actor_kind_value := 'coach';
    preset_value := 'host';
    camera_value := true;
    microphone_value := true;
  elsif private.has_role(p_actor_id, 'member') and exists (
    select 1 from public.session_invites i
    where i.session_id = p_session_id and i.member_id = p_actor_id
  ) then
    actor_kind_value := 'member';
    select * into member_row from public.group_critique_members m
    where m.session_id = p_session_id and m.generation = p_generation and m.member_id = p_actor_id
    for update;
    if not found or member_row.membership_state <> 'eligible' then return; end if;
    epoch_value := member_row.participant_epoch;
    camera_value := member_row.camera_allowed;
    microphone_value := member_row.microphone_allowed;
    muted_value := member_row.coach_muted;
    preset_value := case when camera_value and microphone_value then 'can_request' else 'not_allowed' end;
  else
    return;
  end if;
  if epoch_value <> p_expected_epoch then return; end if;

  select * into provider_room_row from public.group_critique_provider_rooms r
  where r.session_id = p_session_id and r.generation = p_generation for update;
  if not found or provider_room_row.state <> 'ready'
    or provider_room_row.provider_meeting_id is null then return; end if;
  select * into provider_row from public.group_critique_provider_participants p
  where p.session_id = p_session_id and p.generation = p_generation and p.actor_id = p_actor_id
  for update;
  if not found or provider_row.state <> 'ready'
    or provider_row.provider_participant_id is null
    or provider_row.preset <> preset_value
    or provider_row.participant_epoch <> epoch_value
    or provider_row.actor_kind <> actor_kind_value
    or exists (
      select 1 from public.group_critique_cleanup_jobs j
      where j.session_id = p_session_id and j.generation = p_generation
        and j.actor_id = p_actor_id and j.state <> 'complete'
    ) then
    return;
  end if;
  muted_value := case when actor_kind_value = 'member' then muted_value else false end;
  return query select provider_room_row.provider_meeting_id,
    provider_row.provider_participant_id, provider_row.preset,
    camera_value, microphone_value, muted_value,
    room_row.join_expires_at, epoch_value;
end;
$$;

create function public.claim_group_critique_cleanup(
  p_account_id text,
  p_app_id text,
  p_limit integer default 20,
  p_session_id uuid default null,
  p_actor_id uuid default null
)
returns table (
  job_id uuid,
  session_id uuid,
  generation bigint,
  provider_meeting_id text,
  provider_participant_id text,
  action text,
  provider_meeting_tag text,
  provider_participant_tag text,
  lease_token uuid,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.group_critique_runtime;
  expiry_row record;
  room_row public.group_critique_rooms;
  provider_room_row public.group_critique_provider_rooms;
  provider_participant_row public.group_critique_provider_participants;
  lease_until timestamptz;
begin
  if p_limit < 1 or p_limit > 50 then
    raise exception 'Cleanup batch size must be between 1 and 50' using errcode = '22023';
  end if;
  select * into runtime_row from public.group_critique_runtime r where r.id is true;
  if not found or runtime_row.cloudflare_account_id is distinct from lower(p_account_id)
    or runtime_row.realtimekit_app_id is distinct from p_app_id then
    raise exception 'Cleanup account or app does not match the bound provider'
      using errcode = '42501';
  end if;

  -- If the request died after the auth RPC but before the meeting claim, no provider request could
  -- have started. Retire that empty provisioning row after the same lease-plus-grace window.
  for expiry_row in
    select r.session_id, r.generation
    from public.group_critique_rooms r
    where r.state = 'provisioning'
      and r.created_at <= now() - interval '3 minutes'
      and (p_session_id is null or r.session_id = p_session_id)
      and not exists (
        select 1 from public.group_critique_provider_rooms pr
        where pr.session_id = r.session_id and pr.generation = r.generation
      )
    order by r.created_at
    limit p_limit
  loop
    perform 1 from public.calendar_sessions s where s.id = expiry_row.session_id for update;
    select * into room_row from public.group_critique_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    if found and room_row.state = 'provisioning'
      and room_row.created_at <= now() - interval '3 minutes'
      and not exists (
        select 1 from public.group_critique_provider_rooms pr
        where pr.session_id = expiry_row.session_id and pr.generation = expiry_row.generation
      ) then
      update public.group_critique_rooms
      set state = 'ended', ended_at = now()
      where session_id = expiry_row.session_id and generation = expiry_row.generation;
    end if;
  end loop;

  -- Close rooms whose fresh-join window ended. Existing tokens already expire at join_expires_at.
  for expiry_row in
    select r.session_id, r.generation
    from public.group_critique_rooms r
    where r.state = 'open' and r.join_expires_at <= now()
      and (p_session_id is null or r.session_id = p_session_id)
    order by r.join_expires_at
    limit p_limit
  loop
    perform 1 from public.calendar_sessions s where s.id = expiry_row.session_id for update;
    select * into room_row from public.group_critique_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    if found and room_row.state = 'open' and room_row.join_expires_at <= now() then
      perform private.group_critique_begin_end(
        expiry_row.session_id, expiry_row.generation, 'room_join_window_expired'
      );
    end if;
  end loop;

  -- Reconcile unknown meeting creates only after the provision lease plus a one-minute bounded
  -- request grace. A deterministic custom meeting tag lets the worker list every exact match.
  for expiry_row in
    select r.session_id, r.generation
    from public.group_critique_provider_rooms r
    where r.state = 'provisioning'
      and r.provision_lease_expires_at <= now() - interval '1 minute'
      and (p_session_id is null or r.session_id = p_session_id)
    order by r.provision_lease_expires_at
    limit p_limit
  loop
    perform 1 from public.calendar_sessions s where s.id = expiry_row.session_id for update;
    select * into room_row from public.group_critique_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    select * into provider_room_row from public.group_critique_provider_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    if found and provider_room_row.state = 'provisioning'
      and provider_room_row.provision_lease_expires_at <= now() - interval '1 minute' then
      update public.group_critique_provider_rooms pr
      set state = 'ending', provision_lease_token = null,
          provision_lease_expires_at = null, updated_at = now()
      where pr.session_id = expiry_row.session_id and pr.generation = expiry_row.generation;
      update public.group_critique_rooms r
      set state = 'ending'
      where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
        and r.state = 'provisioning';
      perform private.group_critique_queue_cleanup(
        expiry_row.session_id, expiry_row.generation, null, null, null,
        'reconcile_meeting', 'meeting_provision_lease_expired'
      );
    end if;
  end loop;

  -- An unknown participant-create response is reconciled by its persisted custom participant ID.
  for expiry_row in
    select p.session_id, p.generation, p.actor_id
    from public.group_critique_provider_participants p
    where p.state in ('provisioning', 'remove_pending')
      and p.provider_participant_id is null
      and p.provision_lease_token is not null
      and p.provision_lease_expires_at <= now() - interval '1 minute'
      and (p_session_id is null or p.session_id = p_session_id)
      and (p_actor_id is null or p.actor_id = p_actor_id)
    order by p.provision_lease_expires_at
    limit p_limit
  loop
    perform 1 from public.calendar_sessions s where s.id = expiry_row.session_id for update;
    select * into room_row from public.group_critique_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    select * into provider_room_row from public.group_critique_provider_rooms r
    where r.session_id = expiry_row.session_id and r.generation = expiry_row.generation
    for update skip locked;
    select * into provider_participant_row from public.group_critique_provider_participants p
    where p.session_id = expiry_row.session_id and p.generation = expiry_row.generation
      and p.actor_id = expiry_row.actor_id
    for update skip locked;
    if found and provider_participant_row.state in ('provisioning', 'remove_pending')
      and provider_participant_row.provider_participant_id is null
      and provider_participant_row.provision_lease_token is not null
      and provider_participant_row.provision_lease_expires_at <= now() - interval '1 minute'
      and provider_room_row.state in ('ready', 'ending')
      and provider_room_row.provider_meeting_id is not null then
      update public.group_critique_provider_participants p
      set state = 'remove_pending', provision_lease_token = null,
          provision_lease_expires_at = null, updated_at = now()
      where p.session_id = expiry_row.session_id and p.generation = expiry_row.generation
        and p.actor_id = expiry_row.actor_id;
      perform private.group_critique_queue_cleanup(
        expiry_row.session_id, expiry_row.generation, expiry_row.actor_id,
        provider_room_row.provider_meeting_id, null,
        'reconcile_participant', 'participant_provision_lease_expired'
      );
    end if;
  end loop;

  lease_until := now() + interval '2 minutes';
  return query
  with todo as (
    select j.job_id
    from public.group_critique_cleanup_jobs j
    where j.provider_account_id = runtime_row.cloudflare_account_id
      and j.realtimekit_app_id = runtime_row.realtimekit_app_id
      and (p_session_id is null or j.session_id = p_session_id)
      and (p_actor_id is null or j.actor_id = p_actor_id)
      and ((j.state = 'pending' and j.available_at <= now())
        or (j.state = 'claimed' and j.lease_expires_at <= now()))
    -- Ending the provider meeting invalidates every participant token immediately, so prioritize
    -- it ahead of individual DELETEs when one room shutdown created a large cleanup batch.
    order by case when j.action in ('end_meeting', 'reconcile_meeting') then 0 else 1 end,
      j.available_at, j.queued_at, j.job_id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.group_critique_cleanup_jobs j
    set state = 'claimed', attempts = j.attempts + 1,
        lease_token = gen_random_uuid(), lease_expires_at = lease_until
    from todo t where j.job_id = t.job_id
    returning j.job_id, j.session_id, j.generation, j.provider_meeting_id,
      j.provider_participant_id, j.action, j.provider_meeting_tag,
      j.provider_participant_tag, j.lease_token, j.lease_expires_at
  )
  select c.job_id, c.session_id, c.generation, c.provider_meeting_id,
    c.provider_participant_id, c.action, c.provider_meeting_tag,
    c.provider_participant_tag, c.lease_token, c.lease_expires_at
  from claimed c;
end;
$$;

create function public.complete_group_critique_cleanup(
  p_account_id text,
  p_app_id text,
  p_job_id uuid,
  p_lease_token uuid,
  p_success boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  runtime_row public.group_critique_runtime;
  job_row public.group_critique_cleanup_jobs;
  locked_job public.group_critique_cleanup_jobs;
  room_row public.group_critique_rooms;
  provider_room_row public.group_critique_provider_rooms;
  participant_row public.group_critique_provider_participants;
  existing_session public.calendar_sessions;
  retired_rows integer := 0;
begin
  select * into runtime_row from public.group_critique_runtime r where r.id is true;
  if not found or runtime_row.cloudflare_account_id is distinct from lower(p_account_id)
    or runtime_row.realtimekit_app_id is distinct from p_app_id then
    raise exception 'Cleanup account or app does not match the bound provider'
      using errcode = '42501';
  end if;
  select * into job_row from public.group_critique_cleanup_jobs j where j.job_id = p_job_id;
  if not found then return false; end if;

  select * into existing_session from public.calendar_sessions s
  where s.id = job_row.session_id for update;
  select * into room_row from public.group_critique_rooms r
  where r.session_id = job_row.session_id and r.generation = job_row.generation for update;
  if job_row.actor_id is not null then
    perform 1 from public.group_critique_members m
    where m.session_id = job_row.session_id and m.generation = job_row.generation
      and m.member_id = job_row.actor_id for update;
  end if;
  select * into provider_room_row from public.group_critique_provider_rooms r
  where r.session_id = job_row.session_id and r.generation = job_row.generation for update;
  if job_row.actor_id is not null then
    select * into participant_row from public.group_critique_provider_participants p
    where p.session_id = job_row.session_id and p.generation = job_row.generation
      and p.actor_id = job_row.actor_id for update;
  end if;
  select * into locked_job from public.group_critique_cleanup_jobs j
  where j.job_id = p_job_id for update;
  if not found or locked_job.state <> 'claimed'
    or locked_job.lease_token is distinct from p_lease_token
    or locked_job.provider_account_id <> runtime_row.cloudflare_account_id
    or locked_job.realtimekit_app_id <> runtime_row.realtimekit_app_id then
    return false;
  end if;

  if not coalesce(p_success, false) then
    update public.group_critique_cleanup_jobs
    set state = 'pending', lease_token = null, lease_expires_at = null,
        available_at = now() + least(interval '1 hour', interval '15 seconds' * greatest(attempts, 1))
    where job_id = p_job_id and lease_token = p_lease_token;
    return found;
  end if;

  update public.group_critique_cleanup_jobs
  set state = 'complete', lease_token = null, lease_expires_at = null,
      completed_at = now()
  where job_id = p_job_id and lease_token = p_lease_token;
  if not found then return false; end if;

  if locked_job.action in ('delete_participant', 'reconcile_participant')
    and locked_job.actor_id is not null then
    update public.group_critique_provider_participants p
    set state = 'removed', provision_lease_token = null,
        provision_lease_expires_at = null, updated_at = now()
    where p.session_id = locked_job.session_id and p.generation = locked_job.generation
      and p.actor_id = locked_job.actor_id
      and (
        (locked_job.provider_participant_id is not null
          and p.provider_participant_id = locked_job.provider_participant_id)
        or (locked_job.provider_participant_tag is not null
          and p.idempotency_key::text || ':' || p.participant_epoch::text
            = locked_job.provider_participant_tag)
      );
  elsif locked_job.action in ('end_meeting', 'reconcile_meeting') then
    if locked_job.action = 'end_meeting' then
      update public.group_critique_provider_rooms r
      set state = 'removed', provision_lease_token = null,
          provision_lease_expires_at = null, updated_at = now()
      where r.session_id = locked_job.session_id and r.generation = locked_job.generation
        and r.provider_meeting_id = locked_job.provider_meeting_id;
      get diagnostics retired_rows = row_count;
    else
      update public.group_critique_provider_rooms r
      set state = 'removed', provision_lease_token = null,
          provision_lease_expires_at = null, updated_at = now()
      where r.session_id = locked_job.session_id and r.generation = locked_job.generation
        and 'gymx2-group:' || r.idempotency_key::text = locked_job.provider_meeting_tag;
      get diagnostics retired_rows = row_count;
    end if;
    if retired_rows > 0 then
      -- A confirmed permanent INACTIVE room invalidates every participant token in that meeting,
      -- including identities whose create response was lost. Late callbacks still enqueue exact
      -- deletes, but no preexisting cleanup lease can keep this closed room alive indefinitely.
      update public.group_critique_provider_participants p
      set state = 'removed', provision_lease_token = null,
          provision_lease_expires_at = null, updated_at = now()
      where p.session_id = locked_job.session_id and p.generation = locked_job.generation;
      if locked_job.action = 'end_meeting' then
        update public.group_critique_cleanup_jobs j
        set state = 'complete', lease_token = null, lease_expires_at = null,
            completed_at = coalesce(completed_at, now())
        where j.session_id = locked_job.session_id and j.generation = locked_job.generation
          and j.provider_meeting_id = locked_job.provider_meeting_id and j.state <> 'complete';
      else
        update public.group_critique_cleanup_jobs j
        set state = 'complete', lease_token = null, lease_expires_at = null,
            completed_at = coalesce(completed_at, now())
        where j.session_id = locked_job.session_id and j.generation = locked_job.generation
          and j.provider_meeting_tag = locked_job.provider_meeting_tag and j.state <> 'complete';
      end if;
    end if;
  end if;
  perform private.group_critique_maybe_finalize(locked_job.session_id, locked_job.generation);
  return true;
end;
$$;

create function private.profiles_cleanup_group_critique_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row record;
  member_row record;
begin
  for room_row in
    select r.session_id, r.generation
    from public.group_critique_rooms r
    join public.calendar_sessions s on s.id = r.session_id
    where s.coach_id = old.id and r.state in ('provisioning', 'open', 'ending')
    order by r.session_id, r.generation
  loop
    perform private.group_critique_begin_end(
      room_row.session_id, room_row.generation, 'coach_account_deleted'
    );
  end loop;
  for member_row in
    select m.session_id, m.generation
    from public.group_critique_members m
    join public.group_critique_rooms r
      on r.session_id = m.session_id and r.generation = m.generation
    where m.member_id = old.id and r.state in ('provisioning', 'open', 'ending')
    order by m.session_id, m.generation
  loop
    perform private.group_critique_remove_member(
      member_row.session_id, member_row.generation, old.id, 'member_account_deleted'
    );
  end loop;
  return old;
end;
$$;

create function private.profiles_cleanup_group_critique_after_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row record;
  member_row record;
begin
  if old.role::text = 'coach' and new.role::text <> 'coach' then
    for room_row in
      select r.session_id, r.generation
      from public.group_critique_rooms r
      join public.calendar_sessions s on s.id = r.session_id
      where s.coach_id = new.id and r.state in ('provisioning', 'open', 'ending')
      order by r.session_id, r.generation
    loop
      perform private.group_critique_begin_end(
        room_row.session_id, room_row.generation, 'coach_role_changed'
      );
    end loop;
  end if;
  if old.role::text = 'member' and new.role::text <> 'member' then
    for member_row in
      select m.session_id, m.generation
      from public.group_critique_members m
      join public.group_critique_rooms r
        on r.session_id = m.session_id and r.generation = m.generation
      where m.member_id = new.id and r.state in ('provisioning', 'open', 'ending')
      order by m.session_id, m.generation
    loop
      perform private.group_critique_remove_member(
        member_row.session_id, member_row.generation, new.id, 'member_role_changed'
      );
    end loop;
  end if;
  return new;
end;
$$;

create function private.calendar_sessions_cleanup_group_critique_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row record;
begin
  for room_row in
    select r.generation from public.group_critique_rooms r
    where r.session_id = old.id and r.state in ('provisioning', 'open', 'ending')
    order by r.generation
  loop
    perform private.group_critique_begin_end(old.id, room_row.generation, 'session_deleted');
  end loop;
  return old;
end;
$$;

create function private.coach_members_cleanup_group_critique_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row record;
begin
  for room_row in
    select r.session_id, r.generation
    from public.group_critique_rooms r
    join public.calendar_sessions s on s.id = r.session_id
    join public.session_invites i on i.session_id = s.id and i.member_id = old.member_id
    where s.coach_id = old.coach_id and r.state in ('provisioning', 'open', 'ending')
    order by r.session_id, r.generation
  loop
    perform private.group_critique_remove_member(
      room_row.session_id, room_row.generation, old.member_id, 'coach_membership_removed'
    );
  end loop;
  return old;
end;
$$;

-- Calendar guards close the race between opening a group room and legacy direct/RPC writes.
-- The invite trigger also enforces the 25-member cap under the calendar session row lock.
create function private.guard_group_critique_session_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id_to_lock uuid;
  identity_changed boolean := false;
  duplicate_invite boolean := false;
  active_group boolean := false;
  invite_count integer;
begin
  if tg_op = 'UPDATE' then
    identity_changed := new.session_id is distinct from old.session_id
      or new.member_id is distinct from old.member_id;
  end if;

  -- Lock old and new parent rows in a stable order. Concurrent invite inserts for one session
  -- serialize here, so the count below cannot admit a 26th distinct member.
  for session_id_to_lock in
    select s.id
    from public.calendar_sessions s
    where s.id = case when tg_op = 'DELETE' then old.session_id else new.session_id end
       or (tg_op = 'UPDATE' and s.id = old.session_id)
    order by s.id
    for update
  loop
    null;
  end loop;

  if tg_op = 'INSERT' then
    select exists (
      select 1 from public.session_invites i
      where i.session_id = new.session_id and i.member_id = new.member_id
    ) into duplicate_invite;
  elsif tg_op = 'UPDATE' and identity_changed then
    select exists (
      select 1 from public.session_invites i
      where i.session_id = new.session_id and i.member_id = new.member_id
        and (i.session_id, i.member_id) <> (old.session_id, old.member_id)
    ) into duplicate_invite;
  end if;

  if tg_op = 'INSERT' and not duplicate_invite then
    select exists (
      select 1 from public.group_critique_rooms r
      where r.session_id = new.session_id and r.state in ('provisioning', 'open', 'ending')
    ) into active_group;
    if active_group then
      raise exception 'Invitations cannot be added while a group critique room is active'
        using errcode = 'P0001';
    end if;
  elsif tg_op = 'UPDATE' and identity_changed then
    select exists (
      select 1 from public.group_critique_rooms r
      where r.session_id in (old.session_id, new.session_id)
        and r.state in ('provisioning', 'open', 'ending')
    ) into active_group;
    if active_group then
      raise exception 'Invitations cannot change while a group critique room is active'
        using errcode = 'P0001';
    end if;
  elsif tg_op = 'DELETE' then
    select exists (
      select 1 from public.group_critique_rooms r
      where r.session_id = old.session_id
        and r.state in ('provisioning', 'open', 'ending')
    ) into active_group;
    if active_group and exists (
      select 1 from public.group_critique_rooms r
      where r.session_id = old.session_id and r.state in ('provisioning', 'open')
    ) and not exists (
      select 1
      from public.group_critique_rooms r
      join public.group_critique_members m
        on m.session_id = r.session_id and m.generation = r.generation
      where r.session_id = old.session_id and r.state in ('provisioning', 'open')
        and m.member_id = old.member_id
        and m.membership_state = 'removed'
        and not m.camera_allowed and not m.microphone_allowed
    ) then
      raise exception 'Invitations cannot be removed until the group participant is revoked'
        using errcode = 'P0001';
    end if;
  end if;

  -- Idempotent ON CONFLICT insertion of the same invite is allowed even at capacity.
  if (tg_op = 'INSERT' and not duplicate_invite)
    or (tg_op = 'UPDATE' and identity_changed and not duplicate_invite) then
    select count(*)::integer into invite_count
    from public.session_invites i
    where i.session_id = case when tg_op = 'INSERT' then new.session_id else new.session_id end;
    if invite_count >= 25 then
      raise exception 'A session can have at most 25 invited members' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create function private.guard_group_critique_session_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.live_mode = 'broadcast'
    and old.live_mode is distinct from new.live_mode
    and (select count(*) from public.session_invites i where i.session_id = old.id) > 25 then
    raise exception 'A session can have at most 25 invited members' using errcode = 'P0001';
  end if;

  if new.coach_id is distinct from old.coach_id
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.live_mode is distinct from old.live_mode then
    if exists (
      select 1 from public.group_critique_rooms r
      where r.session_id = old.id and r.state in ('provisioning', 'open', 'ending')
    ) or exists (
      select 1 from public.group_critique_provider_rooms r
      where r.session_id = old.id and r.state <> 'removed'
    ) or exists (
      select 1 from public.group_critique_cleanup_jobs j
      where j.session_id = old.id and j.state <> 'complete'
    ) then
      raise exception 'End group critique and confirm provider cleanup before changing owner, time, or mode'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create function private.guard_group_critique_session_live_rows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_id_to_lock uuid;
begin
  for session_id_to_lock in
    select s.id from public.calendar_sessions s
    where s.id = new.session_id or (tg_op = 'UPDATE' and s.id = old.session_id)
    order by s.id
    for update
  loop
    null;
  end loop;
  if exists (
    select 1 from public.group_critique_rooms r
    where r.session_id = new.session_id and r.state in ('provisioning', 'open', 'ending')
  ) or (tg_op = 'UPDATE' and exists (
    select 1 from public.group_critique_rooms r
    where r.session_id = old.session_id and r.state in ('provisioning', 'open', 'ending')
  )) then
    raise exception 'Group critique sessions use their private provider state, not session_live'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger session_invites_group_critique_guard
before insert or update or delete on public.session_invites
for each row execute function private.guard_group_critique_session_invites();
create trigger calendar_sessions_group_critique_guard
before update of coach_id, starts_at, ends_at, live_mode on public.calendar_sessions
for each row execute function private.guard_group_critique_session_updates();
create trigger session_live_group_critique_guard
before insert or update on public.session_live
for each row execute function private.guard_group_critique_session_live_rows();

create trigger profiles_cleanup_group_critique_before_delete
before delete on public.profiles
for each row execute function private.profiles_cleanup_group_critique_before_delete();
create trigger profiles_cleanup_group_critique_after_role_change
after update of role on public.profiles
for each row execute function private.profiles_cleanup_group_critique_after_role_change();
create trigger calendar_sessions_cleanup_group_critique_before_delete
before delete on public.calendar_sessions
for each row execute function private.calendar_sessions_cleanup_group_critique_before_delete();
create trigger coach_members_cleanup_group_critique_before_delete
before delete on public.coach_members
for each row execute function private.coach_members_cleanup_group_critique_before_delete();

revoke all on function private.profiles_cleanup_group_critique_before_delete()
  from public, anon, authenticated;
revoke all on function private.profiles_cleanup_group_critique_after_role_change()
  from public, anon, authenticated;
revoke all on function private.calendar_sessions_cleanup_group_critique_before_delete()
  from public, anon, authenticated;
revoke all on function private.coach_members_cleanup_group_critique_before_delete()
  from public, anon, authenticated;

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
  ) or exists (
    select 1 from public.group_critique_rooms r
    join public.calendar_sessions s on s.id = r.session_id
    where r.session_id = target_session_id
      and s.live_mode = 'broadcast'
      and r.state = 'open'
      and r.join_expires_at > now()
  );
$$;
revoke all on function private.session_is_live(uuid) from public, anon;
grant execute on function private.session_is_live(uuid) to authenticated;

-- Trigger/helper routines are never direct RPCs.
revoke all on function private.group_critique_has_blockers(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.group_critique_member_is_current(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.group_critique_queue_cleanup(uuid, bigint, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.group_critique_remove_member(uuid, bigint, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.group_critique_begin_end(uuid, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function private.group_critique_maybe_finalize(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_group_critique_session_invites()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_group_critique_session_updates()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_group_critique_session_live_rows()
  from public, anon, authenticated, service_role;
revoke all on function private.profiles_cleanup_group_critique_before_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.profiles_cleanup_group_critique_after_role_change()
  from public, anon, authenticated, service_role;
revoke all on function private.calendar_sessions_cleanup_group_critique_before_delete()
  from public, anon, authenticated, service_role;
revoke all on function private.coach_members_cleanup_group_critique_before_delete()
  from public, anon, authenticated, service_role;

-- Authenticated users can mutate consent and room state only through actor-bound RPCs.
revoke all on function public.read_group_critique_room(uuid, bigint)
  from public, anon, service_role;
revoke all on function public.open_group_critique_room(uuid)
  from public, anon, service_role;
revoke all on function public.offer_group_critique_cameras(uuid, bigint, uuid)
  from public, anon, service_role;
revoke all on function public.accept_group_critique_offer(uuid, bigint, boolean, boolean)
  from public, anon, service_role;
revoke all on function public.decline_group_critique_offer(uuid, bigint)
  from public, anon, service_role;
revoke all on function public.set_group_critique_mute(uuid, bigint, uuid, boolean)
  from public, anon, service_role;
revoke all on function public.end_group_critique_room(uuid, bigint)
  from public, anon, service_role;
grant execute on function public.read_group_critique_room(uuid, bigint) to authenticated;
grant execute on function public.open_group_critique_room(uuid) to authenticated;
grant execute on function public.offer_group_critique_cameras(uuid, bigint, uuid) to authenticated;
grant execute on function public.accept_group_critique_offer(uuid, bigint, boolean, boolean) to authenticated;
grant execute on function public.decline_group_critique_offer(uuid, bigint) to authenticated;
grant execute on function public.set_group_critique_mute(uuid, bigint, uuid, boolean) to authenticated;
grant execute on function public.end_group_critique_room(uuid, bigint) to authenticated;

-- Service role receives explicit RPC execution but no direct table writes.
revoke all on function public.claim_group_critique_meeting(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_group_critique_meeting(uuid, bigint, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_group_critique_participant(uuid, bigint, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_group_critique_participant(uuid, bigint, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_group_critique_join(uuid, bigint, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_group_critique_cleanup(text, text, integer, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_group_critique_cleanup(text, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_group_critique_meeting(uuid, bigint) to service_role;
grant execute on function public.complete_group_critique_meeting(uuid, bigint, uuid, text) to service_role;
grant execute on function public.claim_group_critique_participant(uuid, bigint, uuid) to service_role;
grant execute on function public.complete_group_critique_participant(uuid, bigint, uuid, uuid, text, text)
  to service_role;
grant execute on function public.authorize_group_critique_join(uuid, bigint, uuid, bigint) to service_role;
grant execute on function public.claim_group_critique_cleanup(text, text, integer, uuid, uuid) to service_role;
grant execute on function public.complete_group_critique_cleanup(text, text, uuid, uuid, boolean)
  to service_role;
