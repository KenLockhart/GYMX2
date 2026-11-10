-- Coach Discovery PR 4: members' compatibility questionnaire answers.
-- Private to the member. Coaches never read them; the matching engine (next PR) reads them with the
-- member's own permissions. Optional health-related answers stay here and are never shown on a profile.

create table public.member_match_preferences (
  member_id uuid primary key references public.profiles (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 20000),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.member_match_preferences enable row level security;
revoke all on public.member_match_preferences from anon, authenticated;

create policy "Members manage their own answers"
on public.member_match_preferences for all to authenticated
using (member_id = (select auth.uid()))
with check (member_id = (select auth.uid()) and private.has_role((select auth.uid()), 'member'));

grant select, insert, update, delete on public.member_match_preferences to authenticated;
grant all on public.member_match_preferences to service_role;
