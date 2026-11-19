-- The session_live row contains the legacy broadcast playback URL. Keep the existing
-- coach/admin visibility and private-session contract, while requiring the member's exact
-- submitted intake grant before either broadcast or private playback metadata is readable.

create function private.member_has_intake_clearance_for_coach(p_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles member_profile
    join public.intake_coach_access access
      on access.coach_id = p_coach_id
    join public.member_intakes intake
      on intake.id = access.intake_id
     and intake.member_id = member_profile.id
    where member_profile.id = (select auth.uid())
      and member_profile.role::text = 'member'
      and exists (
        select 1 from public.profiles coach_profile
        where coach_profile.id = p_coach_id and coach_profile.role::text = 'coach'
      )
      and (
        intake.status = 'completed'
        or exists (
          select 1 from public.member_intake_history history
          where history.intake_id = intake.id
            and history.member_id = member_profile.id
        )
      )
  );
$$;
revoke all on function private.member_has_intake_clearance_for_coach(uuid)
  from public, anon, authenticated;

create or replace function private.can_read_session_live(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.calendar_sessions s
    where s.id = target_session_id
      and s.live_mode = 'broadcast'
      and (
        (select private.is_admin())
        or s.coach_id = (select auth.uid())
        or (
          (select private.in_session(s.id))
          and (select private.member_has_intake_clearance_for_coach(s.coach_id))
        )
      )
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
        or (
          g.chosen_member_id = (select auth.uid())
          and (select private.member_has_intake_clearance_for_coach(s.coach_id))
        )
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
