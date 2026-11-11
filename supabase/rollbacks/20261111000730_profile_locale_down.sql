create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
begin
  insert into public.profiles (id, display_name, coach_requested)
  values (
    new.id,
    coalesce(nullif(requested_name, ''), 'New member'),
    coalesce(new.raw_user_meta_data ->> 'coach_requested', '') = 'true'
  );
  return new;
end;
$$;

revoke update (locale) on public.profiles from authenticated;
alter table public.profiles drop column locale;
