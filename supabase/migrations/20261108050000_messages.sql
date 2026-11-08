-- GYMX2 Connect: private 1-to-1 messages between a coach and each member who joined them.
-- A conversation is a coach and member pair. Messages are only sent through send_message,
-- which checks the two are connected. Like Memos, admins have no access: these are private.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id in (coach_id, member_id)),
  check (coach_id <> member_id)
);

create index messages_pair_idx on public.messages (coach_id, member_id, created_at desc);
create index messages_member_idx on public.messages (member_id, created_at desc);
create index messages_unread_idx on public.messages (coach_id, member_id) where read_at is null;

alter table public.messages enable row level security;

create policy "People can read their own conversations"
on public.messages for select to authenticated
using (coach_id = (select auth.uid()) or member_id = (select auth.uid()));

-- Works out which side of the pair the caller is on, and only allows a connected coach and member.
create function private.conversation_pair(caller uuid, other_user_id uuid, out pair_coach_id uuid, out pair_member_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.coach_members
    where coach_id = caller and member_id = other_user_id
  ) then
    pair_coach_id := caller;
    pair_member_id := other_user_id;
  elsif exists (
    select 1 from public.coach_members
    where coach_id = other_user_id and member_id = caller
  ) then
    pair_coach_id := other_user_id;
    pair_member_id := caller;
  else
    raise exception 'You can only message your coaches and your members' using errcode = 'P0001';
  end if;
end;
$$;

create function public.send_message(other_user_id uuid, message_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  pair record;
  new_message_id uuid;
begin
  if caller is null then
    raise exception 'Sign in to send messages' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(message_body, ''))) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;

  select * into pair from private.conversation_pair(caller, other_user_id);

  insert into public.messages (coach_id, member_id, sender_id, body)
  values (pair.pair_coach_id, pair.pair_member_id, caller, trim(message_body))
  returning id into new_message_id;

  return new_message_id;
end;
$$;

-- Marks everything the other person sent in this conversation as read. The time is set here.
create function public.mark_conversation_read(other_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages
  set read_at = now()
  where read_at is null
    and sender_id = other_user_id
    and (
      (coach_id = (select auth.uid()) and member_id = other_user_id)
      or (member_id = (select auth.uid()) and coach_id = other_user_id)
    );
$$;

revoke all on public.messages from public, anon, authenticated;
grant select on public.messages to authenticated;

revoke all on function private.conversation_pair(uuid, uuid) from public, anon, authenticated;
revoke all on function public.send_message(uuid, text) from public, anon;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- New messages are pushed to open chats. Supabase Realtime applies the read policy above,
-- so each person only receives messages from their own conversations.
alter publication supabase_realtime add table public.messages;
