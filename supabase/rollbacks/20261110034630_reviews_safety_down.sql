-- Restores PR 7's intro functions and the original join rule, then drops PR 8's objects.
drop function if exists public.handle_coach_report(uuid, text, text);
drop function if exists public.handle_review_report(uuid, text);
drop function if exists public.block_coach(uuid);
drop policy "Members can join a coach" on public.coach_members;
create policy "Members can join a coach"
on public.coach_members for insert to authenticated
with check (
  member_id = (select auth.uid())
  and private.has_role(member_id, 'member')
  and private.has_role(coach_id, 'coach')
  and private.coach_join_mode(coach_id) <> 'paid'
);
-- Re-run open_intro_slots and book_intro from 20261110032116_coach_intros.sql after this rollback.
drop function if exists private.coach_blocked(uuid, uuid) cascade;
drop table if exists public.coach_blocks;
drop table if exists public.coach_reports;
drop table if exists public.review_reports;
drop function if exists public.reply_to_review(uuid, text);
revoke insert on public.coach_reviews from authenticated;
grant insert on public.coach_reviews to authenticated;
alter table public.coach_reviews
  drop column if exists rating_communication, drop column if exists rating_knowledge,
  drop column if exists rating_motivation, drop column if exists rating_results,
  drop column if exists rating_value, drop column if exists reply, drop column if exists replied_at;
