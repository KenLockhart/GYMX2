-- Recovery for an abandoned or stale authoring candidate only.
-- Published content, offer rows, and immutable request receipts are not changed here.

create function public.discard_program_authoring_draft(
  target_program_id uuid,
  target_actor_id uuid,
  target_draft_id uuid,
  target_expected_draft_revision bigint,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  state_row public.program_commerce_state%rowtype;
  draft_row private.program_authoring_drafts%rowtype;
begin
  if target_program_id is null or target_actor_id is null or target_draft_id is null
    or target_expected_draft_revision is null or target_expected_draft_revision < 1
    or target_expected_content_version_id is null or target_expected_offer_version_id is null then
    raise exception 'Program draft recovery request is invalid' using errcode = '22023';
  end if;

  -- Draft lessons do not own or mutate media. Lock the Program scope and fences only;
  -- an unresolved optional draft video must not prevent its owner from discarding it.
  perform private.lock_program_authoring_scope(target_program_id, target_actor_id, false);

  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found
    or state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program content or offer changed; reload before discarding the draft'
      using errcode = '40001';
  end if;

  select * into draft_row from private.program_authoring_drafts draft
  where draft.program_id = target_program_id for update;

  if not found then
    return jsonb_build_object(
      'status', 'already_absent',
      'program_id', target_program_id,
      'draft_id', target_draft_id,
      'draft_revision', target_expected_draft_revision
    );
  end if;

  if draft_row.draft_id is distinct from target_draft_id
    or draft_row.revision is distinct from target_expected_draft_revision then
    return jsonb_build_object(
      'status', 'conflict',
      'program_id', target_program_id,
      'draft_id', target_draft_id
    );
  end if;

  delete from private.program_authoring_drafts draft
  where draft.program_id = target_program_id
    and draft.draft_id = target_draft_id
    and draft.revision = target_expected_draft_revision;
  if not found then
    return jsonb_build_object(
      'status', 'conflict',
      'program_id', target_program_id,
      'draft_id', target_draft_id
    );
  end if;

  return jsonb_build_object(
    'status', 'discarded',
    'program_id', target_program_id,
    'draft_id', target_draft_id,
    'draft_revision', target_expected_draft_revision
  );
end;
$$;
revoke all on function public.discard_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.discard_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid)
  to service_role;
