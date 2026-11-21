-- Coach review UI projection. Review writes still go through the existing guarded
-- record_form_coach_review RPC; this read only adds its current sequence and capabilities.
create function public.get_coach_form_coach_review_detail(target_assessment_id uuid)
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
  detail_value jsonb;
  items_value jsonb;
  feature_status text;
  receipt_ok boolean := false;
  base_review_allowed boolean := false;
begin
  if auth.role() is distinct from 'authenticated'
    or actor_id is null
    or target_assessment_id is null then
    return null;
  end if;

  select profile.role into actor_role
  from public.profiles profile
  where profile.id = actor_id;
  if actor_role is distinct from 'coach'::public.user_role then
    return null;
  end if;

  -- Reuse the existing role, ownership, current-link, and narrow-detail checks. This wrapper
  -- returns null for the same generic unavailable state and never creates an admin read path.
  detail_value := public.get_form_coach_workflow_detail(target_assessment_id);
  if detail_value is null then
    return null;
  end if;

  select row.* into assessment
  from public.form_coach_assessments row
  where row.id = target_assessment_id;
  if not found then
    return null;
  end if;

  select revision.status into feature_status
  from public.feature_pricing_current current
  join public.feature_pricing_revisions revision
    on revision.feature_key = current.feature_key
    and revision.revision = current.revision
  where current.feature_key = 'form_coach';

  select exists (
    select 1
    from public.feature_bundle_funding_receipts receipt
    where receipt.feature_key = 'form_coach'
      and receipt.bundle_id = assessment.id
      and receipt.payer_role = assessment.payer_role
      and receipt.payer_id = assessment.payer_subject_id
      and receipt.config_revision = assessment.config_revision
      and receipt.due_at = assessment.due_at
  ) into receipt_ok;

  -- These flags mirror the existing review RPC's non-replay guards. They are advisory UI
  -- capabilities; record_form_coach_review remains authoritative and rechecks under its locks.
  base_review_allowed := assessment.member_owner_id is not null
    and assessment.coach_owner_id is not null
    and assessment.status <> 'cancelled'
    and feature_status is not null
    and feature_status <> 'disabled'
    and receipt_ok
    and not private.form_coach_subject_has_deletion_fence(actor_id)
    and not private.form_coach_subject_has_deletion_fence(assessment.member_subject_id)
    and not private.form_coach_subject_has_deletion_fence(assessment.coach_subject_id);

  select coalesce(jsonb_agg(
    item_json.value || jsonb_build_object(
      'expected_review_sequence', item_facts.expected_review_sequence,
      'can_review', item_facts.can_review,
      'can_open_retry', item_facts.can_open_retry,
      'max_extra_attempts', item_facts.max_extra_attempts
    ) order by item_json.ordinality
  ), '[]'::jsonb)
  into items_value
  from jsonb_array_elements(detail_value -> 'items') with ordinality as item_json(value, ordinality)
  cross join lateral (
    select
      item.id,
      coalesce((
        select max(review.review_sequence)::integer
        from public.form_coach_reviews review
        where review.item_id = item.id
      ), 0) as expected_review_sequence,
      exists (
        select 1 from public.form_coach_attempts attempt
        where attempt.item_id = item.id
          and attempt.assessment_id = assessment.id
          and attempt.state = 'finished'
      ) as has_finished_attempt,
      exists (
        select 1 from public.form_coach_reviews review
        where review.item_id = item.id and review.verdict = 'learned'
      ) as has_learned_review,
      (select count(*)::integer from public.form_coach_retry_windows retry_window
        where retry_window.item_id = item.id) as retry_window_count,
      (select coalesce(sum(retry_window.additional_attempts), 0)::integer
        from public.form_coach_retry_windows retry_window
        where retry_window.item_id = item.id) as retry_extra_count
    from public.form_coach_assessment_items item
    where item.id = (item_json.value ->> 'item_id')::uuid
      and item.assessment_id = assessment.id
  ) facts
  cross join lateral (
    select
      facts.expected_review_sequence,
      base_review_allowed and facts.has_finished_attempt and not facts.has_learned_review as can_review,
      base_review_allowed and facts.has_finished_attempt and not facts.has_learned_review
        and facts.retry_window_count < 3 and facts.retry_extra_count < 9 as can_open_retry,
      greatest(0, least(3, 9 - facts.retry_extra_count)) as max_extra_attempts
  ) item_facts;

  return jsonb_set(detail_value, '{items}', items_value, false);
end;
$$;

revoke all on function public.get_coach_form_coach_review_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_coach_form_coach_review_detail(uuid) to authenticated;
