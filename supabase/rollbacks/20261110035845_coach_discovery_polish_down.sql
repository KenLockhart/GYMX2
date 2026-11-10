drop index if exists public.coach_favorites_coach_idx;
drop index if exists public.coach_passes_coach_idx;
drop index if exists public.coach_blocks_coach_idx;
drop index if exists public.coach_reports_coach_idx;
drop index if exists public.review_reports_review_idx;
drop index if exists public.coach_reviews_member_idx;
-- Restore review_coach_profile from 20261110021018_coach_profiles.sql, then:
update public.coach_profiles_public
set data = data || jsonb_build_object('identity', identity) where identity is not null;
alter table public.coach_profiles_public drop column if exists identity;
