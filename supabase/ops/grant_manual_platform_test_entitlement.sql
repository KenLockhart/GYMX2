-- Generic prepared service-only manual test entitlement. Do not run without a reviewed target,
-- verified exact email/role, and explicit main-agent authorization.
-- Required psql variables: target_member_id, expected_email, entitlement_tier, review_ack.
\if :{?target_member_id}
\else
  \echo 'Refusing: target_member_id is required.'
  \quit 3
\endif
\if :{?expected_email}
\else
  \echo 'Refusing: expected_email is required.'
  \quit 3
\endif
\if :{?entitlement_tier}
\else
  \echo 'Refusing: entitlement_tier is required.'
  \quit 3
\endif
\if :{?review_ack}
\else
  \echo 'Refusing: main review acknowledgement is required.'
  \quit 3
\endif

begin;
select set_config('gymx2.test_grant_target_id', :'target_member_id', true) \gset
select set_config('gymx2.test_grant_expected_email', :'expected_email', true) \gset
select set_config('gymx2.test_grant_tier', :'entitlement_tier', true) \gset
select set_config('gymx2.test_grant_review_ack', :'review_ack', true) \gset

do $$
declare
  target_id uuid;
  target_tier text;
  expected_email text;
  actual_email text;
  actual_role text;
  email_confirmed_at timestamptz;
begin
  if current_setting('gymx2.test_grant_review_ack', true)
    is distinct from 'MAIN-APPROVED-TEST-GRANT' then
    raise exception 'Refusing an unreviewed test grant';
  end if;
  target_id := current_setting('gymx2.test_grant_target_id', true)::uuid;
  target_tier := current_setting('gymx2.test_grant_tier', true);
  expected_email := current_setting('gymx2.test_grant_expected_email', true);
  if target_tier not in ('regular', 'premium') then
    raise exception 'Refusing an invalid entitlement tier';
  end if;
  select p.role, u.email, u.email_confirmed_at
  into actual_role, actual_email, email_confirmed_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = target_id
  for update of p, u;
  if not found
    or actual_role is distinct from 'member'
    or lower(btrim(actual_email)) is distinct from lower(btrim(expected_email))
    or email_confirmed_at is null then
    raise exception 'Refusing test grant: target/member role/confirmed email guard failed';
  end if;
  if exists (
    select 1
    from public.platform_test_entitlements existing
    where existing.member_id = target_id
      and existing.revoked_at is null
  ) then
    raise exception 'Refusing test grant: an active manual entitlement already exists';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  target_id uuid;
  target_tier text;
begin
  target_id := current_setting('gymx2.test_grant_target_id', true)::uuid;
  target_tier := current_setting('gymx2.test_grant_tier', true);
  -- The privileged preflight above checked and locked profiles/auth.users. The service role does
  -- not need read access to either table to perform this exact insert.
  insert into public.platform_test_entitlements (
    member_id, tier, source, grant_reason, granted_by
  ) values (
    target_id,
    target_tier,
    'manual_test',
    'Explicitly user-authorized test access; provisioned by Codex service actor, not a human administrator; no Stripe payment or subscription.',
    '00000000-0000-0000-0000-000000000000'
  );
end;
$$;

-- Print only the target UUID and non-secret entitlement metadata for the review record.
select member_id, tier, source, granted_at
from public.platform_test_entitlements
where member_id = current_setting('gymx2.test_grant_target_id', true)::uuid
  and revoked_at is null;

commit;
