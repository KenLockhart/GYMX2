-- Daily check-ins are a paid member feature. Keep the identity, role, and New York day
-- predicates from migration 21 and add the independent platform membership entitlement gate.
-- The SELECT policy is intentionally unchanged so members retain their own history and coaches
-- retain linked-member reads after a plan expires or is revoked.
drop policy "Members save today's daily check-in"
  on public.member_daily_checkins;
create policy "Members save today's daily check-in"
on public.member_daily_checkins for insert to authenticated
with check (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
  and (select private.has_platform_tier((select auth.uid()), 'regular'))
);

drop policy "Members update today's daily check-in"
  on public.member_daily_checkins;
create policy "Members update today's daily check-in"
on public.member_daily_checkins for update to authenticated
using (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
  and (select private.has_platform_tier((select auth.uid()), 'regular'))
)
with check (
  member_id = (select auth.uid())
  and (select private.has_role((select auth.uid()), 'member'))
  and day = (select private.current_daily_checkin_day())
  and (select private.has_platform_tier((select auth.uid()), 'regular'))
);
