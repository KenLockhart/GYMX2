-- A definitive provider mismatch must fence the parent request so it cannot be
-- retried or published after one of its immutable provider bindings failed.
create function public.service_fence_feature_pricing_sync_failure(
  p_request_id uuid,
  p_requested_by uuid,
  p_feature_key text,
  p_request_digest text,
  p_expected_revision bigint,
  p_expected_state_revision bigint
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.feature_pricing_sync_requests%rowtype;
  current_revision bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service access required' using errcode = '42501';
  end if;

  if p_request_id is null
    or p_requested_by is null
    or p_feature_key is distinct from 'form_coach'
    or p_request_digest is null
    or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_expected_revision is null
    or p_expected_revision < 1
    or p_expected_state_revision is null
    or p_expected_state_revision < 0 then
    raise exception 'Invalid pricing-sync failure fence inputs' using errcode = '22023';
  end if;

  -- Match admin_publish_feature_pricing_sync lock order: feature advisory lock,
  -- request row, then current revision row.
  perform pg_advisory_xact_lock(hashtextextended('feature-pricing:form_coach', 0));

  select *
    into request_row
    from public.feature_pricing_sync_requests r
   where r.request_id = p_request_id
   for update;

  if not found then
    return 'missing';
  end if;

  if request_row.feature_key is distinct from p_feature_key
    or request_row.requested_by is distinct from p_requested_by
    or request_row.request_digest is distinct from p_request_digest
    or request_row.expected_revision is distinct from p_expected_revision then
    return 'identity_mismatch';
  end if;

  if request_row.state = 'cas_applied' or request_row.published_revision is not null then
    return 'already_published';
  end if;

  if request_row.state = 'failed' then
    return 'already_failed';
  end if;

  if request_row.state not in ('reserved', 'unknown', 'verified') then
    return 'request_unavailable';
  end if;

  select c.revision
    into current_revision
    from public.feature_pricing_current c
   where c.feature_key = p_feature_key
   for update;

  if not found or current_revision is distinct from p_expected_revision then
    return 'cas_stale';
  end if;

  if request_row.state_revision is distinct from p_expected_state_revision then
    return 'cas_stale';
  end if;

  update public.feature_pricing_sync_requests r
     set state = 'failed',
         state_revision = state_revision + 1,
         updated_at = now()
   where r.request_id = p_request_id
     and r.state_revision = p_expected_state_revision
     and r.state in ('reserved', 'unknown', 'verified')
     and r.published_revision is null;

  if not found then
    return 'cas_stale';
  end if;

  return 'failed';
end;
$$;

revoke all on function public.service_fence_feature_pricing_sync_failure(uuid, uuid, text, text, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.service_fence_feature_pricing_sync_failure(uuid, uuid, text, text, bigint, bigint)
  to service_role;

comment on function public.service_fence_feature_pricing_sync_failure(uuid, uuid, text, text, bigint, bigint)
  is 'CAS-fences an unpublished Form Coach pricing-sync request after definitive provider mismatch without changing its immutable child bindings.';
