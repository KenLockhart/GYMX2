-- Empty the coach-photos bucket in the dashboard first (storage objects can't be dropped in SQL).
delete from storage.buckets where id = 'coach-photos';
drop function if exists public.unpublish_coach_profile(uuid);
drop function if exists public.review_coach_profile(uuid, boolean, text);
drop function if exists public.submit_coach_profile();
drop table if exists public.coach_profiles_public;
drop table if exists public.coach_profile_drafts;
drop function if exists private.coach_draft_edited();

-- Also undo the grants fix (20261110021057) by dropping the tables above.
