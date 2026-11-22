-- Narrow app-facing reads for Form Coach. Workflow rows remain private and all reference reads
-- are derived from the immutable version pinned by an authorized assessment item.

create function public.list_coach_form_coach_assessments(
  target_page integer default 1,
  target_page_size integer default 20,
  target_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.user_role;
  safe_page integer;
  safe_size integer;
  total_count bigint;
  output_rows jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'Authenticated access is required' using errcode = '42501';
  end if;
  if target_page is null or target_page < 1
    or target_page_size is null or target_page_size not between 1 and 50
    or (target_status is not null and target_status not in ('sent','in_progress','completed','cancelled','expired')) then
    raise exception 'Assessment page is invalid' using errcode = '22023';
  end if;

  safe_page := least(target_page, 1000000);
  safe_size := target_page_size;
  select profile.role into actor_role
  from public.profiles profile where profile.id = actor_id;
  if actor_role is distinct from 'coach'::public.user_role then
    return jsonb_build_object('rows','[]'::jsonb,'page',safe_page,'has_more',false);
  end if;

  select count(*) into total_count
  from public.form_coach_assessments assessment
  where assessment.coach_subject_id = actor_id
    and assessment.coach_owner_id = actor_id
    and assessment.member_owner_id = assessment.member_subject_id
    and (target_status is null or assessment.status = target_status)
    and exists (
      select 1 from public.coach_members link
      where link.coach_id = actor_id and link.member_id = assessment.member_subject_id
    );

  select coalesce(jsonb_agg(page_row.value order by page_row.sent_at desc, page_row.assessment_id desc),'[]'::jsonb)
    into output_rows
  from (
    select jsonb_build_object(
      'assessment_id',assessment.id,
      'member_id',assessment.member_subject_id,
      'source_kind',assessment.source_kind,
      'program_title',assessment.program_title_snapshot,
      'sent_at',assessment.sent_at,
      'due_at',assessment.due_at,
      'status',assessment.status,
      'item_count',(select count(*) from public.form_coach_assessment_items item
        where item.assessment_id = assessment.id),
      'finished_attempt_count',(select count(*) from public.form_coach_attempts attempt
        where attempt.assessment_id = assessment.id and attempt.state = 'finished'),
      'allow_member_clip',assessment.allow_member_clip
    ) as value,
    assessment.sent_at,
    assessment.id as assessment_id
    from public.form_coach_assessments assessment
    where assessment.coach_subject_id = actor_id
      and assessment.coach_owner_id = actor_id
      and assessment.member_owner_id = assessment.member_subject_id
      and (target_status is null or assessment.status = target_status)
      and exists (
        select 1 from public.coach_members link
        where link.coach_id = actor_id and link.member_id = assessment.member_subject_id
      )
    order by assessment.sent_at desc, assessment.id desc
    limit safe_size offset ((safe_page - 1) * safe_size)
  ) page_row;

  return jsonb_build_object(
    'rows',output_rows,
    'page',safe_page,
    'has_more',total_count > safe_page * safe_size
  );
end;
$$;
revoke all on function public.list_coach_form_coach_assessments(integer,integer,text)
  from public, anon, service_role;
grant execute on function public.list_coach_form_coach_assessments(integer,integer,text) to authenticated;

-- Extend the existing privacy-filtered detail read without widening its actor set. Capabilities
-- mirror the start RPC's per-item lease, allowance, retry, access, and deletion-fence guards.
create function public.get_form_coach_workflow_detail(target_assessment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.user_role;
  assessment public.form_coach_assessments%rowtype;
  expired_attempt public.form_coach_attempts%rowtype;
  item_row record;
  latest_review public.form_coach_reviews%rowtype;
  result_value jsonb;
  items_value jsonb;
  current_terms integer;
  current_status text;
  receipt_ok boolean := false;
  has_receipt boolean := false;
  member_access boolean := false;
  funding_access boolean := false;
  tombstoned boolean := false;
  consent_ok boolean := false;
  has_latest_review boolean := false;
  active_retry boolean := false;
  has_expired_running boolean := false;
  has_active_running boolean := false;
  resume_clip_opt_in boolean;
  allowed_attempts integer;
  prior_count integer;
  item_can_start boolean := false;
  item_can_resume boolean := false;
  can_attempt_value boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null or target_assessment_id is null then
    return null;
  end if;
  select profile.role into actor_role
  from public.profiles profile where profile.id = actor_id;
  if actor_role is null or actor_role not in ('member'::public.user_role,'coach'::public.user_role) then
    return null;
  end if;

  result_value := public.get_form_coach_assessment(target_assessment_id);
  if result_value is null then return null; end if;
  select coalesce(jsonb_agg(
    item_json.value || jsonb_build_object(
      'can_start_new',false,'can_resume',false,'resume_clip_opt_in',null
    )
    order by item_json.ordinality
  ),'[]'::jsonb) into items_value
  from jsonb_array_elements(result_value -> 'items') with ordinality as item_json(value,ordinality);
  result_value := jsonb_set(result_value,'{items}',items_value,false);
  select row.* into assessment
  from public.form_coach_assessments row
  where row.id = target_assessment_id;
  if not found then return null; end if;

  if actor_role = 'coach'::public.user_role then
    if assessment.coach_subject_id is distinct from actor_id
      or assessment.coach_owner_id is distinct from actor_id
      or not exists (
        select 1 from public.coach_members link
        where link.coach_id = actor_id and link.member_id = assessment.member_subject_id
      ) then
      return null;
    end if;
  elsif assessment.member_subject_id is distinct from actor_id
    or assessment.member_owner_id is distinct from actor_id then
    return null;
  end if;

  if actor_role = 'member'::public.user_role then
    select current_terms.version into current_terms
    from public.form_coach_terms_current current_terms
    where current_terms.singleton;

    select revision.status into current_status
    from public.feature_pricing_current current
    join public.feature_pricing_revisions revision
      on revision.feature_key = current.feature_key and revision.revision = current.revision
    where current.feature_key = 'form_coach';
    select exists (
      select 1 from public.feature_bundle_funding_receipts receipt
      where receipt.feature_key = 'form_coach'
        and receipt.bundle_id = assessment.id
        and receipt.payer_role = assessment.payer_role
        and receipt.payer_id = assessment.payer_subject_id
        and receipt.config_revision = assessment.config_revision
        and receipt.due_at = assessment.due_at
    ) into receipt_ok;
    select exists (
      select 1 from public.feature_bundle_funding_receipts receipt
      where receipt.feature_key = 'form_coach' and receipt.bundle_id = assessment.id
    ) into has_receipt;
    select current_terms is not null and exists (
      select 1 from public.form_coach_member_consents consent
      where consent.member_subject_id = actor_id
        and consent.member_owner_id = actor_id
        and consent.terms_version = current_terms
    ) into consent_ok;
    tombstoned := private.form_coach_subject_has_deletion_fence(actor_id)
      or private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
      or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id)
      or private.form_coach_subject_has_deletion_fence(assessment.payer_subject_id);
    member_access := assessment.member_subject_id = actor_id
      and assessment.member_owner_id = actor_id
      and assessment.coach_owner_id is not null
      and private.has_platform_tier(actor_id,'regular')
      and private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
      and exists (
        select 1 from public.coach_members link
        where link.coach_id = assessment.coach_subject_id and link.member_id = actor_id
      );
    funding_access := not has_receipt and assessment.payer_role = 'member' and current_status = 'live';
    funding_access := funding_access or receipt_ok;

    if consent_ok and member_access and funding_access and not tombstoned
      and current_status is not null and current_status <> 'disabled'
      and assessment.status not in ('cancelled','completed') then
      for item_row in
        select item.id, item.max_attempts
        from public.form_coach_assessment_items item
        where item.assessment_id = assessment.id
        order by item.item_ordinal
      loop
        has_latest_review := false;
        active_retry := false;
        resume_clip_opt_in := null;
        select review.* into latest_review
        from public.form_coach_reviews review
        where review.item_id = item_row.id
        order by review.review_sequence desc
        limit 1;
        has_latest_review := found;
        if has_latest_review and latest_review.verdict = 'needs_work' then
          select exists (
            select 1 from public.form_coach_retry_windows retry_window
            where retry_window.review_id = latest_review.id
              and retry_window.assessment_id = assessment.id
              and retry_window.item_id = item_row.id
              and retry_window.opens_at <= now()
              and retry_window.closes_at > now()
          ) into active_retry;
        end if;

        select least(12,item_row.max_attempts + coalesce(sum(retry_window.additional_attempts),0)::integer)
          into allowed_attempts
        from public.form_coach_retry_windows retry_window
        join public.form_coach_reviews retry_review
          on retry_review.id = retry_window.review_id and retry_review.verdict = 'needs_work'
        where retry_window.item_id = item_row.id;
        select count(*)::integer into prior_count
        from public.form_coach_attempts attempt where attempt.item_id = item_row.id;
        select attempt.* into expired_attempt
        from public.form_coach_attempts attempt
        where attempt.item_id = item_row.id and attempt.state = 'running'
          and attempt.lease_expires_at <= now()
        order by attempt.attempt_number
        limit 1;
        has_expired_running := found;
        if has_expired_running then
          resume_clip_opt_in := expired_attempt.clip_opt_in;
        end if;
        select exists (
          select 1 from public.form_coach_attempts attempt
          where attempt.item_id = item_row.id and attempt.state = 'running'
            and attempt.lease_expires_at > now()
        ) into has_active_running;

        if (not has_latest_review or latest_review.verdict = 'needs_work' and active_retry)
          and (active_retry or (assessment.status <> 'expired' and assessment.due_at > now())) then
          item_can_resume := has_expired_running;
          item_can_start := not has_expired_running and not has_active_running
            and prior_count < allowed_attempts
            and (active_retry or (assessment.status <> 'expired' and assessment.due_at > now()));
        else
          item_can_resume := false;
          item_can_start := false;
        end if;
        if active_retry and not receipt_ok then
          item_can_resume := false;
          item_can_start := false;
        end if;

        items_value := (
          select coalesce(jsonb_agg(
            case when item_json.value ->> 'item_id' = item_row.id::text then
              item_json.value || jsonb_build_object(
                'can_start_new',item_can_start,
                'can_resume',item_can_resume,
                'resume_clip_opt_in',case when item_can_resume then resume_clip_opt_in else null end
              )
            else item_json.value end
            order by item_json.ordinality
          ),'[]'::jsonb)
          from jsonb_array_elements(result_value -> 'items') with ordinality as item_json(value,ordinality)
        );
        result_value := jsonb_set(result_value,'{items}',items_value,false);
        can_attempt_value := can_attempt_value or item_can_start or item_can_resume;
      end loop;
    end if;
  end if;

  result_value := result_value || jsonb_build_object(
    'allow_member_clip',assessment.allow_member_clip,
    'can_attempt',can_attempt_value
  );
  if actor_role = 'coach'::public.user_role then
    result_value := result_value || jsonb_build_object('member_id',assessment.member_subject_id);
  end if;
  return result_value;
end;
$$;
revoke all on function public.get_form_coach_workflow_detail(uuid) from public, anon, service_role;
grant execute on function public.get_form_coach_workflow_detail(uuid) to authenticated;

-- Service-only signing lookup. The server supplies actor_id from its authenticated session; this
-- RPC independently verifies the current role/relationship and returns only the exact pinned
-- private object. Viewing a reference is read-only and does not require camera-practice consent,
-- consume attempt allowance, or accept a caller-selected path.
create function public.service_read_form_coach_reference_asset(
  target_actor_id uuid,
  target_assessment_id uuid,
  target_item_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role public.user_role;
  assessment public.form_coach_assessments%rowtype;
  template_id_value uuid;
  template_owner_id uuid;
  template_version_id_value uuid;
  asset_id_value uuid;
  asset_owner_id uuid;
  asset_bucket_id text;
  asset_storage_path text;
  asset_sha256 text;
  asset_byte_size bigint;
  feature_status text;
  receipt_ok boolean := false;
  latest_review public.form_coach_reviews%rowtype;
  has_latest_review boolean := false;
  active_retry boolean := false;
  retry_closes_at timestamptz;
  has_receipt boolean := false;
  authorized_until timestamptz;
  authorized_ttl_seconds integer := 600;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access is required' using errcode = '42501';
  end if;
  if target_actor_id is null or target_assessment_id is null or target_item_id is null then
    return null;
  end if;

  select profile.role into actor_role
  from public.profiles profile where profile.id = target_actor_id;
  if actor_role is null or actor_role not in ('member'::public.user_role,'coach'::public.user_role) then
    return null;
  end if;

  select row.* into assessment
  from public.form_coach_assessments row
  where row.id = target_assessment_id;
  if not found or assessment.member_owner_id is distinct from assessment.member_subject_id
    or assessment.coach_owner_id is distinct from assessment.coach_subject_id
    or private.form_coach_subject_has_deletion_fence(target_actor_id)
    or private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id)
    or private.form_coach_subject_has_deletion_fence(assessment.payer_subject_id) then
    return null;
  end if;

  select item.template_version_id, template.id, template.owner_subject_id
    into template_version_id_value, template_id_value, template_owner_id
  from public.form_coach_assessment_items item
  join public.form_coach_template_versions version
    on version.id = item.template_version_id and version.state = 'published'
  join public.form_coach_templates template on template.id = version.template_id
  where item.id = target_item_id and item.assessment_id = assessment.id;
  if not found or private.form_coach_subject_has_deletion_fence(template_owner_id) then
    return null;
  end if;

  select asset.id, asset.owner_subject_id, asset.bucket_id, asset.storage_path,
    asset.content_sha256, asset.byte_size
    into asset_id_value, asset_owner_id, asset_bucket_id, asset_storage_path,
      asset_sha256, asset_byte_size
  from public.form_coach_template_asset_claims asset
  where asset.template_version_id = template_version_id_value
    and asset.asset_key = 'reference'
    and asset.bucket_id = 'form-coach-reference'
    and asset.source_guard_state = 'private_verified'
    and asset.owner_subject_id = template_owner_id;
  if not found or asset_owner_id is distinct from template_owner_id then
    return null;
  end if;

  if actor_role = 'coach'::public.user_role then
    if assessment.coach_subject_id is distinct from target_actor_id
      or assessment.coach_owner_id is distinct from target_actor_id
      or not exists (
        select 1 from public.coach_members link
        where link.coach_id = target_actor_id and link.member_id = assessment.member_subject_id
      ) then
      return null;
    end if;
    authorized_until := null;
  else
    if assessment.member_subject_id is distinct from target_actor_id
      or assessment.member_owner_id is distinct from target_actor_id
      or assessment.status in ('cancelled','completed')
      or not private.has_platform_tier(target_actor_id,'regular')
      or assessment.coach_owner_id is null
      or not private.has_role(assessment.coach_subject_id,'coach'::public.user_role)
      or not exists (
        select 1 from public.coach_members link
        where link.coach_id = assessment.coach_subject_id and link.member_id = target_actor_id
      ) then
      return null;
    end if;

    select revision.status into feature_status
    from public.feature_pricing_current current
    join public.feature_pricing_revisions revision
      on revision.feature_key = current.feature_key and revision.revision = current.revision
    where current.feature_key = 'form_coach';
    if feature_status is null or feature_status = 'disabled' then return null; end if;

    select exists (
      select 1 from public.feature_bundle_funding_receipts receipt
      where receipt.feature_key = 'form_coach'
        and receipt.bundle_id = assessment.id
        and receipt.payer_role = assessment.payer_role
        and receipt.payer_id = assessment.payer_subject_id
        and receipt.config_revision = assessment.config_revision
        and receipt.due_at = assessment.due_at
    ) into receipt_ok;
    select exists (
      select 1 from public.feature_bundle_funding_receipts receipt
      where receipt.feature_key = 'form_coach' and receipt.bundle_id = assessment.id
    ) into has_receipt;
    if (has_receipt and not receipt_ok)
      or (not receipt_ok and not (assessment.payer_role = 'member' and feature_status = 'live')) then
      return null;
    end if;

    select review.* into latest_review
    from public.form_coach_reviews review
    where review.item_id = target_item_id
    order by review.review_sequence desc
    limit 1;
    has_latest_review := found;
    if has_latest_review and latest_review.verdict = 'needs_work' then
      select retry_window.closes_at into retry_closes_at
      from public.form_coach_retry_windows retry_window
      where retry_window.review_id = latest_review.id
        and retry_window.assessment_id = assessment.id
        and retry_window.item_id = target_item_id
        and retry_window.opens_at <= now()
        and retry_window.closes_at > now();
      active_retry := found;
    end if;
    if (assessment.status = 'expired' or assessment.due_at <= now()) and not active_retry then
      return null;
    end if;
    if active_retry and not receipt_ok then return null; end if;

    if active_retry then
      authorized_until := retry_closes_at;
    else
      authorized_until := assessment.due_at;
    end if;
    if authorized_until is null or authorized_until <= now() then return null; end if;
    authorized_ttl_seconds := least(600,floor(extract(epoch from authorized_until - now()))::integer);
    if authorized_ttl_seconds <= 5 then return null; end if;
  end if;

  return jsonb_build_object(
    'authorized_actor_id',target_actor_id,
    'authorized_role',actor_role::text,
    'assessment_id',assessment.id,
    'item_id',target_item_id,
    'template_id',template_id_value,
    'template_version_id',template_version_id_value,
    'asset_id',asset_id_value,
    'asset_owner_id',asset_owner_id,
    'asset_key','reference',
    'bucket_id',asset_bucket_id,
    'storage_path',asset_storage_path,
    'content_sha256',asset_sha256,
    'byte_size',asset_byte_size,
    'authorized_until',authorized_until,
    'authorized_ttl_seconds',authorized_ttl_seconds
  );
end;
$$;
revoke all on function public.service_read_form_coach_reference_asset(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.service_read_form_coach_reference_asset(uuid,uuid,uuid) to service_role;
