-- Each person's language for the coach and member screens (and, later, their emails): English or
-- Latin American Spanish. Chosen at sign-up and changed from the menu.
alter table public.profiles
  add column locale text not null default 'en'
  constraint profiles_locale_check check (locale in ('en', 'es'));

grant update (locale) on public.profiles to authenticated;

-- New accounts take the language picked on the sign-up form.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text := left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80);
  requested_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, display_name, coach_requested, locale)
  values (
    new.id,
    coalesce(nullif(requested_name, ''), 'New member'),
    coalesce(new.raw_user_meta_data ->> 'coach_requested', '') = 'true',
    case when requested_locale in ('en', 'es') then requested_locale else 'en' end
  );
  return new;
end;
$$;
