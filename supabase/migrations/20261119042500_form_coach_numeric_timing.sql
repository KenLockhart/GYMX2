-- Observed rep phases may be shorter than a tenth of a second. Preserve measured integer phase
-- values while keeping the complete rep between 600 ms and 15 seconds. Reference-template tempo
-- values and all other payload checks remain unchanged.
alter table public.form_coach_attempt_rep_results
  drop constraint form_coach_attempt_rep_results_concentric_ms_check,
  drop constraint form_coach_attempt_rep_results_eccentric_ms_check;

alter table public.form_coach_attempt_rep_results
  add constraint form_coach_attempt_rep_results_concentric_ms_check
    check (concentric_ms between 1 and 15000),
  add constraint form_coach_attempt_rep_results_eccentric_ms_check
    check (eccentric_ms between 1 and 15000),
  add constraint form_coach_attempt_rep_results_total_duration_check
    check (concentric_ms::bigint + top_pause_ms::bigint + eccentric_ms::bigint between 600 and 15000) not valid;

-- Keep the original strict validator as a private delegate for all non-duration payload rules.
-- The replacement validates measured timings, raises only the two old minima to 1 ms, then asks
-- the original validator to check every other field, key, range, and allowlist unchanged.
alter function private.form_coach_attempt_payload_valid(jsonb)
  rename to form_coach_attempt_payload_valid_v400;
revoke all on function private.form_coach_attempt_payload_valid_v400(jsonb) from public, anon, authenticated, service_role;

create function private.form_coach_attempt_payload_valid(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  rep jsonb;
  normalized_rep jsonb;
  normalized_payload jsonb := '[]'::jsonb;
  concentric_value numeric;
  pause_value numeric;
  eccentric_value numeric;
begin
  if payload is null or jsonb_typeof(payload) is distinct from 'array'
    or octet_length(payload::text) > 32768
    or jsonb_array_length(payload) not between 1 and 20 then
    return false;
  end if;

  for rep in select reps.value from jsonb_array_elements(payload) as reps(value) loop
    if jsonb_typeof(rep) is distinct from 'object'
      or jsonb_typeof(rep->'concentric_ms') is distinct from 'number'
      or jsonb_typeof(rep->'top_pause_ms') is distinct from 'number'
      or jsonb_typeof(rep->'eccentric_ms') is distinct from 'number' then
      return false;
    end if;
    begin
      concentric_value := (rep->>'concentric_ms')::numeric;
      pause_value := (rep->>'top_pause_ms')::numeric;
      eccentric_value := (rep->>'eccentric_ms')::numeric;
    exception when others then
      return false;
    end;
    if concentric_value <> trunc(concentric_value) or concentric_value not between 1 and 15000
      or pause_value <> trunc(pause_value) or pause_value not between 0 and 15000
      or eccentric_value <> trunc(eccentric_value) or eccentric_value not between 1 and 15000
      or concentric_value + pause_value + eccentric_value not between 600 and 15000 then
      return false;
    end if;
    normalized_rep := jsonb_set(
      jsonb_set(rep, '{concentric_ms}', to_jsonb(greatest(concentric_value, 100)), false),
      '{eccentric_ms}', to_jsonb(greatest(eccentric_value, 100)), false
    );
    normalized_payload := normalized_payload || jsonb_build_array(normalized_rep);
  end loop;

  return private.form_coach_attempt_payload_valid_v400(normalized_payload);
exception when others then
  return false;
end;
$$;
revoke all on function private.form_coach_attempt_payload_valid(jsonb) from public, anon, authenticated, service_role;
