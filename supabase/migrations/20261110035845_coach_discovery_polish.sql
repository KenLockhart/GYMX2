-- Coach Discovery PR 9: keep the coach's optional identity answer out of the published profile, and
-- index the discovery tables' foreign keys.

-- 1. The identity answer lives in its own column. Signed-in users have column-level select on
--    this table (coach_id, data, photo_path, published_at), so they can't read it; only the server
--    does, to apply a member's coach-preference filter.
alter table public.coach_profiles_public
  add column identity text check (identity in ('woman', 'man', 'nonbinary'));

update public.coach_profiles_public
set identity = case when data->>'identity' in ('woman', 'man', 'nonbinary') then data->>'identity' end,
    data = data - 'identity'
where data ? 'identity';

create or replace function public.review_coach_profile(target_coach_id uuid, approve boolean, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.coach_profile_drafts%rowtype;
  coach_identity text;
begin
  if not private.is_admin() then
    raise exception 'Only admins review coach profiles' using errcode = '42501';
  end if;
  select * into draft from public.coach_profile_drafts
  where coach_id = target_coach_id and status = 'submitted'
  for update;
  if not found then
    raise exception 'This profile isn''t waiting for review' using errcode = 'P0001';
  end if;
  if approve then
    coach_identity := case
      when draft.data->>'identity' in ('woman', 'man', 'nonbinary') then draft.data->>'identity'
    end;
    insert into public.coach_profiles_public (coach_id, data, photo_path, published_at, identity)
    values (draft.coach_id, draft.data - 'identity', draft.photo_path, now(), coach_identity)
    on conflict (coach_id) do update
      set data = excluded.data, photo_path = excluded.photo_path,
          published_at = excluded.published_at, identity = excluded.identity;
  end if;
  update public.coach_profile_drafts
  set status = case when approve then 'approved' else 'changes_requested' end,
      review_note = left(coalesce(note, ''), 1000),
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where coach_id = target_coach_id;
end;
$$;

-- 2. Indexes for lookups by coach and for account deletion.
create index if not exists coach_favorites_coach_idx on public.coach_favorites (coach_id);
create index if not exists coach_passes_coach_idx on public.coach_passes (coach_id);
create index if not exists coach_blocks_coach_idx on public.coach_blocks (coach_id);
create index if not exists coach_reports_coach_idx on public.coach_reports (coach_id);
create index if not exists review_reports_review_idx on public.review_reports (review_id);
create index if not exists coach_reviews_member_idx on public.coach_reviews (member_id);
