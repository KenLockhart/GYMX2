-- Member intake is private health data. Draft writes and coach access are mediated by
-- authenticated functions; coaches only see submitted answers after the member grants access.

create function private.intake_json_text_valid(
  p_value jsonb,
  p_key text,
  p_max_length integer,
  p_required boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if not (p_value ? p_key) then
    return not p_required;
  end if;
  if jsonb_typeof(p_value -> p_key) <> 'string' then
    return false;
  end if;
  v_text := p_value ->> p_key;
  return char_length(v_text) <= p_max_length
    and (not p_required or char_length(btrim(v_text)) > 0);
end;
$$;

create function private.intake_json_number_valid(
  p_value jsonb,
  p_key text,
  p_min numeric,
  p_max numeric,
  p_required boolean default false,
  p_integer boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_number numeric;
begin
  if not (p_value ? p_key) then
    return not p_required;
  end if;
  if jsonb_typeof(p_value -> p_key) <> 'number' then
    return false;
  end if;
  v_number := (p_value ->> p_key)::numeric;
  return v_number between p_min and p_max
    and (not p_integer or v_number = trunc(v_number));
end;
$$;

create function private.intake_json_enum_valid(
  p_value jsonb,
  p_key text,
  p_allowed text[],
  p_required boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  if not (p_value ? p_key) then
    return not p_required;
  end if;
  return jsonb_typeof(p_value -> p_key) = 'string'
    and (p_value ->> p_key) = any (p_allowed);
end;
$$;

create function private.intake_json_array_valid(
  p_value jsonb,
  p_key text,
  p_allowed text[],
  p_max_items integer,
  p_required boolean default false
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer;
  v_unique_count integer;
begin
  if not (p_value ? p_key) then
    return not p_required;
  end if;
  if jsonb_typeof(p_value -> p_key) <> 'array' then
    return false;
  end if;

  select count(*), count(distinct e.value #>> '{}')
  into v_count, v_unique_count
  from jsonb_array_elements(p_value -> p_key) e(value);

  if v_count > p_max_items or v_count <> v_unique_count then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_value -> p_key) e(value)
    where jsonb_typeof(e.value) <> 'string'
      or (e.value #>> '{}') <> all (p_allowed)
  );
end;
$$;

create function private.member_intake_answers_valid(p_answers jsonb, p_complete boolean)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_injury jsonb;
  v_allowed_keys text[] := array[
    'age', 'sex', 'height_in', 'current_weight_lbs', 'highest_adult_weight_lbs',
    'lowest_adult_weight_lbs', 'goal_weight_lbs', 'waist_in', 'regain_causes',
    'regain_causes_other', 'what_worked_before', 'what_worked_before_other',
    'coached_before', 'coached_before_notes', 'injuries', 'exercise_clearance',
    'medical_notes', 'interested_in_medication_consult', 'training_location',
    'equipment', 'training_days_per_week', 'session_minutes', 'work_type',
    'sleep_hours', 'sugary_drinks_per_day', 'sugary_drink_types',
    'alcohol_drinks_per_week', 'eating_pattern', 'activity_level', 'food_allergies',
    'food_allergies_other', 'foods_avoided', 'dietary_style', 'dietary_style_other',
    'batch_cooking', 'grocery_budget_weekly', 'meals_per_day', 'plan_style',
    'checkin_preference', 'stress_level', 'stress_coping', 'wants_support_resources',
    'main_why'
  ];
begin
  if p_answers is null
    or jsonb_typeof(p_answers) <> 'object'
    or octet_length(p_answers::text) > 65536
  then
    return false;
  end if;

  for v_key in select jsonb_object_keys(p_answers)
  loop
    if not (v_key = any (v_allowed_keys)) then
      return false;
    end if;
  end loop;

  if p_complete and exists (
    select 1
    from unnest(array[
      'age', 'sex', 'height_in', 'current_weight_lbs', 'exercise_clearance',
      'training_location', 'training_days_per_week', 'session_minutes', 'work_type',
      'sleep_hours', 'sugary_drinks_per_day', 'eating_pattern', 'activity_level',
      'dietary_style', 'batch_cooking', 'meals_per_day', 'plan_style',
      'checkin_preference', 'stress_level', 'main_why'
    ]) required_key
    where not (p_answers ? required_key)
  ) then
    return false;
  end if;

  if not private.intake_json_number_valid(p_answers, 'age', 18, 100, p_complete, true)
    or not private.intake_json_enum_valid(p_answers, 'sex', array['male', 'female', 'prefer_not_to_say'], p_complete)
    or not private.intake_json_number_valid(p_answers, 'height_in', 36, 96, p_complete)
    or not private.intake_json_number_valid(p_answers, 'current_weight_lbs', 40, 900, p_complete)
    or not private.intake_json_number_valid(p_answers, 'highest_adult_weight_lbs', 40, 900)
    or not private.intake_json_number_valid(p_answers, 'lowest_adult_weight_lbs', 40, 900)
    or not private.intake_json_number_valid(p_answers, 'goal_weight_lbs', 40, 900)
    or not private.intake_json_number_valid(p_answers, 'waist_in', 10, 100)
    or not private.intake_json_array_valid(p_answers, 'regain_causes', array['stress', 'work_schedule', 'life_changes', 'travel', 'injury', 'stopped_tracking', 'other'], 7)
    or not private.intake_json_text_valid(p_answers, 'regain_causes_other', 300)
    or not private.intake_json_array_valid(p_answers, 'what_worked_before', array['better_nutrition', 'a_coach', 'a_gym_routine', 'a_specific_diet', 'medication', 'nothing_yet', 'other'], 7)
    or not private.intake_json_text_valid(p_answers, 'what_worked_before_other', 300)
    or not private.intake_json_enum_valid(p_answers, 'coached_before', array['yes', 'no'])
    or not private.intake_json_text_valid(p_answers, 'coached_before_notes', 1000)
    or not private.intake_json_enum_valid(p_answers, 'exercise_clearance', array['yes', 'no', 'not_sure'], p_complete)
    or not private.intake_json_text_valid(p_answers, 'medical_notes', 2000)
    or not private.intake_json_enum_valid(p_answers, 'interested_in_medication_consult', array['yes', 'no', 'maybe'])
    or not private.intake_json_enum_valid(p_answers, 'training_location', array['home_gym', 'commercial_gym', 'both', 'no_equipment'], p_complete)
    or not private.intake_json_array_valid(p_answers, 'equipment', array['dumbbells', 'kettlebells', 'barbell_and_rack', 'cable_machine', 'leg_press', 'hack_squat', 'preacher_curl_bench', 'rower', 'upright_or_recumbent_bike', 'arm_bike', 'total_body_machine', 'resistance_bands', 'pool_access'], 13)
    or not private.intake_json_number_valid(p_answers, 'training_days_per_week', 2, 6, p_complete, true)
    or not private.intake_json_number_valid(p_answers, 'session_minutes', 20, 60, p_complete, true)
    or not private.intake_json_enum_valid(p_answers, 'work_type', array['desk', 'on_feet', 'mixed', 'physical_labor'], p_complete)
    or not private.intake_json_number_valid(p_answers, 'sleep_hours', 3, 12, p_complete)
    or not private.intake_json_enum_valid(p_answers, 'sugary_drinks_per_day', array['0', '1', '2-3', '4+'], p_complete)
    or not private.intake_json_array_valid(p_answers, 'sugary_drink_types', array['soda', 'juice', 'sweet_tea', 'energy_drinks', 'other'], 5)
    or not private.intake_json_number_valid(p_answers, 'alcohol_drinks_per_week', 0, 100)
    or not private.intake_json_array_valid(p_answers, 'eating_pattern', array['regular_meals', 'eat_when_i_remember', 'skip_breakfast', 'graze_all_day', 'late_night_eating'], 5, p_complete)
    or not private.intake_json_enum_valid(p_answers, 'activity_level', array['sedentary', 'light', 'moderate', 'active'], p_complete)
    or not private.intake_json_array_valid(p_answers, 'food_allergies', array['milk', 'eggs', 'fish', 'shellfish', 'tree_nuts', 'peanuts', 'wheat', 'soy', 'sesame', 'other'], 10)
    or not private.intake_json_text_valid(p_answers, 'food_allergies_other', 300)
    or not private.intake_json_text_valid(p_answers, 'foods_avoided', 1000)
    or not private.intake_json_enum_valid(p_answers, 'dietary_style', array['no_preference', 'no_pork', 'pescatarian', 'vegetarian', 'vegan', 'other'], p_complete)
    or not private.intake_json_text_valid(p_answers, 'dietary_style_other', 100)
    or not private.intake_json_enum_valid(p_answers, 'batch_cooking', array['twice_weekly', 'once_weekly', 'quick_meals_only'], p_complete)
    or not private.intake_json_enum_valid(p_answers, 'grocery_budget_weekly', array['under_50', '50_to_100', '100_to_150', 'over_150'])
    or not private.intake_json_enum_valid(p_answers, 'meals_per_day', array['2', '3', '3_plus_snack'], p_complete)
    or not private.intake_json_enum_valid(p_answers, 'plan_style', array['simple_rules', 'detailed_tracking', 'in_between'], p_complete)
    or not private.intake_json_enum_valid(p_answers, 'checkin_preference', array['daily_app_prompt', 'weekly_coach_call', 'text_message', 'none'], p_complete)
    or not private.intake_json_number_valid(p_answers, 'stress_level', 1, 10, p_complete, true)
    or not private.intake_json_text_valid(p_answers, 'stress_coping', 1000)
    or not private.intake_json_enum_valid(p_answers, 'wants_support_resources', array['yes', 'no'])
    or not private.intake_json_text_valid(p_answers, 'main_why', 200, p_complete)
  then
    return false;
  end if;

  if p_answers ? 'session_minutes'
    and (p_answers ->> 'session_minutes')::integer not in (20, 30, 45, 60)
  then return false; end if;
  if p_answers ? 'sleep_hours'
    and (p_answers ->> 'sleep_hours')::numeric * 2 <> trunc((p_answers ->> 'sleep_hours')::numeric * 2)
  then return false; end if;
  if p_complete and jsonb_array_length(p_answers -> 'eating_pattern') < 1
  then return false; end if;

  if p_complete and char_length(btrim(coalesce(p_answers ->> 'main_why', ''))) = 0 then
    return false;
  end if;
  if p_answers ? 'regain_causes'
    and p_answers -> 'regain_causes' @> '["other"]'::jsonb
    and not private.intake_json_text_valid(p_answers, 'regain_causes_other', 300, true)
  then return false; end if;
  if p_answers ? 'what_worked_before'
    and p_answers -> 'what_worked_before' @> '["other"]'::jsonb
    and not private.intake_json_text_valid(p_answers, 'what_worked_before_other', 300, true)
  then return false; end if;
  if p_answers ->> 'dietary_style' = 'other'
    and not private.intake_json_text_valid(p_answers, 'dietary_style_other', 100, true)
  then return false; end if;
  if p_answers ? 'food_allergies'
    and p_answers -> 'food_allergies' @> '["other"]'::jsonb
    and not private.intake_json_text_valid(p_answers, 'food_allergies_other', 300, true)
  then return false; end if;

  if p_answers ? 'lowest_adult_weight_lbs'
    and p_answers ? 'highest_adult_weight_lbs'
    and (p_answers ->> 'lowest_adult_weight_lbs')::numeric > (p_answers ->> 'highest_adult_weight_lbs')::numeric
  then return false; end if;
  if p_answers ? 'goal_weight_lbs'
    and p_answers ? 'current_weight_lbs'
    and (p_answers ->> 'goal_weight_lbs')::numeric > (p_answers ->> 'current_weight_lbs')::numeric
  then return false; end if;

  if p_answers ? 'injuries' then
    if jsonb_typeof(p_answers -> 'injuries') <> 'array'
      or jsonb_array_length(p_answers -> 'injuries') > 20
    then return false; end if;
    for v_injury in select value from jsonb_array_elements(p_answers -> 'injuries') e(value)
    loop
      if jsonb_typeof(v_injury) <> 'object'
        or exists (
          select 1 from jsonb_object_keys(v_injury) injury_key
          where injury_key not in ('body_part', 'body_part_other', 'restriction', 'duration')
        )
        or not private.intake_json_enum_valid(v_injury, 'body_part', array['neck', 'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right', 'wrist_left', 'wrist_right', 'lower_back', 'hip_left', 'hip_right', 'knee_left', 'knee_right', 'ankle_left', 'ankle_right', 'foot_left', 'foot_right', 'other'], true)
        or not private.intake_json_enum_valid(v_injury, 'restriction', array['no_weight_bearing', 'no_impact', 'limited_range_of_motion', 'pain_only'], true)
        or not private.intake_json_enum_valid(v_injury, 'duration', array['under_6_months', '6_to_24_months', '2_plus_years'], true)
        or not private.intake_json_text_valid(v_injury, 'body_part_other', 100)
      then return false; end if;
      if v_injury ->> 'body_part' = 'other'
        and not private.intake_json_text_valid(v_injury, 'body_part_other', 100, true)
      then return false; end if;
    end loop;
  end if;

  return true;
end;
$$;

create table public.member_intakes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null unique references public.profiles (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  current_step smallint not null default 1 check (current_step between 1 and 8),
  answers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 65536),
  current_weight_lbs numeric(6, 2),
  height_in numeric(5, 2),
  age smallint,
  training_location text,
  plan_style text,
  consent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'completed' and consent_at is not null and completed_at is not null
      and current_weight_lbs is not null and height_in is not null and age is not null
      and training_location is not null and plan_style is not null)
    or status = 'draft'
  )
);
create index member_intakes_status_idx on public.member_intakes (status, updated_at desc);

create table public.member_intake_injuries (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.member_intakes (id) on delete cascade,
  body_part text not null check (body_part in (
    'neck', 'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
    'wrist_left', 'wrist_right', 'lower_back', 'hip_left', 'hip_right',
    'knee_left', 'knee_right', 'ankle_left', 'ankle_right', 'foot_left', 'foot_right', 'other'
  )),
  body_part_other text check (body_part_other is null or char_length(body_part_other) <= 100),
  restriction text not null check (restriction in (
    'no_weight_bearing', 'no_impact', 'limited_range_of_motion', 'pain_only'
  )),
  duration text not null check (duration in ('under_6_months', '6_to_24_months', '2_plus_years')),
  created_at timestamptz not null default now(),
  check (body_part <> 'other' or nullif(btrim(body_part_other), '') is not null)
);
create index member_intake_injuries_intake_idx on public.member_intake_injuries (intake_id);

create table public.intake_coach_access (
  intake_id uuid not null references public.member_intakes (id) on delete cascade,
  coach_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid not null,
  granted_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  primary key (intake_id, coach_id)
);
create index intake_coach_access_coach_idx on public.intake_coach_access (coach_id, intake_id);

create table public.member_intake_history (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.member_intakes (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'object' and octet_length(answers::text) <= 65536),
  consent_at timestamptz not null,
  completed_at timestamptz not null,
  snapshot_at timestamptz not null default now()
);
create index member_intake_history_member_idx on public.member_intake_history (member_id, snapshot_at desc);

create trigger member_intakes_set_updated_at
before update on public.member_intakes
for each row execute function public.set_updated_at();

alter table public.member_intakes enable row level security;
alter table public.member_intake_injuries enable row level security;
alter table public.intake_coach_access enable row level security;
alter table public.member_intake_history enable row level security;

create function private.has_intake_coach_access(p_intake_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.has_role((select auth.uid()), 'coach')) and exists (
    select 1 from public.intake_coach_access a
    where a.intake_id = p_intake_id and a.coach_id = (select auth.uid())
  );
$$;

create function private.member_intake_owner(p_intake_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.member_intakes i
    where i.id = p_intake_id and i.member_id = (select auth.uid())
      and (select private.has_role((select auth.uid()), 'member'))
  );
$$;

create policy "Members and explicitly granted coaches read completed or own intake"
on public.member_intakes for select to authenticated
using (
  (member_id = (select auth.uid()) and (select private.has_role((select auth.uid()), 'member')))
  or (status = 'completed' and (select private.has_intake_coach_access(id)))
);
create policy "Members and explicitly granted coaches read matching injuries"
on public.member_intake_injuries for select to authenticated
using (
  (select private.member_intake_owner(intake_id))
  or exists (
    select 1 from public.member_intakes i
    where i.id = intake_id and i.status = 'completed'
      and (select private.has_intake_coach_access(i.id))
  )
);
create policy "Members and exact coaches read intake access rows"
on public.intake_coach_access for select to authenticated
using (
  (coach_id = (select auth.uid()) and (select private.has_role((select auth.uid()), 'coach')))
  or (select private.member_intake_owner(intake_id))
);
create policy "Members and exact coaches read intake history"
on public.member_intake_history for select to authenticated
using (
  (member_id = (select auth.uid()) and (select private.has_role((select auth.uid()), 'member')))
  or (select private.has_intake_coach_access(intake_id))
);

revoke all on public.member_intakes, public.member_intake_injuries,
  public.intake_coach_access, public.member_intake_history
  from public, anon, authenticated;
grant select on public.member_intakes, public.member_intake_injuries,
  public.intake_coach_access, public.member_intake_history to authenticated;
grant all on public.member_intakes, public.member_intake_injuries,
  public.intake_coach_access, public.member_intake_history to service_role;

create function private.member_confirmed_intake_bookings(p_member_id uuid)
returns table (
  coach_id uuid,
  booking_id uuid,
  session_id uuid,
  starts_at timestamptz,
  booked_at timestamptz,
  booking_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.coach_id, s.id, s.id, s.starts_at,
    coalesce(i.responded_at, s.created_at), 'session'::text
  from public.session_invites i
  join public.calendar_sessions s on s.id = i.session_id
  where i.member_id = p_member_id
    and i.response = 'going'
    and not exists (
      select 1 from public.coach_intro_bookings b
      where b.session_id = s.id
    )
  union all
  select b.coach_id, b.id, b.session_id, slot.starts_at, b.created_at, 'intro'::text
  from public.coach_intro_bookings b
  join public.coach_intro_slots slot on slot.id = b.slot_id
  where b.member_id = p_member_id
    and b.status = 'booked'
    and b.session_id is not null;
$$;

create function public.my_pending_intake_bookings()
returns table (
  coach_id uuid,
  coach_name text,
  booking_id uuid,
  session_id uuid,
  starts_at timestamptz,
  booking_source text,
  intake_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  return query
  with first_booking as (
    select distinct on (b.coach_id) b.*
    from private.member_confirmed_intake_bookings(caller) b
    order by b.coach_id, b.booked_at, b.booking_id
  )
  select f.coach_id, p.display_name, f.booking_id, f.session_id, f.starts_at,
    f.booking_source,
    case when i.status = 'completed' or exists (
      select 1 from public.member_intake_history h where h.intake_id = i.id
    ) then 'review' else 'new' end
  from first_booking f
  join public.profiles p on p.id = f.coach_id and p.role = 'coach'
  left join public.member_intakes i on i.member_id = caller
  where not exists (
    select 1 from public.intake_coach_access a
    where a.intake_id = i.id and a.coach_id = f.coach_id
  )
  order by f.booked_at, p.display_name;
end;
$$;

create function public.save_member_intake_draft(p_answers jsonb, p_current_step integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  intake public.member_intakes%rowtype;
  next_status text;
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if p_current_step is null or p_current_step not between 1 and 8
    or not private.member_intake_answers_valid(p_answers, false)
  then
    raise exception 'Check your intake answers and try again.' using errcode = '22023';
  end if;

  select * into intake from public.member_intakes where member_id = caller for update;
  if not found then
    insert into public.member_intakes (
      member_id, status, current_step, answers,
      current_weight_lbs, height_in, age, training_location, plan_style
    ) values (
      caller, 'draft', p_current_step, p_answers,
      nullif(p_answers ->> 'current_weight_lbs', '')::numeric,
      nullif(p_answers ->> 'height_in', '')::numeric,
      nullif(p_answers ->> 'age', '')::smallint,
      p_answers ->> 'training_location', p_answers ->> 'plan_style'
    ) on conflict (member_id) do nothing
      returning * into intake;
    if not found then
      select * into intake from public.member_intakes where member_id = caller for update;
    end if;
  end if;

  next_status := intake.status;
  if intake.status = 'completed' and intake.answers is distinct from p_answers then
    insert into public.member_intake_history (
      intake_id, member_id, answers, consent_at, completed_at
    ) values (
      intake.id, caller, intake.answers, intake.consent_at, intake.completed_at
    );
    next_status := 'draft';
  end if;
  update public.member_intakes
  set status = next_status,
      current_step = greatest(current_step, p_current_step)::smallint,
      answers = p_answers,
      current_weight_lbs = nullif(p_answers ->> 'current_weight_lbs', '')::numeric,
      height_in = nullif(p_answers ->> 'height_in', '')::numeric,
      age = nullif(p_answers ->> 'age', '')::smallint,
      training_location = p_answers ->> 'training_location',
      plan_style = p_answers ->> 'plan_style',
      consent_at = case when next_status = 'draft' then null else consent_at end,
      completed_at = case when next_status = 'draft' then null else completed_at end
  where id = intake.id
  returning * into intake;

  delete from public.member_intake_injuries where intake_id = intake.id;
  insert into public.member_intake_injuries (intake_id, body_part, body_part_other, restriction, duration)
  select intake.id, injury ->> 'body_part', nullif(btrim(injury ->> 'body_part_other'), ''),
    injury ->> 'restriction', injury ->> 'duration'
  from jsonb_array_elements(coalesce(p_answers -> 'injuries', '[]'::jsonb)) e(injury);

  return intake.id;
end;
$$;

create function public.complete_member_intake(
  p_answers jsonb,
  p_coach_id uuid,
  p_booking_id uuid,
  p_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  intake public.member_intakes%rowtype;
  booking_found boolean;
begin
  if caller is null or not (select private.has_role(caller, 'member')) then
    raise exception 'Member access required' using errcode = '42501';
  end if;
  if p_consent is distinct from true then
    raise exception 'Please review and accept the consent statement.' using errcode = '22023';
  end if;
  if ((p_coach_id is null) <> (p_booking_id is null))
    or not private.member_intake_answers_valid(p_answers, true)
  then
    raise exception 'Check your intake answers and try again.' using errcode = '22023';
  end if;

  -- The transaction rechecks the member's first confirmed booking and binds consent to that pair.
  if p_coach_id is not null then
    select exists (
      select 1
      from (
        select distinct on (b.coach_id) b.coach_id, b.booking_id
        from private.member_confirmed_intake_bookings(caller) b
        order by b.coach_id, b.booked_at, b.booking_id
      ) first_booking
      where first_booking.coach_id = p_coach_id
        and first_booking.booking_id = p_booking_id
    ) into booking_found;
    if not booking_found then
      raise exception 'That booking is no longer available for intake sharing.' using errcode = 'P0001';
    end if;
  end if;

  select * into intake from public.member_intakes where member_id = caller for update;
  if not found then
    if p_coach_id is null then
      raise exception 'A confirmed coach booking is needed before sharing this intake.' using errcode = 'P0001';
    end if;
    insert into public.member_intakes (
      member_id, status, current_step, answers, current_weight_lbs, height_in,
      age, training_location, plan_style, consent_at, completed_at
    ) values (
      caller, 'completed', 8, p_answers,
      (p_answers ->> 'current_weight_lbs')::numeric,
      (p_answers ->> 'height_in')::numeric,
      (p_answers ->> 'age')::smallint,
      p_answers ->> 'training_location', p_answers ->> 'plan_style', now(), now()
    ) on conflict (member_id) do nothing
      returning * into intake;
    if not found then
      select * into intake from public.member_intakes where member_id = caller for update;
    end if;
  end if;

  if p_coach_id is null and not exists (
    select 1 from public.intake_coach_access a where a.intake_id = intake.id
  ) then
    raise exception 'A confirmed coach booking is needed before sharing this intake.' using errcode = 'P0001';
  end if;
  if intake.status = 'completed' and intake.answers is distinct from p_answers then
    insert into public.member_intake_history (
      intake_id, member_id, answers, consent_at, completed_at
    ) values (
      intake.id, caller, intake.answers, intake.consent_at, intake.completed_at
    );
  end if;
  update public.member_intakes
  set status = 'completed', current_step = 8, answers = p_answers,
      current_weight_lbs = (p_answers ->> 'current_weight_lbs')::numeric,
      height_in = (p_answers ->> 'height_in')::numeric,
      age = (p_answers ->> 'age')::smallint,
      training_location = p_answers ->> 'training_location',
      plan_style = p_answers ->> 'plan_style',
      consent_at = now(), completed_at = now()
  where id = intake.id
  returning * into intake;

  delete from public.member_intake_injuries where intake_id = intake.id;
  insert into public.member_intake_injuries (intake_id, body_part, body_part_other, restriction, duration)
  select intake.id, injury ->> 'body_part', nullif(btrim(injury ->> 'body_part_other'), ''),
    injury ->> 'restriction', injury ->> 'duration'
  from jsonb_array_elements(coalesce(p_answers -> 'injuries', '[]'::jsonb)) e(injury);

  if p_coach_id is not null then
    insert into public.intake_coach_access (intake_id, coach_id, booking_id, granted_at, last_confirmed_at)
    values (intake.id, p_coach_id, p_booking_id, now(), now())
    on conflict (intake_id, coach_id) do update
      set booking_id = excluded.booking_id,
          last_confirmed_at = excluded.last_confirmed_at;
  end if;

  return intake.id;
end;
$$;

create function public.coach_member_intake_status(p_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  state text;
begin
  if caller is null or not (select private.has_role(caller, 'coach')) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;

  select case
    when exists (
      select 1 from public.intake_coach_access a
      join public.member_intakes i on i.id = a.intake_id
      where a.coach_id = caller and i.member_id = p_member_id
        and (i.status = 'completed' or exists (
          select 1 from public.member_intake_history h where h.intake_id = i.id
        ))
    ) then 'complete'
    when exists (
      select 1 from private.member_confirmed_intake_bookings(p_member_id) b
      where b.coach_id = caller
    ) then 'pending'
    else null
  end into state;
  return state;
end;
$$;

create function public.coach_session_intake_status(p_session_id uuid)
returns table (member_id uuid, intake_status text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null or not (select private.has_role(caller, 'coach')) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.calendar_sessions s
    where s.id = p_session_id and s.coach_id = caller
  ) then
    raise exception 'Session not found.' using errcode = 'P0002';
  end if;

  return query
  select i.member_id,
    case when exists (
      select 1 from public.member_intakes mi
      join public.intake_coach_access a on a.intake_id = mi.id and a.coach_id = caller
      where mi.member_id = i.member_id
        and (mi.status = 'completed' or exists (
          select 1 from public.member_intake_history h where h.intake_id = mi.id
        ))
    ) then 'complete'::text else 'pending'::text end
  from public.session_invites i
  where i.session_id = p_session_id and i.response = 'going'
  order by i.created_at, i.member_id;
end;
$$;

create table public.member_intake_reminder_claims (
  session_id uuid not null references public.calendar_sessions (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  reminder_phase text not null check (reminder_phase in ('24h', '2h')),
  state text not null check (state in ('sending', 'retry', 'sent', 'failed')),
  lease_token uuid,
  lease_until timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  first_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (session_id, member_id, reminder_phase)
);
alter table public.member_intake_reminder_claims enable row level security;
revoke all on public.member_intake_reminder_claims from public, anon, authenticated;
grant all on public.member_intake_reminder_claims to service_role;

create function private.member_intake_reminder_candidates()
returns table (
  member_id uuid,
  coach_id uuid,
  coach_name text,
  booking_id uuid,
  session_id uuid,
  starts_at timestamptz,
  reminder_phase text
)
language sql
stable
security definer
set search_path = ''
as $$
  with due as (
    select s.id as session_id, s.coach_id, s.starts_at, i.member_id,
      phase.reminder_phase
    from public.calendar_sessions s
    join public.session_invites i on i.session_id = s.id and i.response = 'going'
    cross join lateral (
      select '24h'::text as reminder_phase
      where s.starts_at between now() + interval '23 hours 45 minutes'
        and now() + interval '24 hours 15 minutes'
      union all
      select '2h'::text
      where s.starts_at between now() + interval '1 hour 45 minutes'
        and now() + interval '2 hours 15 minutes'
    ) phase
    where not exists (
      select 1 from public.intake_coach_access a
      join public.member_intakes mi on mi.id = a.intake_id
      where mi.member_id = i.member_id and a.coach_id = s.coach_id
    )
    and not exists (
      select 1 from public.member_intake_reminder_claims r
      where r.session_id = s.id and r.member_id = i.member_id
        and r.reminder_phase = phase.reminder_phase
        and (
          r.state in ('sent', 'failed')
          or r.first_attempt_at <= now() - interval '23 hours'
          or (r.state = 'sending' and r.lease_until >= now())
          or r.attempts >= 5
        )
    )
  ), first_bookings as (
    select d.*,
      (select b.booking_id
       from private.member_confirmed_intake_bookings(d.member_id) b
       where b.coach_id = d.coach_id
       order by b.booked_at, b.booking_id
       limit 1) as first_booking_id
    from due d
  )
  select f.member_id, f.coach_id, p.display_name, f.first_booking_id,
    f.session_id, f.starts_at, f.reminder_phase
  from first_bookings f
  join public.profiles p on p.id = f.coach_id and p.role = 'coach'
  where f.first_booking_id is not null
  order by f.starts_at, f.member_id, f.session_id, f.reminder_phase;
$$;

create function public.list_member_intake_reminder_candidates()
returns table (
  member_id uuid,
  coach_id uuid,
  coach_name text,
  booking_id uuid,
  session_id uuid,
  starts_at timestamptz,
  reminder_phase text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  return query select * from private.member_intake_reminder_candidates();
end;
$$;

create function public.claim_member_intake_reminder(
  p_session_id uuid,
  p_member_id uuid,
  p_phase text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_phase not in ('24h', '2h') or p_lease_token is null then
    raise exception 'Invalid reminder claim.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from private.member_intake_reminder_candidates() c
    where c.session_id = p_session_id and c.member_id = p_member_id
      and c.reminder_phase = p_phase
  ) then
    return false;
  end if;

  insert into public.member_intake_reminder_claims (
    session_id, member_id, reminder_phase, state, lease_token, lease_until, attempts
  ) values (
    p_session_id, p_member_id, p_phase, 'sending', p_lease_token, now() + interval '5 minutes', 1
  )
  on conflict (session_id, member_id, reminder_phase) do update
    set state = 'sending', lease_token = excluded.lease_token,
        lease_until = excluded.lease_until,
        attempts = public.member_intake_reminder_claims.attempts + 1,
        updated_at = now()
    where public.member_intake_reminder_claims.state in ('retry', 'sending')
      and (public.member_intake_reminder_claims.state = 'retry'
        or public.member_intake_reminder_claims.lease_until < now())
      and public.member_intake_reminder_claims.first_attempt_at > now() - interval '23 hours'
      and public.member_intake_reminder_claims.attempts < 5
  returning session_id into claimed;
  return claimed is not null;
end;
$$;

create function public.complete_member_intake_reminder(
  p_session_id uuid,
  p_member_id uuid,
  p_phase text,
  p_lease_token uuid,
  p_success boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.member_intake_reminder_claims
  set state = case when p_success then 'sent'
                   when attempts >= 5 then 'failed' else 'retry' end,
      sent_at = case when p_success then now() else null end,
      lease_token = null, lease_until = null, updated_at = now()
  where session_id = p_session_id and member_id = p_member_id
    and reminder_phase = p_phase and lease_token = p_lease_token
    and first_attempt_at > now() - interval '23 hours'
    and state = 'sending';
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke all on function private.intake_json_text_valid(jsonb, text, integer, boolean),
  private.intake_json_number_valid(jsonb, text, numeric, numeric, boolean, boolean),
  private.intake_json_enum_valid(jsonb, text, text[], boolean),
  private.intake_json_array_valid(jsonb, text, text[], integer, boolean),
  private.member_intake_answers_valid(jsonb, boolean),
  private.has_intake_coach_access(uuid), private.member_intake_owner(uuid),
  private.member_confirmed_intake_bookings(uuid), private.member_intake_reminder_candidates()
  from public, anon, authenticated;
revoke all on function public.my_pending_intake_bookings(),
  public.save_member_intake_draft(jsonb, integer),
  public.complete_member_intake(jsonb, uuid, uuid, boolean),
  public.coach_member_intake_status(uuid),
  public.coach_session_intake_status(uuid),
  public.list_member_intake_reminder_candidates(),
  public.claim_member_intake_reminder(uuid, uuid, text, uuid),
  public.complete_member_intake_reminder(uuid, uuid, text, uuid, boolean)
  from public, anon;
revoke all on function public.my_pending_intake_bookings(),
  public.save_member_intake_draft(jsonb, integer),
  public.complete_member_intake(jsonb, uuid, uuid, boolean),
  public.coach_member_intake_status(uuid),
  public.coach_session_intake_status(uuid),
  public.list_member_intake_reminder_candidates(),
  public.claim_member_intake_reminder(uuid, uuid, text, uuid),
  public.complete_member_intake_reminder(uuid, uuid, text, uuid, boolean)
  from authenticated;
grant execute on function public.my_pending_intake_bookings(),
  public.save_member_intake_draft(jsonb, integer),
  public.complete_member_intake(jsonb, uuid, uuid, boolean),
  public.coach_member_intake_status(uuid),
  public.coach_session_intake_status(uuid)
  to authenticated;
grant execute on function public.list_member_intake_reminder_candidates(),
  public.claim_member_intake_reminder(uuid, uuid, text, uuid),
  public.complete_member_intake_reminder(uuid, uuid, text, uuid, boolean)
  to service_role;

-- RLS expressions invoke these SECURITY DEFINER helpers for the current actor's row.
grant execute on function private.has_intake_coach_access(uuid),
  private.member_intake_owner(uuid)
  to authenticated;
