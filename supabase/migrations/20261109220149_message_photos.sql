-- Community PR 6: photos in direct messages.

-- 1. Sending a message with photos in one step, so the message and its photos appear together
--    (and a photo-only message is allowed). The same rules as send_message decide who may message
--    whom; photos must be in the sender's own folder of the private community-media bucket.
create function public.send_message_with_photos(other_user_id uuid, message_body text, photo_paths text[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  pair record;
  new_message_id uuid;
  body text := trim(coalesce(message_body, ''));
  paths text[] := coalesce(photo_paths, '{}');
begin
  if caller is null then
    raise exception 'Sign in to send messages' using errcode = '42501';
  end if;
  if cardinality(paths) = 0 and char_length(body) = 0 then
    raise exception 'Write a message or add a photo' using errcode = 'P0001';
  end if;
  if char_length(body) > 4000 then
    raise exception 'Use 4,000 characters or fewer' using errcode = 'P0001';
  end if;
  if cardinality(paths) > 4 then
    raise exception 'Up to 4 photos per message' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(paths) as p
    where p !~ ('^' || caller::text || '/msg-[0-9a-f-]{36}/[0-3]\.(jpg|jpeg|png|webp)$')
  ) or cardinality(paths) <> (select count(distinct p) from unnest(paths) as p) then
    raise exception 'That photo upload didn''t work' using errcode = 'P0001';
  end if;

  select * into pair from private.conversation_pair(caller, other_user_id);

  insert into public.messages (coach_id, member_id, sender_id, body)
  values (pair.pair_coach_id, pair.pair_member_id, caller, body)
  returning id into new_message_id;

  insert into public.message_attachments (message_id, path)
  select new_message_id, p from unnest(paths) with ordinality as t(p, n) order by n;

  return new_message_id;
end;
$$;
revoke all on function public.send_message_with_photos(uuid, text, text[]) from public, anon;
grant execute on function public.send_message_with_photos(uuid, text, text[]) to authenticated;

-- (Marking notifications read was already allowed in the community migration.)
