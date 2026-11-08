-- GYMX2: admins can read conversations, so they can step in if a coach tries to take members off GYMX2.
-- Coaches and members are told on the Messages page that admins may review conversations.
-- Admins still can't send or change messages: send_message only works for a connected coach and member.

drop policy "People can read their own conversations" on public.messages;

create policy "People can read their own conversations, and admins can review them"
on public.messages for select to authenticated
using (
  coach_id = (select auth.uid())
  or member_id = (select auth.uid())
  or (select private.is_admin())
);
