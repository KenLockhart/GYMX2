-- New-member onboarding answers and coach specialties, used to suggest coaches.
alter table public.profiles
  add column goals text[] not null default '{}'
    check (goals <@ array['lose_weight','build_muscle','get_fit','mobility','eat_better','reduce_stress','sleep_better','build_habits','find_purpose','grow_spiritually']::text[]
           and cardinality(goals) <= 10),
  add column experience text check (experience in ('new', 'some', 'experienced')),
  add column focus public.pillar,
  add column onboarded_at timestamptz,
  add column specialties text[] not null default '{}'
    check (specialties <@ array['lose_weight','build_muscle','get_fit','mobility','eat_better','reduce_stress','sleep_better','build_habits','find_purpose','grow_spiritually']::text[]
           and cardinality(specialties) <= 10);

-- People edit their own answers; the existing "update own profile" policy limits it to their row.
grant update (goals, experience, focus, onboarded_at, specialties) on public.profiles to authenticated;
