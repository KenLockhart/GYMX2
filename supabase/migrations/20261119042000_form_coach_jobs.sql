-- Add bounded, deletion-aware Form Coach summary dispatch and scheduled workflow jobs.
-- This migration stores only dispatch authorization metadata; provider calls stay in the app.

alter table public.form_coach_summary_outbox
  alter column attempt_count type integer using attempt_count::integer,
  add column next_attempt_at timestamptz not null default now(),
  add column last_outcome text check (last_outcome is null or last_outcome in (
    'complete','retryable_timeout','retryable_rate_limited','retryable_provider_unavailable',
    'retryable_network','retryable_unconfigured','unavailable_provider_auth',
    'unavailable_provider_rejected','unavailable_blocked','unavailable_truncated',
    'unavailable_empty_output','unavailable_invalid_output','unavailable_provider_error',
    'unavailable_invalid_input','authorization_expired','attempt_limit','account_deleting',
    'ineligible'
  ));
update public.form_coach_summary_outbox set next_attempt_at=created_at;
create index form_coach_summary_jobs_fair_idx
  on public.form_coach_summary_outbox(next_attempt_at,created_at,id)
  where state in ('pending','claimed');

create index form_coach_assessments_expiry_due_idx
  on public.form_coach_assessments(due_at,id)
  where status in ('sent','in_progress');
create index form_coach_attempts_finished_assessment_idx
  on public.form_coach_attempts(assessment_id) where state='finished';
create index form_coach_attempts_running_assessment_lease_idx
  on public.form_coach_attempts(assessment_id,lease_expires_at) where state='running';

create table public.form_coach_summary_dispatches (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.form_coach_summary_outbox(id) on delete restrict,
  claim_token uuid not null unique,
  dispatch_token uuid not null unique,
  authorized_at timestamptz not null,
  dispatch_deadline timestamptz not null,
  settled_at timestamptz,
  outcome_category text check (outcome_category is null or outcome_category in (
    'complete','retryable_timeout','retryable_rate_limited','retryable_provider_unavailable',
    'retryable_network','retryable_unconfigured','unavailable_provider_auth',
    'unavailable_provider_rejected','unavailable_blocked','unavailable_truncated',
    'unavailable_empty_output','unavailable_invalid_output','unavailable_provider_error',
    'unavailable_invalid_input','authorization_expired','stale_claim','account_deleting','ineligible'
  )),
  result_digest text check (result_digest is null or result_digest ~ '^[a-f0-9]{64}$'),
  check (dispatch_deadline > authorized_at),
  check ((settled_at is null) = (outcome_category is null and result_digest is null))
);
create index form_coach_summary_dispatch_open_idx
  on public.form_coach_summary_dispatches(outbox_id,dispatch_deadline)
  where settled_at is null;
alter table public.form_coach_summary_dispatches enable row level security;
revoke all on public.form_coach_summary_dispatches from public,anon,authenticated,service_role;

-- A retryable error is delayed. At most five provider claims are made for one summary.
create function private.form_coach_summary_backoff(target_attempt_count integer)
returns interval language sql immutable set search_path = '' as $$
  select make_interval(secs => least(3600::double precision,
    30::double precision * power(2::double precision,
      greatest(least(coalesce(target_attempt_count,1)-1,7),0)::double precision)))
$$;
revoke all on function private.form_coach_summary_backoff(integer) from public,anon,authenticated,service_role;

-- This predicate is used only after account locks and row revalidation in the service RPCs.
-- The current revision is checked only for a global disable; it does not replace the historical
-- funding receipt or require a current paid plan.
create function private.form_coach_summary_dispatch_eligible(
  target_assessment_id uuid,target_attempt_id uuid,target_outbox_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.form_coach_assessments assessment
    join public.form_coach_attempts attempt
      on attempt.assessment_id=assessment.id and attempt.id=target_attempt_id
    join public.form_coach_attempt_results result on result.attempt_id=attempt.id
    join public.form_coach_summary_outbox outbox
      on outbox.attempt_id=attempt.id and outbox.id=target_outbox_id
    join public.profiles member_profile on member_profile.id=assessment.member_subject_id
    join public.profiles coach_profile on coach_profile.id=assessment.coach_subject_id
    where assessment.id=target_assessment_id
      and assessment.member_owner_id=assessment.member_subject_id
      and assessment.coach_owner_id=assessment.coach_subject_id
      and private.has_role(assessment.member_subject_id,'member'::public.user_role)
      and private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
      and attempt.member_subject_id=assessment.member_subject_id
      and attempt.state='finished' and attempt.finished_at is not null
      and result.result_digest=attempt.result_digest
      and result.summary_state='pending' and result.coach_summary is null
      and outbox.state='claimed' and outbox.prompt_version='attempt-summary-v1'
      and outbox.numeric_payload=result.numeric_summary
      and private.form_coach_json_object_key_count(outbox.numeric_payload)=22
      and private.form_coach_numeric_summary_valid(outbox.numeric_payload)
      and exists (
        select 1 from public.feature_pricing_current pricing_current
        join public.feature_pricing_revisions pricing_revision
          on pricing_revision.feature_key=pricing_current.feature_key
         and pricing_revision.revision=pricing_current.revision
        where pricing_current.feature_key='form_coach'
          and pricing_revision.status<>'disabled'
      )
      and exists (
        select 1 from public.feature_bundle_funding_receipts funding
        where funding.bundle_id=assessment.id and funding.feature_key='form_coach'
          and funding.payer_role=assessment.payer_role and funding.payer_id=assessment.payer_subject_id
          and funding.config_revision=assessment.config_revision and funding.due_at=assessment.due_at
          and funding.funding_source in ('comp','subscription','trial_days','assessment_trial','pack')
          and ((funding.funding_source in ('comp','subscription','trial_days') and funding.credit_units_consumed=0)
            or (funding.funding_source in ('assessment_trial','pack') and funding.credit_units_consumed=1))
      )
      and exists (select 1 from public.coach_members link
        where link.coach_id=assessment.coach_subject_id and link.member_id=assessment.member_subject_id)
      and (
        (assessment.source_kind='manual'
          and assessment.program_id is null and assessment.program_owner_subject_id is null)
        or
        (assessment.source_kind='program'
          and assessment.program_id is not null
          and assessment.program_owner_subject_id=assessment.coach_subject_id
          and assessment.program_owner_id=assessment.coach_owner_id
          and exists (select 1 from public.programs program
            where program.id=assessment.program_id and program.coach_id=assessment.coach_subject_id
              and not program.platform_owned))
      )
  )
$$;
revoke all on function private.form_coach_summary_dispatch_eligible(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

-- Old claim/finish RPCs could bypass the one-use dispatch ledger. Remove their service grants and
-- replace their bodies so an older caller cannot silently resume the unsafe path.
create or replace function public.service_claim_form_coach_summary_jobs(
  target_limit smallint default 10,lease_seconds smallint default 120
)
returns table(outbox_id uuid,attempt_id uuid,prompt_version text,numeric_payload jsonb,
  claim_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Use the dispatch-authorized summary job RPC' using errcode='0A000';
end;
$$;
revoke all on function public.service_claim_form_coach_summary_jobs(smallint,smallint)
  from public,anon,authenticated,service_role;

create or replace function public.service_finish_form_coach_summary_job(
  target_attempt_id uuid,target_claim_token uuid,target_outcome text,target_summary text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Use the dispatch-authorized summary job RPC' using errcode='0A000';
end;
$$;
revoke all on function public.service_finish_form_coach_summary_job(uuid,uuid,text,text)
  from public,anon,authenticated,service_role;

create function public.service_claim_form_coach_summary_jobs_v2(
  target_limit smallint default 1,target_attempt_id uuid default null
)
returns table(outbox_id uuid,attempt_id uuid,claim_token uuid,lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare candidate record; assessment_row public.form_coach_assessments%rowtype;
  outbox_row public.form_coach_summary_outbox%rowtype;
  dispatch_row public.form_coach_summary_dispatches%rowtype;
  new_claim_token uuid; new_lease_expires_at timestamptz; claimed_count smallint:=0;
  now_value timestamptz; scan_time timestamptz; feature_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_limit is null or target_limit not between 1 and 5 then
    raise exception 'Summary claim limit is invalid' using errcode='22023';
  end if;

  select pricing_revision.status into feature_status
  from public.feature_pricing_current pricing_current
  join public.feature_pricing_revisions pricing_revision
    on pricing_revision.feature_key=pricing_current.feature_key
   and pricing_revision.revision=pricing_current.revision
  where pricing_current.feature_key='form_coach'
  for share of pricing_current;
  if not found or feature_status='disabled' then return; end if;
  scan_time:=clock_timestamp();

  -- Read candidate identities without row locks, take sorted account TRY locks, then lock rows.
  -- The fixed scan bound keeps a busy oldest account from turning one cron call into an unbounded scan.
  for candidate in
    select outbox.id as outbox_id,outbox.attempt_id,assessment.id as assessment_id,
      assessment.member_subject_id,assessment.coach_subject_id
    from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where ((outbox.state='pending' and outbox.next_attempt_at<=scan_time)
        or (outbox.state='claimed' and outbox.lease_expires_at<=scan_time))
      and (target_attempt_id is null or outbox.attempt_id=target_attempt_id)
    order by case when outbox.state='claimed' then outbox.lease_expires_at else outbox.next_attempt_at end,
      outbox.created_at,outbox.id
    limit 100
  loop
    begin
      perform private.form_coach_lock_subjects(array[candidate.member_subject_id,candidate.coach_subject_id]);
    exception when sqlstate '40001' then
      continue;
    end;

    select assessment.* into assessment_row from public.form_coach_assessments assessment
    where assessment.id=candidate.assessment_id for update skip locked;
    if not found then continue; end if;
    select outbox.* into outbox_row from public.form_coach_summary_outbox outbox
    where outbox.id=candidate.outbox_id for update skip locked;
    if not found then continue; end if;

    now_value:=clock_timestamp();
    if not ((outbox_row.state='pending' and outbox_row.next_attempt_at<=now_value)
      or (outbox_row.state='claimed' and outbox_row.lease_expires_at<=now_value)) then
      continue;
    end if;

    if private.form_coach_subject_has_deletion_fence(assessment_row.member_subject_id)
      or private.form_coach_subject_has_deletion_fence(assessment_row.coach_subject_id) then
      update public.form_coach_summary_outbox set state='suppressed',claim_token=null,
        lease_expires_at=null,last_outcome='account_deleting',updated_at=now_value
      where id=outbox_row.id and state in ('pending','claimed');
      continue;
    end if;

    select dispatch.* into dispatch_row from public.form_coach_summary_dispatches dispatch
    where dispatch.outbox_id=outbox_row.id and dispatch.settled_at is null
    order by dispatch.authorized_at desc limit 1 for update;
    if found then
      if dispatch_row.dispatch_deadline>now_value then continue; end if;
      update public.form_coach_summary_dispatches set settled_at=now_value,
        outcome_category='authorization_expired',
        result_digest=encode(extensions.digest(convert_to('authorization_expired|','UTF8'),'sha256'),'hex')
      where id=dispatch_row.id and settled_at is null;
      update public.form_coach_attempt_results as result set summary_state='unavailable',coach_summary=null
      where result.attempt_id=outbox_row.attempt_id and result.summary_state='pending';
      update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
        lease_expires_at=null,last_outcome='authorization_expired',
        completed_digest=encode(extensions.digest(convert_to('unavailable|authorization_expired','UTF8'),'sha256'),'hex'),
        updated_at=now_value
      where id=outbox_row.id and state in ('pending','claimed');
      continue;
    end if;

    if outbox_row.attempt_count>=5 then
      update public.form_coach_attempt_results as result set summary_state='unavailable',coach_summary=null
      where result.attempt_id=outbox_row.attempt_id and result.summary_state='pending';
      update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
        lease_expires_at=null,last_outcome='attempt_limit',
        completed_digest=encode(extensions.digest(convert_to('unavailable|attempt_limit','UTF8'),'sha256'),'hex'),
        updated_at=now_value
      where id=outbox_row.id and state in ('pending','claimed');
      continue;
    end if;

    new_claim_token:=gen_random_uuid();
    new_lease_expires_at:=now_value+interval '30 seconds';
    update public.form_coach_summary_outbox set state='claimed',claim_token=new_claim_token,
      lease_expires_at=new_lease_expires_at,attempt_count=attempt_count+1,updated_at=now_value
    where id=outbox_row.id and state in ('pending','claimed')
    returning * into outbox_row;
    if not found then continue; end if;

    outbox_id:=outbox_row.id;
    attempt_id:=outbox_row.attempt_id;
    claim_token:=new_claim_token;
    lease_expires_at:=new_lease_expires_at;
    return next;
    claimed_count:=claimed_count+1;
    if claimed_count>=target_limit then exit; end if;
  end loop;
end;
$$;
revoke all on function public.service_claim_form_coach_summary_jobs_v2(smallint,uuid)
  from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_summary_jobs_v2(smallint,uuid) to service_role;

create function public.service_authorize_form_coach_summary_dispatch(
  target_outbox_id uuid,target_claim_token uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare candidate record; assessment_row public.form_coach_assessments%rowtype;
  outbox_row public.form_coach_summary_outbox%rowtype;
  attempt_row public.form_coach_attempts%rowtype;
  result_row public.form_coach_attempt_results%rowtype;
  dispatch_id uuid; dispatch_token_value uuid; authorized_time timestamptz; deadline_time timestamptz;
  result_hash text; feature_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_outbox_id is null or target_claim_token is null then
    raise exception 'Summary authorization identity is invalid' using errcode='22023';
  end if;
  select assessment.id as assessment_id,assessment.member_subject_id,assessment.coach_subject_id
    into candidate
  from public.form_coach_summary_outbox outbox
  join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
  join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  where outbox.id=target_outbox_id and outbox.claim_token=target_claim_token;
  if not found then return jsonb_build_object('authorized',false,'outcome','stale_claim'); end if;

  perform private.form_coach_lock_subjects(array[candidate.member_subject_id,candidate.coach_subject_id]);
  select assessment.* into assessment_row from public.form_coach_assessments assessment
  where assessment.id=candidate.assessment_id for update;
  if not found then return jsonb_build_object('authorized',false,'outcome','not_found'); end if;
  select outbox.* into outbox_row from public.form_coach_summary_outbox outbox
  where outbox.id=target_outbox_id for update;
  if not found or outbox_row.state<>'claimed' or outbox_row.claim_token is distinct from target_claim_token
    or outbox_row.lease_expires_at<=clock_timestamp() then
    return jsonb_build_object('authorized',false,'outcome','stale_claim');
  end if;
  if exists(select 1 from public.form_coach_summary_dispatches dispatch
    where dispatch.claim_token=target_claim_token) then
    return jsonb_build_object('authorized',false,'outcome','already_authorized');
  end if;
  if private.form_coach_subject_has_deletion_fence(assessment_row.member_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment_row.coach_subject_id) then
    update public.form_coach_summary_outbox set state='suppressed',claim_token=null,
      lease_expires_at=null,last_outcome='account_deleting',updated_at=clock_timestamp()
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
    return jsonb_build_object('authorized',false,'outcome','account_deleting');
  end if;

  select pricing_revision.status into feature_status
  from public.feature_pricing_current pricing_current
  join public.feature_pricing_revisions pricing_revision
    on pricing_revision.feature_key=pricing_current.feature_key
   and pricing_revision.revision=pricing_current.revision
  where pricing_current.feature_key='form_coach'
  for share of pricing_current;
  if not found or feature_status='disabled' then
    update public.form_coach_summary_outbox set state='pending',claim_token=null,
      lease_expires_at=null,attempt_count=greatest(attempt_count-1,0),updated_at=clock_timestamp()
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
    return jsonb_build_object('authorized',false,'outcome','feature_disabled');
  end if;

  select attempt.* into attempt_row from public.form_coach_attempts attempt
  where attempt.id=outbox_row.attempt_id and attempt.assessment_id=assessment_row.id for update;
  select result.* into result_row from public.form_coach_attempt_results result
  where result.attempt_id=outbox_row.attempt_id for update;
  if not found or not private.form_coach_summary_dispatch_eligible(
    assessment_row.id,outbox_row.attempt_id,outbox_row.id
  ) then
    update public.form_coach_attempt_results set summary_state='unavailable',coach_summary=null
    where attempt_id=outbox_row.attempt_id and summary_state='pending';
    result_hash:=encode(extensions.digest(convert_to('unavailable|ineligible','UTF8'),'sha256'),'hex');
    update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
      lease_expires_at=null,last_outcome='ineligible',completed_digest=result_hash,updated_at=clock_timestamp()
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
    return jsonb_build_object('authorized',false,'outcome','ineligible');
  end if;

  authorized_time:=clock_timestamp();
  deadline_time:=authorized_time+interval '12 seconds';
  dispatch_token_value:=gen_random_uuid();
  insert into public.form_coach_summary_dispatches(
    outbox_id,claim_token,dispatch_token,authorized_at,dispatch_deadline
  ) values(outbox_row.id,target_claim_token,dispatch_token_value,authorized_time,deadline_time)
  returning id into dispatch_id;
  return jsonb_build_object('authorized',true,'outcome','authorized',
    'dispatch_id',dispatch_id,'dispatch_token',dispatch_token_value,
    'authorized_at',authorized_time,'dispatch_deadline',deadline_time,
    'remaining_budget_ms',greatest(0,floor(extract(epoch from (deadline_time-clock_timestamp()))*1000)::integer),
    'prompt_version',outbox_row.prompt_version,'numeric_payload',outbox_row.numeric_payload);
end;
$$;
revoke all on function public.service_authorize_form_coach_summary_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.service_authorize_form_coach_summary_dispatch(uuid,uuid) to service_role;

create function public.service_finish_form_coach_summary_dispatch(
  target_outbox_id uuid,target_claim_token uuid,target_dispatch_token uuid,
  target_outcome_category text,target_summary text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare candidate record; assessment_row public.form_coach_assessments%rowtype;
  outbox_row public.form_coach_summary_outbox%rowtype;
  dispatch_row public.form_coach_summary_dispatches%rowtype;
  result_row public.form_coach_attempt_results%rowtype;
  result_hash text; now_value timestamptz; is_retryable boolean; feature_status text;
  is_eligible boolean; is_deletion_fenced boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_outbox_id is null or target_claim_token is null or target_dispatch_token is null
    or target_outcome_category is null or target_outcome_category not in (
      'complete','retryable_timeout','retryable_rate_limited','retryable_provider_unavailable',
      'retryable_network','retryable_unconfigured','unavailable_provider_auth',
      'unavailable_provider_rejected','unavailable_blocked','unavailable_truncated',
      'unavailable_empty_output','unavailable_invalid_output','unavailable_provider_error',
      'unavailable_invalid_input'
    )
    or (target_outcome_category='complete' and (target_summary is null
      or char_length(btrim(target_summary)) not between 1 and 1000 or target_summary ~ '[<>]'))
    or (target_outcome_category<>'complete' and target_summary is not null) then
    raise exception 'Summary dispatch result is invalid' using errcode='22023';
  end if;

  select assessment.id as assessment_id,assessment.member_subject_id,assessment.coach_subject_id
    into candidate
  from public.form_coach_summary_dispatches dispatch
  join public.form_coach_summary_outbox outbox on outbox.id=dispatch.outbox_id
  join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
  join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  where dispatch.outbox_id=target_outbox_id and dispatch.claim_token=target_claim_token
    and dispatch.dispatch_token=target_dispatch_token;
  if not found then return jsonb_build_object('outcome','stale_dispatch'); end if;
  perform private.form_coach_lock_subjects(array[candidate.member_subject_id,candidate.coach_subject_id]);
  select assessment.* into assessment_row from public.form_coach_assessments assessment
  where assessment.id=candidate.assessment_id for update;
  if not found then return jsonb_build_object('outcome','stale_dispatch'); end if;
  select outbox.* into outbox_row from public.form_coach_summary_outbox outbox
  where outbox.id=target_outbox_id for update;
  if not found then return jsonb_build_object('outcome','stale_dispatch'); end if;
  select dispatch.* into dispatch_row from public.form_coach_summary_dispatches dispatch
  where dispatch.outbox_id=target_outbox_id and dispatch.claim_token=target_claim_token
    and dispatch.dispatch_token=target_dispatch_token for update;
  if not found then return jsonb_build_object('outcome','stale_dispatch'); end if;

  result_hash:=encode(extensions.digest(convert_to(
    target_outcome_category||'|'||coalesce(btrim(target_summary),''),'UTF8'),'sha256'),'hex');
  if dispatch_row.settled_at is not null then
    if dispatch_row.outcome_category=target_outcome_category and dispatch_row.result_digest=result_hash then
      return jsonb_build_object('outcome','already_recorded');
    end if;
    return jsonb_build_object('outcome','stale_dispatch');
  end if;

  -- Lock every row that can block before starting the authorization deadline check.
  -- A timed-out finish leaves the grant untouched for the bounded claim-recovery path.
  select result.* into result_row from public.form_coach_attempt_results result
  where result.attempt_id=outbox_row.attempt_id for update;
  if not found or result_row.summary_state<>'pending' then
    return jsonb_build_object('outcome','stale_result');
  end if;

  select pricing_revision.status into feature_status
  from public.feature_pricing_current pricing_current
  join public.feature_pricing_revisions pricing_revision
    on pricing_revision.feature_key=pricing_current.feature_key
   and pricing_revision.revision=pricing_current.revision
  where pricing_current.feature_key='form_coach'
  for share of pricing_current;

  is_eligible:=feature_status is not null and feature_status<>'disabled';
  if is_eligible then
    is_eligible:=private.form_coach_summary_dispatch_eligible(
      assessment_row.id,outbox_row.attempt_id,outbox_row.id
    );
  end if;
  is_deletion_fenced:=private.form_coach_subject_has_deletion_fence(assessment_row.member_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment_row.coach_subject_id)
    or outbox_row.state='suppressed';
  now_value:=clock_timestamp();

  if is_deletion_fenced then
    if dispatch_row.dispatch_deadline>now_value then
      update public.form_coach_summary_outbox set state='suppressed',claim_token=null,
        lease_expires_at=null,last_outcome='account_deleting',updated_at=now_value
      where id=outbox_row.id and state in ('pending','claimed');
      update public.form_coach_summary_dispatches set settled_at=now_value,
        outcome_category='account_deleting',
        result_digest=encode(extensions.digest(convert_to('account_deleting|','UTF8'),'sha256'),'hex')
      where id=dispatch_row.id and settled_at is null;
    end if;
    return jsonb_build_object('outcome','blocked_deletion');
  end if;

  if dispatch_row.dispatch_deadline<=now_value then
    return jsonb_build_object('outcome','authorization_expired');
  end if;

  if outbox_row.state<>'claimed' or outbox_row.claim_token is distinct from target_claim_token
    or outbox_row.lease_expires_at<=now_value then
    update public.form_coach_summary_dispatches set settled_at=now_value,
      outcome_category='stale_claim',
      result_digest=encode(extensions.digest(convert_to('stale_claim|','UTF8'),'sha256'),'hex')
    where id=dispatch_row.id and settled_at is null;
    return jsonb_build_object('outcome','stale_claim');
  end if;

  if not is_eligible then
    update public.form_coach_attempt_results set summary_state='unavailable',coach_summary=null
    where attempt_id=outbox_row.attempt_id and summary_state='pending';
    update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
      lease_expires_at=null,last_outcome='ineligible',
      completed_digest=encode(extensions.digest(convert_to('unavailable|ineligible','UTF8'),'sha256'),'hex'),
      updated_at=now_value
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
    update public.form_coach_summary_dispatches set settled_at=now_value,
      outcome_category='ineligible',
      result_digest=encode(extensions.digest(convert_to('ineligible|','UTF8'),'sha256'),'hex')
    where id=dispatch_row.id and settled_at is null;
    return jsonb_build_object('outcome','ineligible');
  end if;
  is_retryable:=target_outcome_category like 'retryable_%';

  if target_outcome_category='complete' then
    update public.form_coach_attempt_results set summary_state='complete',coach_summary=btrim(target_summary)
    where attempt_id=outbox_row.attempt_id and summary_state='pending';
    update public.form_coach_summary_outbox set state='complete',claim_token=null,
      lease_expires_at=null,last_outcome='complete',completed_digest=result_hash,updated_at=now_value
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
  elsif is_retryable and outbox_row.attempt_count<5 then
    update public.form_coach_summary_outbox set state='pending',claim_token=null,
      lease_expires_at=null,last_outcome=target_outcome_category,completed_digest=null,
      next_attempt_at=now_value+private.form_coach_summary_backoff(outbox_row.attempt_count),updated_at=now_value
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
  elsif is_retryable then
    update public.form_coach_attempt_results set summary_state='unavailable',coach_summary=null
    where attempt_id=outbox_row.attempt_id and summary_state='pending';
    update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
      lease_expires_at=null,last_outcome='attempt_limit',
      completed_digest=encode(extensions.digest(convert_to('unavailable|attempt_limit','UTF8'),'sha256'),'hex'),
      updated_at=now_value
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
  else
    update public.form_coach_attempt_results set summary_state='unavailable',coach_summary=null
    where attempt_id=outbox_row.attempt_id and summary_state='pending';
    update public.form_coach_summary_outbox set state='unavailable',claim_token=null,
      lease_expires_at=null,last_outcome=target_outcome_category,completed_digest=result_hash,updated_at=now_value
    where id=outbox_row.id and state='claimed' and claim_token=target_claim_token;
  end if;

  update public.form_coach_summary_dispatches set settled_at=now_value,
    outcome_category=target_outcome_category,result_digest=result_hash
  where id=dispatch_row.id and settled_at is null;
  return jsonb_build_object('outcome',case when is_retryable and outbox_row.attempt_count>=5
    then 'attempt_limit' else target_outcome_category end);
end;
$$;
revoke all on function public.service_finish_form_coach_summary_dispatch(uuid,uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.service_finish_form_coach_summary_dispatch(uuid,uuid,uuid,text,text)
  to service_role;

-- Expiry changes only assessment status. Stable skip conditions are filtered before the bounded
-- page so old finished partials, active leases, and open retry windows cannot starve later work.
-- Those conditions are rechecked after the account and assessment locks are acquired.
create function public.service_expire_form_coach_assessments(target_limit smallint default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare candidate record; assessment_row public.form_coach_assessments%rowtype;
  expired_count integer:=0; now_value timestamptz; scan_time timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_limit is null or target_limit not between 1 and 100 then
    raise exception 'Assessment expiry limit is invalid' using errcode='22023';
  end if;
  scan_time:=clock_timestamp();
  for candidate in
    select assessment.id,assessment.member_subject_id,assessment.coach_subject_id
    from public.form_coach_assessments assessment
    where assessment.status in ('sent','in_progress') and assessment.due_at<=scan_time
      and not exists(select 1 from public.form_coach_attempts attempt
        where attempt.assessment_id=assessment.id and attempt.state='finished')
      and not exists(select 1 from public.form_coach_attempts attempt
        where attempt.assessment_id=assessment.id and attempt.state='running'
          and attempt.lease_expires_at>scan_time)
      and not exists(
        select 1 from public.form_coach_assessment_items item
        join public.form_coach_reviews latest_review on latest_review.id=(
          select review.id from public.form_coach_reviews review
          where review.item_id=item.id order by review.review_sequence desc limit 1
        )
        join public.form_coach_retry_windows retry_window on retry_window.review_id=latest_review.id
        where item.assessment_id=assessment.id and latest_review.verdict='needs_work'
          and retry_window.opens_at<=scan_time and retry_window.closes_at>scan_time
      )
    order by assessment.due_at,assessment.id limit 100
  loop
    begin
      perform private.form_coach_lock_subjects(array[candidate.member_subject_id,candidate.coach_subject_id]);
    exception when sqlstate '40001' then
      continue;
    end;
    select assessment.* into assessment_row from public.form_coach_assessments assessment
    where assessment.id=candidate.id for update skip locked;
    if not found then continue; end if;
    now_value:=clock_timestamp();
    if assessment_row.status not in ('sent','in_progress') or assessment_row.due_at>now_value then
      continue;
    end if;
    if exists(select 1 from public.form_coach_attempts attempt
      where attempt.assessment_id=assessment_row.id and attempt.state='finished') then
      continue;
    end if;
    if exists(select 1 from public.form_coach_attempts attempt
      where attempt.assessment_id=assessment_row.id and attempt.state='running'
        and attempt.lease_expires_at>now_value) then
      continue;
    end if;
    if exists(
      select 1 from public.form_coach_assessment_items item
      join public.form_coach_reviews latest_review on latest_review.id=(
        select review.id from public.form_coach_reviews review
        where review.item_id=item.id order by review.review_sequence desc limit 1
      )
      join public.form_coach_retry_windows retry_window on retry_window.review_id=latest_review.id
      where item.assessment_id=assessment_row.id and latest_review.verdict='needs_work'
        and retry_window.opens_at<=now_value and retry_window.closes_at>now_value
    ) then
      continue;
    end if;
    update public.form_coach_assessments set status='expired'
    where id=assessment_row.id and status in ('sent','in_progress') and due_at<=now_value;
    if found then expired_count:=expired_count+1; end if;
    exit when expired_count>=target_limit;
  end loop;
  return expired_count;
end;
$$;
revoke all on function public.service_expire_form_coach_assessments(smallint)
  from public,anon,authenticated;
grant execute on function public.service_expire_form_coach_assessments(smallint) to service_role;

-- Cleanup may suppress an outbox immediately, but a previously authorized numeric-only request
-- remains outstanding until it settles or its short local dispatch deadline passes.
create or replace function public.service_prepare_form_coach_account_cleanup(
  target_tombstone_id uuid,target_revision bigint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid; tombstone_state text; row_revision bigint;
  abandoned_count integer:=0; queued_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_tombstone_id is null or target_revision is null or target_revision<1 then
    raise exception 'Cleanup tombstone identity is invalid' using errcode='22023';
  end if;
  select tombstone.account_id,tombstone.tombstone_state,tombstone.revision
    into account_id,tombstone_state,row_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id;
  if not found or row_revision is distinct from target_revision
    or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Current closing tombstone is required' using errcode='55000';
  end if;
  perform private.form_coach_lock_subjects(array[account_id]);
  select tombstone.tombstone_state,tombstone.revision into tombstone_state,row_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id for share;
  if row_revision is distinct from target_revision or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Cleanup tombstone changed' using errcode='40001';
  end if;

  update public.form_coach_program_send_outbox outbox set state='suppressed',claim_token=null,
    lease_expires_at=null,last_outcome='account_deleting',updated_at=now()
  where outbox.state in ('pending','awaiting_funds','claimed')
    and (outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id);
  update public.form_coach_notification_outbox outbox set state='suppressed',claim_token=null,
    lease_expires_at=null,updated_at=now()
  where outbox.recipient_subject_id=account_id and outbox.state in ('pending','claimed');
  with candidates as (
    select outbox.id from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where outbox.state in ('pending','claimed')
      and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id)
    order by outbox.created_at,outbox.id for update of outbox skip locked limit 100
  )
  update public.form_coach_summary_outbox outbox set state='suppressed',claim_token=null,
    lease_expires_at=null,last_outcome='account_deleting',updated_at=now()
  from candidates where outbox.id=candidates.id;
  update public.form_coach_attempts attempt set state='abandoned',
    abandoned_at=coalesce(attempt.abandoned_at,now()),lease_expires_at=now()
  from public.form_coach_assessments assessment
  where attempt.assessment_id=assessment.id and attempt.state='running'
    and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id);
  insert into public.form_coach_media_cleanup_queue(asset_kind,asset_id,bucket_id,storage_path)
  select 'upload_intent',intent.id,intent.bucket_id,intent.storage_path
  from public.form_coach_media_upload_intents intent
  where intent.owner_subject_id=account_id and intent.state in ('uploaded','verified')
  on conflict(bucket_id,storage_path) do nothing;
  get diagnostics queued_count=row_count;
  update public.form_coach_media_upload_intents intent set state='delete_pending',updated_at=now()
  where intent.owner_subject_id=account_id and intent.state in ('uploaded','verified');
  update public.form_coach_template_asset_claims asset set source_guard_state='delete_pending'
  where asset.owner_subject_id=account_id and asset.source_guard_state='private_verified';
  update public.form_coach_attempt_clips clip set state='delete_pending',
    delete_requested_at=coalesce(clip.delete_requested_at,now())
  where clip.member_subject_id=account_id and clip.state='available';
  select count(*)::integer into abandoned_count from public.form_coach_attempts attempt
  join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
  where (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id)
    and attempt.state='abandoned';
  return jsonb_build_object('outcome','prepared','abandoned_attempts',abandoned_count,'queued_uploads',queued_count);
end;
$$;
revoke all on function public.service_prepare_form_coach_account_cleanup(uuid,bigint)
  from public,anon,authenticated;
grant execute on function public.service_prepare_form_coach_account_cleanup(uuid,bigint) to service_role;

create or replace function public.service_record_form_coach_auth_cleanup_proof(
  target_tombstone_id uuid,target_tombstone_revision bigint,target_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account_id uuid; tombstone_state text; current_revision bigint; unresolved_count bigint;
  source_digest text; proof_digest text; inventory jsonb; is_ready boolean; prepare_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode='42501';
  end if;
  if target_tombstone_id is null or target_tombstone_revision is null or target_request_id is null then
    raise exception 'Auth cleanup proof identity is invalid' using errcode='22023';
  end if;
  select tombstone.account_id,tombstone.tombstone_state,tombstone.revision
    into account_id,tombstone_state,current_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id;
  if not found or current_revision is distinct from target_tombstone_revision
    or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Current closing tombstone is required' using errcode='55000';
  end if;
  perform private.form_coach_lock_subjects(array[account_id]);
  prepare_result:=public.service_prepare_form_coach_account_cleanup(target_tombstone_id,target_tombstone_revision);
  select tombstone.tombstone_state,tombstone.revision into tombstone_state,current_revision
  from public.stream_media_account_tombstones tombstone where tombstone.id=target_tombstone_id for share;
  if current_revision is distinct from target_tombstone_revision or tombstone_state not in ('closing','provider_cleanup') then
    raise exception 'Cleanup tombstone changed' using errcode='40001';
  end if;
  select count(*) into unresolved_count from public.form_coach_media_upload_intents intent
  where intent.owner_subject_id=account_id and intent.state not in ('failed','deleted');
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_template_asset_claims asset
    where asset.owner_subject_id=account_id and asset.source_guard_state<>'deleted');
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_attempt_clips clip
    where clip.member_subject_id=account_id and clip.state<>'deleted');
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_media_cleanup_queue queue
    join public.form_coach_media_upload_intents intent on intent.id=queue.asset_id
    where intent.owner_subject_id=account_id and queue.state<>'complete');
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where attempt.state='running' and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id));
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_program_send_outbox outbox
    where outbox.state in ('pending','awaiting_funds','claimed')
      and (outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id));
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where outbox.state in ('pending','claimed')
      and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id));
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_summary_dispatches dispatch
    join public.form_coach_summary_outbox outbox on outbox.id=dispatch.outbox_id
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where dispatch.settled_at is null and dispatch.dispatch_deadline>clock_timestamp()
      and (assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id));
  unresolved_count:=unresolved_count+(select count(*) from public.form_coach_notification_outbox outbox
    where outbox.recipient_subject_id=account_id and outbox.state in ('pending','claimed'));
  is_ready:=unresolved_count=0;

  select coalesce(jsonb_agg(resource.value order by resource.value::text),'[]'::jsonb) into inventory
  from (
    select jsonb_build_object('kind','upload','id',intent.id,'state',intent.state,'bucket',intent.bucket_id,
      'path',intent.storage_path,'expected',intent.expected_sha256,'observed',intent.observed_sha256,
      'proof',intent.source_proof_digest) as value
    from public.form_coach_media_upload_intents intent where intent.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','asset_claim','id',asset.id,'state',asset.source_guard_state,
      'upload',asset.upload_intent_id,'sha',asset.content_sha256) from public.form_coach_template_asset_claims asset
    where asset.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','clip','id',clip.id,'state',clip.state,'upload',clip.upload_intent_id,
      'delete_after',clip.delete_after,'sha',clip.content_sha256) from public.form_coach_attempt_clips clip
    where clip.member_subject_id=account_id
    union all
    select jsonb_build_object('kind','cleanup','id',queue.id,'state',queue.state,'asset',queue.asset_id,
      'evidence',queue.evidence_digest) from public.form_coach_media_cleanup_queue queue
    join public.form_coach_media_upload_intents intent on intent.id=queue.asset_id
    where intent.owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','attempt','id',attempt.id,'state',attempt.state,
      'result_digest',attempt.result_digest) from public.form_coach_attempts attempt
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id
    union all
    select jsonb_build_object('kind','program_send','id',outbox.id,'state',outbox.state,
      'outcome',outbox.last_outcome,'assessment_id',outbox.assessment_id)
    from public.form_coach_program_send_outbox outbox
    where outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','program_send_item','outbox_id',item.outbox_id,
      'ordinal',item.item_ordinal,'template_version',item.template_version_id)
    from public.form_coach_program_send_outbox_items item
    join public.form_coach_program_send_outbox outbox on outbox.id=item.outbox_id
    where outbox.member_subject_id=account_id or outbox.program_owner_subject_id=account_id
    union all
    select jsonb_build_object('kind','summary_outbox','id',outbox.id,'state',outbox.state,
      'attempt_id',outbox.attempt_id,'completed_digest',outbox.completed_digest)
    from public.form_coach_summary_outbox outbox
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id
    union all
    select jsonb_build_object('kind','summary_dispatch','outbox_id',dispatch.outbox_id,
      'authorized_at',dispatch.authorized_at,'dispatch_deadline',dispatch.dispatch_deadline,
      'settled_at',dispatch.settled_at,'outcome_category',dispatch.outcome_category)
    from public.form_coach_summary_dispatches dispatch
    join public.form_coach_summary_outbox outbox on outbox.id=dispatch.outbox_id
    join public.form_coach_attempts attempt on attempt.id=outbox.attempt_id
    join public.form_coach_assessments assessment on assessment.id=attempt.assessment_id
    where assessment.member_subject_id=account_id or assessment.coach_subject_id=account_id
    union all
    select jsonb_build_object('kind','notification_outbox','id',outbox.id,'state',outbox.state,
      'event_kind',outbox.event_kind,'assessment_id',outbox.assessment_id)
    from public.form_coach_notification_outbox outbox where outbox.recipient_subject_id=account_id
  ) resource;
  source_digest:=encode(extensions.digest(convert_to(inventory::text,'UTF8'),'sha256'),'hex');
  proof_digest:=encode(extensions.digest(convert_to(concat_ws('|',target_tombstone_id::text,account_id::text,
    target_tombstone_revision::text,'form_coach_workflow','1','1',
    case when is_ready then 'ready' else 'incomplete' end,source_digest),'UTF8'),'sha256'),'hex');
  perform public.record_stream_auth_cleanup_component_proof(
    target_tombstone_id,target_tombstone_revision,'form_coach_workflow',1,1,
    case when is_ready then 'ready' else 'incomplete' end,source_digest,proof_digest,target_request_id
  );
  return jsonb_build_object('component_key','form_coach_workflow','component_version',1,
    'resource_set_revision',1,'ready',is_ready,'unresolved_count',unresolved_count,
    'source_revision_digest',source_digest,'proof_digest',proof_digest,'prepare',prepare_result);
end;
$$;
revoke all on function public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid)
  from public,anon,authenticated;
grant execute on function public.service_record_form_coach_auth_cleanup_proof(uuid,bigint,uuid)
  to service_role;
