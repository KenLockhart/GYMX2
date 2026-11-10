-- Signed-in users had table-wide select on coach_profiles_public, which included the new identity
-- column. Limit them to the published columns; only the server reads identity.
revoke select on public.coach_profiles_public from authenticated, anon;
grant select (coach_id, data, photo_path, published_at) on public.coach_profiles_public to authenticated;
