-- Optional Program intro compatibility. The existing non-NULL validation remains exact.

create or replace function public.publish_program_authoring_draft(
  target_program_id uuid,
  target_actor_id uuid,
  target_draft_id uuid,
  target_expected_draft_revision bigint,
  target_expected_content_version_id uuid,
  target_expected_offer_version_id uuid,
  target_request_id uuid,
  target_list_price_cents integer,
  target_max_installments smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_owner_id uuid;
  actor_role text;
  program_row public.programs%rowtype;
  state_row public.program_commerce_state%rowtype;
  offer_row public.program_offer_versions%rowtype;
  draft_row private.program_authoring_drafts%rowtype;
  intro_video public.videos%rowtype;
  selected_video public.videos%rowtype;
  new_content_version_id uuid;
  offer_version_id uuid;
  free_snapshot_id uuid;
  pointer_content_id uuid;
  pointer_offer_id uuid;
  revision_number integer;
  offer_number integer;
  lesson_count integer;
  connected_account text;
  request_digest text;
  replay_result jsonb;
  result jsonb;
begin
  if target_program_id is null or target_actor_id is null or target_draft_id is null
    or target_expected_draft_revision is null or target_expected_draft_revision < 1
    or target_expected_content_version_id is null or target_expected_offer_version_id is null
    or target_request_id is null or target_list_price_cents is null or target_list_price_cents < 50
    or target_max_installments is null or target_max_installments < 1 or target_max_installments > 12 then
    raise exception 'Program publication request is invalid' using errcode = '22023';
  end if;
  request_digest := private.stream_media_identity_digest(concat_ws(chr(31),
    'publish_content', target_program_id::text, target_actor_id::text, target_draft_id::text,
    target_expected_draft_revision::text, target_expected_content_version_id::text,
    target_expected_offer_version_id::text, target_list_price_cents::text,
    target_max_installments::text
  ));

  program_owner_id := private.lock_program_authoring_scope(target_program_id, target_actor_id, true);
  select profile.role::text into actor_role
  from public.profiles profile where profile.id = target_actor_id;
  replay_result := private.program_authoring_receipt_replay(
    target_request_id, target_program_id, target_actor_id, 'publish_content', request_digest
  );
  if replay_result is not null then return replay_result; end if;

  select * into program_row from public.programs program
  where program.id = target_program_id for update;
  select * into state_row from public.program_commerce_state state
  where state.program_id = target_program_id for update;
  if not found then raise exception 'Program commerce state is unavailable' using errcode = '55000'; end if;
  if state_row.current_content_version_id is distinct from target_expected_content_version_id
    or state_row.current_offer_version_id is distinct from target_expected_offer_version_id then
    raise exception 'Program offer changed; reload before publication' using errcode = '40001';
  end if;
  select * into offer_row from public.program_offer_versions offer
  where offer.program_id = target_program_id and offer.id = state_row.current_offer_version_id;
  if not found then raise exception 'Program offer is unavailable' using errcode = '55000'; end if;
  select * into draft_row from private.program_authoring_drafts draft
  where draft.program_id = target_program_id for update;
  if not found or draft_row.draft_id is distinct from target_draft_id
    or draft_row.revision is distinct from target_expected_draft_revision
    or draft_row.base_content_version_id is distinct from state_row.current_content_version_id
    or draft_row.base_offer_version_id is distinct from state_row.current_offer_version_id then
    raise exception 'Program draft changed; reload before publication' using errcode = '40001';
  end if;
  select count(*)::integer into lesson_count
  from private.program_authoring_draft_lessons lesson
  where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id;
  if lesson_count < 1 or lesson_count > 365
    or target_max_installments > least(12, lesson_count)
    or exists (
      select 1 from (
        select lesson.lesson_ordinal, lesson.timeline_day_number,
          row_number() over (order by lesson.lesson_ordinal) as expected_ordinal,
          lag(lesson.timeline_day_number) over (order by lesson.lesson_ordinal) as prior_day
        from private.program_authoring_draft_lessons lesson
        where lesson.program_id = target_program_id and lesson.draft_id = draft_row.draft_id
      ) ordered
      where ordered.lesson_ordinal <> ordered.expected_ordinal
        or (ordered.prior_day is not null and ordered.timeline_day_number <= ordered.prior_day)
    ) then
    raise exception 'Program draft lesson sequence is incomplete' using errcode = '23514';
  end if;
  if exists (
    select 1
    from private.program_authoring_draft_lessons draft_lesson
    left join public.videos video on video.id = draft_lesson.video_id
    where draft_lesson.program_id = target_program_id
      and draft_lesson.draft_id = draft_row.draft_id
      and draft_lesson.video_id is not null
      and (
        video.id is null
        or video.coach_id is distinct from program_owner_id
        or video.status::text <> 'ready'
        or video.daily_content_deletion_pending
        or video.visibility not in ('private', 'program_only')
        or video.stream_provider_account_registry_id is null
        or video.cloudflare_uid is null
        or not private.stream_account_is_verified(video.stream_provider_account_registry_id)
        or not exists (
          select 1 from public.stream_media_parent_fences source_fence
          where source_fence.source_kind = 'profile'
            and source_fence.source_identity = program_owner_id::text
            and source_fence.owner_id = program_owner_id
            and source_fence.fence_state = 'open'
            and source_fence.active_operation_id is null
        )
        or not (
          private.stream_source_binding_ready(
            'video', video.id::text, program_owner_id,
            video.stream_provider_account_registry_id, video.cloudflare_uid
          )
          or exists (
            select 1
            from public.program_content_version_lessons existing_lesson
            join public.program_content_versions existing_version
              on existing_version.program_id = existing_lesson.program_id
             and existing_version.id = existing_lesson.content_version_id
             and existing_version.revision_kind = 'paid'
            join public.stream_media_source_bindings existing_binding
              on existing_binding.source_kind = 'program_lesson'
             and existing_binding.source_identity = existing_lesson.id::text
             and existing_binding.owner_id = program_owner_id
             and existing_binding.registry_id = video.stream_provider_account_registry_id
             and existing_binding.raw_provider_uid = video.cloudflare_uid
             and existing_binding.binding_state in ('ready_for_publication', 'active', 'retained')
            join public.stream_media_assets existing_asset
              on existing_asset.id = existing_binding.asset_id
             and existing_asset.registry_id = existing_binding.registry_id
             and existing_asset.raw_provider_uid = existing_binding.raw_provider_uid
             and existing_asset.lifecycle_state = 'ready_for_publication'
             and existing_asset.signed_urls_verified
             and existing_asset.ready_to_stream_verified
            where existing_lesson.program_id = target_program_id
              and existing_lesson.video_id = video.id
              and existing_lesson.cloudflare_uid = video.cloudflare_uid
              and existing_lesson.video_creator_id = program_owner_id
          )
        )
        or private.stream_legacy_uid_unresolved(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        or private.stream_media_uid_reserved(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        or private.stream_uid_blocks_new_media_reference(
          video.stream_provider_account_registry_id, video.cloudflare_uid
        )
        -- The Program lock holds the same verified-registry UID mutex used by the
        -- Daily Content source guards. Re-read these rows after that lock so an
        -- existing Daily revision or slot cannot be silently converted to Program-only.
        or exists (
          select 1
          from public.daily_content_revisions daily_revision
          join public.videos daily_video on daily_video.id = daily_revision.video_id
          where daily_revision.video_id = video.id
             or (daily_video.stream_provider_account_registry_id = video.stream_provider_account_registry_id
                 and daily_video.cloudflare_uid = video.cloudflare_uid)
        )
        or exists (
          select 1
          from public.daily_content_slots daily_slot
          join public.daily_content_revisions daily_revision
            on daily_revision.id = daily_slot.revision_id
          join public.videos daily_video on daily_video.id = daily_revision.video_id
          where daily_slot.status in ('scheduled', 'published')
            and (daily_revision.video_id = video.id
              or (daily_video.stream_provider_account_registry_id = video.stream_provider_account_registry_id
                  and daily_video.cloudflare_uid = video.cloudflare_uid))
        )
      )
  ) then
    raise exception 'A selected Program lesson video is missing or not ready for publication'
      using errcode = '23514';
  end if;
  if program_row.intro_video_id is not null then
  select * into intro_video from public.videos video
  where video.id = program_row.intro_video_id;
  if not found or intro_video.coach_id is distinct from program_owner_id
    or intro_video.status::text <> 'ready' or intro_video.daily_content_deletion_pending
    or intro_video.stream_provider_account_registry_id is null
    or intro_video.cloudflare_uid is null
    or private.stream_account_is_tombstoned(intro_video.coach_id)
    or not private.stream_account_is_verified(intro_video.stream_provider_account_registry_id)
    or not exists (
      select 1 from public.stream_media_parent_fences source_fence
      where source_fence.source_kind = 'profile'
        and source_fence.source_identity = program_owner_id::text
        and source_fence.owner_id = program_owner_id
        and source_fence.fence_state = 'open'
        and source_fence.active_operation_id is null
    )
    or private.stream_legacy_uid_unresolved(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or private.stream_media_uid_reserved(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or private.stream_uid_blocks_new_media_reference(
      intro_video.stream_provider_account_registry_id, intro_video.cloudflare_uid
    )
    or not exists (
      select 1
      from public.stream_media_source_bindings binding
      join public.stream_media_assets asset
        on asset.id = binding.asset_id
       and asset.registry_id = binding.registry_id
       and asset.raw_provider_uid = binding.raw_provider_uid
      join public.stream_media_parent_fences fence
        on fence.source_kind = 'program'
       and fence.source_identity = target_program_id::text
       and fence.owner_id = program_owner_id
       and fence.fence_state = 'open'
       and fence.active_operation_id is null
      where binding.source_kind = 'program_intro'
        and binding.source_identity = target_program_id::text
        and binding.parent_kind = 'program'
        and binding.parent_identity = target_program_id::text
        and binding.owner_id = program_owner_id
        and binding.registry_id = intro_video.stream_provider_account_registry_id
        and binding.raw_provider_uid = intro_video.cloudflare_uid
        and binding.binding_state in ('ready_for_publication', 'active', 'retained')
        and asset.lifecycle_state = 'ready_for_publication'
        and asset.signed_urls_verified and asset.ready_to_stream_verified
        and exists (
          select 1 from public.stream_media_source_binding_events event
          where event.binding_id = binding.id and event.event_kind = 'attached'
            and event.source_revision = binding.source_revision
            and event.evidence_digest = binding.evidence_digest
        )
    ) then
    raise exception 'The Program intro is not ready for publication' using errcode = '23514';
  end if;
  end if;

  if program_row.platform_owned then
    if actor_role <> 'admin' then
      raise exception 'A platform Program requires an administrator' using errcode = '42501';
    end if;
    connected_account := null;
  else
    select account.stripe_account_id into connected_account
    from public.payout_accounts account
    where account.coach_id = program_owner_id
      and account.charges_enabled
      and account.stripe_account_id ~ '^acct_[A-Za-z0-9]+$';
    if connected_account is null then
      raise exception 'Coach payouts must be connected and charges enabled before paid publication'
        using errcode = '23514';
    end if;
  end if;

  if offer_row.offer_kind = 'free' then
    if exists (select 1 from public.program_orders order_row
      where order_row.program_id = target_program_id) then
      raise exception 'A Program with existing orders cannot begin free-to-paid conversion'
        using errcode = '23514';
    end if;
    free_snapshot_id := public.snapshot_program_free_content(target_program_id);
    select * into state_row from public.program_commerce_state state
    where state.program_id = target_program_id;
    pointer_content_id := state_row.current_content_version_id;
    pointer_offer_id := state_row.current_offer_version_id;
  elsif offer_row.offer_kind = 'paid' then
    pointer_content_id := state_row.current_content_version_id;
    pointer_offer_id := state_row.current_offer_version_id;
  else
    raise exception 'Current Program offer cannot be published' using errcode = '23514';
  end if;

  select coalesce(max(version.revision_number), 0) + 1 into revision_number
  from public.program_content_versions version where version.program_id = target_program_id;
  insert into public.program_content_versions(
    program_id, revision_number, revision_kind, lesson_count, created_by
  ) values (
    target_program_id, revision_number, 'paid', lesson_count, target_actor_id
  ) returning id into new_content_version_id;

  insert into public.program_content_version_lessons(
    program_id, content_version_id, lesson_ordinal, timeline_day_number,
    title, instructions, pillar, video_id, video_creator_id, cloudflare_uid,
    cloudflare_signed_urls_verified
  )
  select target_program_id, new_content_version_id, draft_lesson.lesson_ordinal,
    draft_lesson.timeline_day_number, draft_lesson.title, draft_lesson.instructions,
    draft_lesson.pillar, draft_lesson.video_id,
    case when draft_lesson.video_id is null then null else video.coach_id end,
    case when draft_lesson.video_id is null then null else video.cloudflare_uid end,
    draft_lesson.video_id is not null
  from private.program_authoring_draft_lessons draft_lesson
  left join public.videos video on video.id = draft_lesson.video_id
  where draft_lesson.program_id = target_program_id
    and draft_lesson.draft_id = draft_row.draft_id
  order by draft_lesson.lesson_ordinal;

  update public.videos video
  set visibility = 'program_only'
  where video.id in (
    select draft_lesson.video_id
    from private.program_authoring_draft_lessons draft_lesson
    where draft_lesson.program_id = target_program_id
      and draft_lesson.draft_id = draft_row.draft_id
      and draft_lesson.video_id is not null
  ) and video.visibility = 'private';

  if exists (
    select 1
    from public.program_content_version_lessons lesson
    join public.videos video on video.id = lesson.video_id
    where lesson.program_id = target_program_id
      and lesson.content_version_id = new_content_version_id
      and lesson.video_id is not null
      and not private.stream_app_paid_lesson_is_exclusive(
        lesson.id, lesson.video_id, video.stream_provider_account_registry_id, lesson.cloudflare_uid
      )
  ) then
    raise exception 'A Program lesson video is shared or no longer exclusive' using errcode = '23514';
  end if;

  select coalesce(max(offer.offer_number), 0) + 1 into offer_number
  from public.program_offer_versions offer where offer.program_id = target_program_id;
  insert into public.program_offer_versions(
    program_id, offer_number, content_version_id, offer_kind, list_price_cents, currency,
    max_installments, platform_owned, seller_profile_id, connected_account_id, created_by
  ) values (
    target_program_id, offer_number, new_content_version_id, 'paid', target_list_price_cents, 'usd',
    target_max_installments, program_row.platform_owned, program_owner_id,
    connected_account, target_actor_id
  ) returning id into offer_version_id;

  update public.program_commerce_state state
  set current_content_version_id = new_content_version_id,
      current_offer_version_id = offer_version_id,
      updated_at = now()
  where state.program_id = target_program_id
    and state.current_content_version_id = pointer_content_id
    and state.current_offer_version_id = pointer_offer_id;
  if not found then
    raise exception 'Program current version changed during publication' using errcode = '40001';
  end if;
  if free_snapshot_id is not null and not public.release_program_versioning_fence(
    target_program_id, free_snapshot_id, new_content_version_id, offer_version_id
  ) then
    raise exception 'Program versioning fence did not match the new paid version' using errcode = '40001';
  end if;
  update public.programs program set published = true
  where program.id = target_program_id and not program.published;

  result := jsonb_build_object(
    'status', 'published',
    'program_id', target_program_id,
    'content_version_id', new_content_version_id,
    'offer_version_id', offer_version_id,
    'free_snapshot_id', free_snapshot_id,
    'revision_number', revision_number,
    'offer_number', offer_number,
    'list_price_cents', target_list_price_cents,
    'currency', 'usd',
    'max_installments', target_max_installments,
    'published', true,
    'replayed', false
  );
  insert into private.program_authoring_receipts(
    request_id, program_id, actor_id, operation_kind, request_digest, result
  ) values (
    target_request_id, target_program_id, target_actor_id, 'publish_content', request_digest,
    result - 'replayed'
  );
  delete from private.program_authoring_drafts draft
  where draft.program_id = target_program_id and draft.draft_id = draft_row.draft_id;
  return result;
end;
$$;
revoke all on function public.publish_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, uuid, integer, smallint)
  from public, anon, authenticated;
grant execute on function public.publish_program_authoring_draft(uuid, uuid, uuid, bigint, uuid, uuid, uuid, integer, smallint)
  to service_role;
