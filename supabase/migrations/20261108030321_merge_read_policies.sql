-- GYMX2: one read policy per table for profiles and memos.
-- Postgres runs every permissive policy for each row it checks, so several read policies on one table
-- slow every query down. The rules are unchanged: each old policy is now one branch of an OR.

drop policy "Users can read their own profile" on public.profiles;
drop policy "Signed-in users can read coach profiles" on public.profiles;
drop policy "Admins can read all profiles" on public.profiles;
drop policy "Coaches can read members who joined them" on public.profiles;

create policy "Signed-in users can read the profiles open to them"
on public.profiles for select to authenticated
using (
  -- Their own profile.
  id = (select auth.uid())
  -- Any coach, so members can find one to join.
  or role = 'coach'
  -- Everyone, for admins.
  or (select private.is_admin())
  -- A coach's own members.
  or exists (
    select 1 from public.coach_members cm
    where cm.member_id = profiles.id and cm.coach_id = (select auth.uid())
  )
);

-- "People manage their own Memos" covered every action, so it overlapped the coaches' read policy.
-- It is split up so reading has a single policy and writing keeps the same owner-only rule.
drop policy "People manage their own Memos" on public.memos;
drop policy "Coaches can read Memos shared by their members" on public.memos;

-- Admins deliberately have no branch here, so a private Memo stays private from them too.
create policy "People can read their own Memos and ones shared with them"
on public.memos for select to authenticated
using (
  user_id = (select auth.uid())
  or (
    shared_with_coaches
    and exists (
      select 1 from public.coach_members cm
      where cm.member_id = memos.user_id and cm.coach_id = (select auth.uid())
    )
  )
);

create policy "People can add their own Memos"
on public.memos for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "People can edit their own Memos"
on public.memos for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "People can delete their own Memos"
on public.memos for delete to authenticated
using (user_id = (select auth.uid()));
