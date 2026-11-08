-- Live group sessions: a coach broadcasts from the browser (Cloudflare Stream WebRTC), invited
-- members watch inside GYMX2, chat live, and are counted as attending.

-- One row per session that has a live room. Only the server writes it. The secret ingest URL is
-- never stored; the server asks Cloudflare for it when the coach goes live.
create table public.session_live (
  session_id uuid primary key references public.calendar_sessions (id) on delete cascade,
  input_uid text not null unique check (char_length(input_uid) <= 64),
  playback_url text not null check (playback_url ~ '^https://' and char_length(playback_url) <= 500),
  live_started_at timestamptz,
  live_ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index live_chat_messages_session_idx on public.live_chat_messages (session_id, created_at);

create table public.session_attendance (
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index session_attendance_member_idx on public.session_attendance (member_id, joined_at);

-- True for the session's coach and its invited members.
create function private.in_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.calendar_sessions s
    where s.id = target_session_id and s.coach_id = (select auth.uid())
  ) or private.is_session_invitee(target_session_id);
$$;

-- True while the coach is broadcasting.
create function private.session_is_live(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.session_live
    where session_id = target_session_id and live_started_at is not null and live_ended_at is null
  );
$$;
revoke all on function private.in_session(uuid), private.session_is_live(uuid) from public, anon;
grant execute on function private.in_session(uuid), private.session_is_live(uuid) to authenticated;

alter table public.session_live enable row level security;
alter table public.live_chat_messages enable row level security;
alter table public.session_attendance enable row level security;

create policy "Session people and admins see the live room"
on public.session_live for select to authenticated
using ((select private.in_session(session_id)) or (select private.is_admin()));

create policy "Session people and admins read live chat"
on public.live_chat_messages for select to authenticated
using ((select private.in_session(session_id)) or (select private.is_admin()));
create policy "Session people chat while live"
on public.live_chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and (select private.in_session(session_id))
  and (select private.session_is_live(session_id))
);
create policy "Senders and the coach remove chat"
on public.live_chat_messages for delete to authenticated
using (
  sender_id = (select auth.uid())
  or exists (select 1 from public.calendar_sessions s where s.id = session_id and s.coach_id = (select auth.uid()))
);

create policy "Members, the coach and admins see attendance"
on public.session_attendance for select to authenticated
using (
  member_id = (select auth.uid())
  or exists (select 1 from public.calendar_sessions s where s.id = session_id and s.coach_id = (select auth.uid()))
  or (select private.is_admin())
);
create policy "Invited members check in while live"
on public.session_attendance for insert to authenticated
with check (
  member_id = (select auth.uid())
  and (select private.is_session_invitee(session_id))
  and (select private.session_is_live(session_id))
);

revoke all on public.session_live, public.live_chat_messages, public.session_attendance from public, anon, authenticated;
grant select on public.session_live to authenticated;
grant select, insert, delete on public.live_chat_messages to authenticated;
grant select, insert on public.session_attendance to authenticated;
grant select, insert, update, delete on public.session_live to service_role;
grant select on public.live_chat_messages, public.session_attendance to service_role;

alter publication supabase_realtime add table public.session_live, public.live_chat_messages;
