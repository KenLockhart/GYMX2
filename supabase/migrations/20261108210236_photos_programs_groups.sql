-- Progress photos, multi-week programs and coach group chats.

-------------------------------------------------------------------------------------------------
-- Progress photos. Private files; the server hands out short-lived links to people who may see
-- the row (the owner, or their coaches when the owner shares tracking). Admins can't see them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 10485760, array['image/png', 'image/jpeg', 'image/webp']);

create table public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  pose text not null check (pose in ('front', 'side', 'back', 'other')),
  path text not null unique check (char_length(path) <= 300),
  created_at timestamptz not null default now()
);
create index progress_photos_user_idx on public.progress_photos (user_id, day desc);

alter table public.progress_photos enable row level security;
create policy "People see their own photos; shared with coaches"
on public.progress_photos for select to authenticated using ((select private.can_view_tracking(user_id)));
create policy "People add their own photos"
on public.progress_photos for insert to authenticated
with check (user_id = (select auth.uid()) and split_part(path, '/', 1) = (select auth.uid())::text);
create policy "People remove their own photos"
on public.progress_photos for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.progress_photos from public, anon, authenticated;
grant select, insert, delete on public.progress_photos to authenticated;
grant select, delete on public.progress_photos to service_role;

-------------------------------------------------------------------------------------------------
-- Programs: a coach's plan of numbered days. Members who joined the coach can start one, and
-- one day unlocks each day after they start.
create table public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index programs_coach_idx on public.programs (coach_id, created_at desc);

create table public.program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  day_number integer not null check (day_number between 1 and 365),
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null default '' check (char_length(instructions) <= 2000),
  pillar public.pillar not null,
  video_id uuid references public.videos (id) on delete set null,
  unique (program_id, day_number)
);

create table public.program_enrollments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  started_on date not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (program_id, member_id)
);
create index program_enrollments_member_idx on public.program_enrollments (member_id);

create table public.program_day_completions (
  enrollment_id uuid not null references public.program_enrollments (id) on delete cascade,
  day_id uuid not null references public.program_days (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (enrollment_id, day_id)
);
create index program_day_completions_member_idx on public.program_day_completions (member_id, completed_at);

-- True when the signed-in person may see this program: its coach, an admin, or (once published)
-- a member who joined the coach.
create function private.can_view_program(target_program_id uuid)
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
          and exists (
            select 1 from public.coach_members cm
            where cm.coach_id = p.coach_id and cm.member_id = (select auth.uid())
          )
        )
      )
  );
$$;
revoke all on function private.can_view_program(uuid) from public;
grant execute on function private.can_view_program(uuid) to authenticated;

create function private.owns_program(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.programs where id = target_program_id and coach_id = (select auth.uid())
  );
$$;
revoke all on function private.owns_program(uuid) from public;
grant execute on function private.owns_program(uuid) to authenticated;

alter table public.programs enable row level security;
alter table public.program_days enable row level security;
alter table public.program_enrollments enable row level security;
alter table public.program_day_completions enable row level security;

create policy "Coaches, admins and their members see programs"
on public.programs for select to authenticated using ((select private.can_view_program(id)));
create policy "Coaches create programs"
on public.programs for insert to authenticated
with check (coach_id = (select auth.uid()) and private.has_role(coach_id, 'coach'));
create policy "Coaches change their programs"
on public.programs for update to authenticated
using (coach_id = (select auth.uid())) with check (coach_id = (select auth.uid()));
create policy "Coaches delete their programs"
on public.programs for delete to authenticated using (coach_id = (select auth.uid()));

create policy "People who see a program see its days"
on public.program_days for select to authenticated using ((select private.can_view_program(program_id)));
create policy "Coaches add days"
on public.program_days for insert to authenticated with check ((select private.owns_program(program_id)));
create policy "Coaches change days"
on public.program_days for update to authenticated
using ((select private.owns_program(program_id))) with check ((select private.owns_program(program_id)));
create policy "Coaches remove days"
on public.program_days for delete to authenticated using ((select private.owns_program(program_id)));

create policy "Members see their enrollments; coaches see their programs' members"
on public.program_enrollments for select to authenticated
using (member_id = (select auth.uid()) or (select private.owns_program(program_id)) or (select private.is_admin()));
create policy "Members start programs they can see"
on public.program_enrollments for insert to authenticated
with check (
  member_id = (select auth.uid())
  and (select private.can_view_program(program_id))
  -- Starting today (Eastern time, a day of slack around midnight) so days can't be unlocked early.
  and started_on between ((now() at time zone 'America/New_York')::date - 1) and (now() at time zone 'America/New_York')::date
);
create policy "Members leave programs"
on public.program_enrollments for delete to authenticated using (member_id = (select auth.uid()));

create policy "Members see their progress; coaches see their programs' progress"
on public.program_day_completions for select to authenticated
using (
  member_id = (select auth.uid())
  or exists (
    select 1 from public.program_enrollments e
    where e.id = enrollment_id and (select private.owns_program(e.program_id))
  )
);
create policy "Members complete their own days"
on public.program_day_completions for insert to authenticated
with check (
  member_id = (select auth.uid())
  and exists (
    select 1
    from public.program_enrollments e
    join public.program_days d on d.program_id = e.program_id
    where e.id = enrollment_id
      and e.member_id = (select auth.uid())
      and d.id = day_id
      -- A day unlocks once enough days have passed since starting (Eastern time).
      and d.day_number <= ((now() at time zone 'America/New_York')::date - e.started_on) + 1
  )
);
create policy "Members undo their own days"
on public.program_day_completions for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.programs, public.program_days, public.program_enrollments, public.program_day_completions
  from public, anon, authenticated;
grant select, insert, delete on public.programs to authenticated;
grant update (title, description, published, updated_at) on public.programs to authenticated;
grant select, insert, delete on public.program_days to authenticated;
grant update (day_number, title, instructions, pillar, video_id) on public.program_days to authenticated;
grant select, insert, delete on public.program_enrollments to authenticated;
grant select, insert, delete on public.program_day_completions to authenticated;
grant select on public.programs, public.program_days, public.program_enrollments, public.program_day_completions
  to service_role;

-------------------------------------------------------------------------------------------------
-- Coach group chats: one group per coach, for the coach and the members who joined them.
create table public.group_messages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index group_messages_coach_idx on public.group_messages (coach_id, created_at desc);

create function private.in_coach_group(target_coach_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_coach_id = (select auth.uid())
    or exists (
      select 1 from public.coach_members cm
      where cm.coach_id = target_coach_id and cm.member_id = (select auth.uid())
    );
$$;
revoke all on function private.in_coach_group(uuid) from public;
grant execute on function private.in_coach_group(uuid) to authenticated;

alter table public.group_messages enable row level security;
create policy "Group members and admins read the group"
on public.group_messages for select to authenticated
using ((select private.in_coach_group(coach_id)) or (select private.is_admin()));
create policy "Group members post"
on public.group_messages for insert to authenticated
with check (sender_id = (select auth.uid()) and (select private.in_coach_group(coach_id)));
create policy "People delete their own posts; coaches moderate their group"
on public.group_messages for delete to authenticated
using (sender_id = (select auth.uid()) or coach_id = (select auth.uid()));

revoke all on public.group_messages from public, anon, authenticated;
grant select, insert, delete on public.group_messages to authenticated;
grant select on public.group_messages to service_role;

alter publication supabase_realtime add table public.group_messages;
