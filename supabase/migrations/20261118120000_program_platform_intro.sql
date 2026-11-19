-- Programs created by admins belong to GYMX2 and are available to signed-in members.
-- A program intro is an explicit, creator-owned ready video preview; it does not change
-- the visibility of any other video in the library.

alter table public.programs
  add column platform_owned boolean not null default false,
  add column intro_video_id uuid references public.videos (id) on delete set null;

create index programs_intro_video_idx on public.programs (intro_video_id)
  where intro_video_id is not null;

create function private.validate_program_intro_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.intro_video_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.intro_video_id is not distinct from old.intro_video_id then
    return new;
  end if;

  if not exists (
    select 1
    from public.videos v
    where v.id = new.intro_video_id
      and v.coach_id = new.coach_id
      and v.status = 'ready'
  ) then
    raise exception 'Choose a ready video that belongs to this program creator'
      using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function private.validate_program_intro_video() from public, anon, authenticated;

create trigger programs_validate_intro_video
before insert or update of intro_video_id, coach_id on public.programs
for each row execute function private.validate_program_intro_video();

create or replace function private.can_view_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs p
    where p.id = target_program_id
      and (
        p.coach_id = (select auth.uid())
        or private.is_admin()
        or (
          p.published
          and (
            (
              p.platform_owned
              and private.has_role((select auth.uid()), 'member')
              and private.has_platform_tier((select auth.uid()), 'regular')
            )
            or (
              not p.platform_owned
              and exists (
                select 1 from public.coach_members cm
                where cm.coach_id = p.coach_id and cm.member_id = (select auth.uid())
              )
            )
          )
        )
      )
  );
$$;

drop policy "Coaches create programs" on public.programs;
create policy "Coaches and admins create owned programs"
on public.programs for insert to authenticated
with check (
  coach_id = (select auth.uid())
  and (
    (not platform_owned and private.has_role((select auth.uid()), 'coach'))
    or (platform_owned and (select private.is_admin()))
  )
);

drop policy "Coaches change their programs" on public.programs;
create policy "Creators change their programs"
on public.programs for update to authenticated
using (
  coach_id = (select auth.uid())
  and (
    (not platform_owned and private.has_role((select auth.uid()), 'coach'))
    or (platform_owned and (select private.is_admin()))
  )
)
with check (
  coach_id = (select auth.uid())
  and (
    (not platform_owned and private.has_role((select auth.uid()), 'coach'))
    or (platform_owned and (select private.is_admin()))
  )
);

drop policy "Coaches delete their programs" on public.programs;
create policy "Creators delete their programs"
on public.programs for delete to authenticated
using (
  coach_id = (select auth.uid())
  and (
    (not platform_owned and private.has_role((select auth.uid()), 'coach'))
    or (platform_owned and (select private.is_admin()))
  )
);

grant update (intro_video_id) on public.programs to authenticated;
