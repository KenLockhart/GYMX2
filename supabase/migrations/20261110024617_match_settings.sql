-- Coach Discovery PR 5: the matching weights, editable by admins. One row.
create table public.match_settings (
  id boolean primary key default true check (id),
  weights jsonb not null default '{"goals":25,"personality":20,"schedule":15,"communication":15,"experience":15,"budget":10}'::jsonb
    check (jsonb_typeof(weights) = 'object'),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.match_settings (id) values (true);

alter table public.match_settings enable row level security;
revoke all on public.match_settings from anon, authenticated;

create policy "Signed-in people read match weights"
on public.match_settings for select to authenticated using (true);
create policy "Admins change match weights"
on public.match_settings for update to authenticated
using ((select private.is_admin())) with check ((select private.is_admin()));

grant select on public.match_settings to authenticated;
grant update (weights, updated_by, updated_at) on public.match_settings to authenticated;
grant all on public.match_settings to service_role;
