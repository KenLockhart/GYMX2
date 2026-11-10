-- Fix for 20261110021018_coach_profiles: Supabase gives anon and authenticated full rights on new
-- tables by default, so the column grants there didn't limit anything. Start from nothing and grant
-- only what each role needs.
revoke all on public.coach_profile_drafts, public.coach_profiles_public from anon, authenticated;

grant select on public.coach_profile_drafts to authenticated;
grant insert (coach_id, data, photo_path) on public.coach_profile_drafts to authenticated;
grant update (data, photo_path, updated_at) on public.coach_profile_drafts to authenticated;
grant select on public.coach_profiles_public to authenticated;
