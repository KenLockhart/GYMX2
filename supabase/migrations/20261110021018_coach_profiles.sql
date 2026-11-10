-- Coach Discovery PR 2: rich coach profiles with a private draft and an admin-approved public copy.
--
-- coach_profile_drafts: what the coach is editing. Only the coach and admins can read it, and the
--   coach can only change the content (data, photo), never the review status.
-- coach_profiles_public: the approved copy members see. Nobody writes it directly; it changes only
--   through review_coach_profile (admins) and unpublish_coach_profile (admins or the coach).

create table public.coach_profile_drafts (
  coach_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 100000),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'changes_requested')),
  review_note text not null default '' check (char_length(review_note) <= 1000),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.coach_profiles_public (
  coach_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  photo_path text,
  published_at timestamptz not null default now()
);

alter table public.coach_profile_drafts enable row level security;
alter table public.coach_profiles_public enable row level security;

create policy "Coaches and admins read drafts"
on public.coach_profile_drafts for select to authenticated
using (coach_id = (select auth.uid()) or (select private.is_admin()));

create policy "Coaches start their own draft"
on public.coach_profile_drafts for insert to authenticated
with check (coach_id = (select auth.uid()) and (select private.is_coach()));

create policy "Coaches edit their own draft"
on public.coach_profile_drafts for update to authenticated
using (coach_id = (select auth.uid()) and (select private.is_coach()))
with check (coach_id = (select auth.uid()));

create policy "Signed-in people read published profiles"
on public.coach_profiles_public for select to authenticated
using (true);

-- Coaches can write only the content columns; status and review fields are set by the functions.
grant select on public.coach_profile_drafts to authenticated;
grant insert (coach_id, data, photo_path) on public.coach_profile_drafts to authenticated;
grant update (data, photo_path, updated_at) on public.coach_profile_drafts to authenticated;
grant select on public.coach_profiles_public to authenticated;
grant select, insert, update, delete on public.coach_profile_drafts, public.coach_profiles_public to service_role;

-- Editing a submitted or approved profile puts it back to draft: the published copy stays as it was
-- until the new version is submitted and approved.
create function private.coach_draft_edited()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.data is distinct from old.data or new.photo_path is distinct from old.photo_path)
     and old.status in ('submitted', 'approved') then
    new.status := 'draft';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger coach_draft_edited before update on public.coach_profile_drafts
for each row execute function private.coach_draft_edited();
revoke all on function private.coach_draft_edited() from public, anon, authenticated;

-- The coach sends their draft for review. Content checks happen in the app before this is called.
create function public.submit_coach_profile()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_coach() then
    raise exception 'Only coaches can submit a profile' using errcode = '42501';
  end if;
  update public.coach_profile_drafts
  set status = 'submitted', submitted_at = now(), review_note = ''
  where coach_id = (select auth.uid()) and status in ('draft', 'changes_requested');
  if not found then
    raise exception 'There''s nothing new to submit' using errcode = 'P0001';
  end if;
end;
$$;

-- Admins approve (publishing the exact draft they reviewed) or ask for changes with a note.
create function public.review_coach_profile(target_coach_id uuid, approve boolean, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft public.coach_profile_drafts%rowtype;
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
    insert into public.coach_profiles_public (coach_id, data, photo_path, published_at)
    values (draft.coach_id, draft.data, draft.photo_path, now())
    on conflict (coach_id) do update
      set data = excluded.data, photo_path = excluded.photo_path, published_at = excluded.published_at;
  end if;
  update public.coach_profile_drafts
  set status = case when approve then 'approved' else 'changes_requested' end,
      review_note = left(coalesce(note, ''), 1000),
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where coach_id = target_coach_id;
end;
$$;

-- Takes a profile down. Admins can unpublish anyone; coaches can unpublish themselves.
create function public.unpublish_coach_profile(target_coach_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.is_admin() or target_coach_id = (select auth.uid())) then
    raise exception 'You can''t unpublish this profile' using errcode = '42501';
  end if;
  delete from public.coach_profiles_public where coach_id = target_coach_id;
  update public.coach_profile_drafts
  set status = 'draft'
  where coach_id = target_coach_id and status = 'approved';
end;
$$;

revoke all on function public.submit_coach_profile(), public.review_coach_profile(uuid, boolean, text),
  public.unpublish_coach_profile(uuid) from public, anon;
grant execute on function public.submit_coach_profile(), public.review_coach_profile(uuid, boolean, text),
  public.unpublish_coach_profile(uuid) to authenticated;

-- Profile photos: private, uploaded through one-time links the server creates and shown through
-- short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('coach-photos', 'coach-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']);
