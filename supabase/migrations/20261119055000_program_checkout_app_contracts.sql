-- Narrow app contracts for the Gate 4 Program Checkout service store.
-- The existing Gate 4 tables remain inaccessible to app roles; all reads and
-- audit writes pass through the narrowly scoped RPCs below.

create table public.program_billing_checkout_app_audits (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.program_billing_orders(order_id) on delete restrict,
  operation_kind text not null check (operation_kind in ('customer_create','checkout_create')),
  checkout_attempt_number smallint not null check (checkout_attempt_number between 0 and 12),
  event_kind text not null check (event_kind in ('unknown','conflict','observed')),
  reason_code text not null check (reason_code in (
    'provider_request_unknown',
    'checkout_session_observed',
    'program_customer_inventory_mismatch',
    'created_customer_is_not_isolated',
    'checkout_session_inventory_ambiguous',
    'checkout_attempt_inventory_mismatch',
    'checkout_session_identity_mismatch',
    'checkout_payment_intent_identity_mismatch',
    'checkout_payment_method_identity_mismatch',
    'checkout_paid_without_succeeded_payment_intent',
    'succeeded_payment_intent_without_paid_checkout'
  )),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  provider_object_id text,
  provider_status text,
  created_at timestamptz not null default now(),
  check ((operation_kind = 'customer_create' and checkout_attempt_number = 0)
      or (operation_kind = 'checkout_create' and checkout_attempt_number between 1 and 12)),
  check ((event_kind = 'observed' and operation_kind = 'checkout_create'
      and reason_code = 'checkout_session_observed' and provider_object_id ~ '^cs_[A-Za-z0-9_]+$'
      and provider_status in ('open','complete','expired','unknown'))
    or (event_kind <> 'observed' and provider_object_id is null and provider_status is null))
);
alter table public.program_billing_checkout_app_audits enable row level security;
revoke all on public.program_billing_checkout_app_audits from public, anon, authenticated, service_role;

create function private.reject_program_billing_checkout_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Program Checkout audit rows are immutable' using errcode = '55000';
end;
$$;
revoke all on function private.reject_program_billing_checkout_audit_mutation() from public, anon, authenticated, service_role;
create trigger program_billing_checkout_app_audits_immutable
before update or delete on public.program_billing_checkout_app_audits
for each row execute function private.reject_program_billing_checkout_audit_mutation();

create function public.get_program_checkout_snapshot(
  p_order_id uuid,p_expected_buyer_id uuid,p_expected_billing_revision bigint
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.program_orders%rowtype;
  v_gate public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_reservation public.program_promotion_reservations%rowtype;
  v_cleared smallint := 0;
  v_terms jsonb;
  v_attempts jsonb;
  v_customer_setup jsonb;
  v_retry_deadline timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Checkout snapshots are server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_buyer_id is null or p_expected_billing_revision is null then
    return jsonb_build_object('status','invalid_request');
  end if;
  select orders.* into v_order from public.program_orders orders
  where orders.id = p_order_id and orders.buyer_id = p_expected_buyer_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,p_expected_buyer_id) then
    return jsonb_build_object('status','buyer_or_program_ineligible');
  end if;
  if not private.stream_media_account_ingress_allowed(p_expected_buyer_id)
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = p_expected_buyer_id)
     or private.stream_account_is_tombstoned(p_expected_buyer_id) then
    return jsonb_build_object('status','account_fenced');
  end if;
  select state.* into v_gate from public.program_order_state state where state.order_id = p_order_id;
  if not found then return jsonb_build_object('status','order_state_missing'); end if;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id;
  if not found then return jsonb_build_object('status','billing_state_missing'); end if;
  if v_billing.revision <> p_expected_billing_revision then
    return jsonb_build_object('status','stale_revision');
  end if;
  if exists (
    select 1 from public.program_billing_checkout_attempts attempt
    left join public.program_billing_retry_requests request
      on request.order_id = attempt.order_id and request.request_id = attempt.explicit_retry_request_id
    where attempt.order_id = p_order_id and attempt.attempt_number > 1
      and (attempt.explicit_retry_request_id is null or attempt.retry_proof_digest is null
        or request.request_id is null or request.requested_by is distinct from v_order.buyer_id
        or request.prior_attempt_number is distinct from attempt.attempt_number - 1
        or request.request_state is distinct from 'applied'
        or request.proof_digest is distinct from attempt.retry_proof_digest)
  ) then
    return jsonb_build_object('status','retry_provenance_missing');
  end if;
  select reservation.* into v_reservation from public.program_promotion_reservations reservation
  where reservation.order_id = p_order_id;
  select coalesce(max(settled.installment_number),0)::smallint into v_cleared
  from generate_series(1,v_order.installment_count) as settled(installment_number)
  where not exists (
    select 1 from generate_series(1,settled.installment_number) as required(n)
    left join public.program_order_installments installment
      on installment.order_id = p_order_id and installment.installment_number = required.n
    where installment.order_id is null
       or installment.net_settled_cents <> v_order.installment_amounts_cents[required.n]
  );
  select invoice.retry_deadline into v_retry_deadline
  from public.program_billing_installment_invoices invoice
  where invoice.order_id = p_order_id and invoice.installment_number = v_billing.next_installment_number;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attempt_number',attempt.attempt_number,
    'attempt_id',attempt.attempt_id,
    'checkout_session_id',attempt.checkout_session_id,
    'payment_intent_id',attempt.payment_intent_id,
    'explicit_retry_request_id',attempt.explicit_retry_request_id,
    'retry_proof_digest',attempt.retry_proof_digest
  ) order by attempt.attempt_number),'[]'::jsonb) into v_attempts
  from public.program_billing_checkout_attempts attempt where attempt.order_id = p_order_id;
  select jsonb_build_object(
    'idempotency_key',operation.idempotency_key,
    'create_requested_at',operation.created_at,
    'create_outcome',case when operation.operation_state = 'unknown' then 'unknown'
      when operation.operation_state = 'succeeded' then 'created' else 'not_started' end
  ) into v_customer_setup
  from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'customer_create'
    and operation.checkout_attempt_number = 0 and operation.installment_number = 0 and operation.payment_attempt_number = 0;
  v_terms := jsonb_build_object(
    'version',v_billing.terms_version,
    'digest',v_billing.terms_digest,
    'accepted_at',v_billing.accepted_at,
    'total_cents',v_billing.accepted_total_cents,
    'installment_count',v_billing.accepted_installment_count,
    'disclosed_charge_dates',to_jsonb(v_billing.disclosed_charge_dates),
    'saved_card_for_off_session',v_billing.off_session_consent,
    'retry_window_days',v_billing.retry_window_days,
    'cancellation_stops_future_charges',v_billing.cancellation_stops_future_charges
  );
  return jsonb_build_object(
    'status','ready',
    'order_id',v_order.id,
    'buyer_id',v_order.buyer_id,
    'program_id',v_order.program_id,
    'currency',v_order.currency,
    'effective_total_cents',v_order.effective_total_cents,
    'installment_amounts_cents',to_jsonb(v_order.installment_amounts_cents),
    'installment_count',v_order.installment_count,
    'cleared_installments',v_cleared,
    'promotion_reservation_state',case when v_order.promotion_id is null then 'none'
      when v_reservation.order_id is null then 'released' else v_reservation.state end,
    'stripe_customer_id',v_billing.stripe_customer_id,
    'provider_scope',case when v_billing.provider_platform_account_id is null then null
      else jsonb_build_object('platform_account_id',v_billing.provider_platform_account_id,'livemode',v_billing.provider_livemode) end,
    'saved_payment_method_id',v_billing.saved_payment_method_id,
    'platform_owned',v_order.platform_owned,
    'connected_account_id',v_order.connected_account_id,
    'application_fee_basis_points',v_order.application_fee_basis_points,
    'consent',v_terms,
    'first_settled_at',v_billing.first_settled_at,
    'next_anchor_date',v_billing.next_anchor_date,
    'retry_deadline',v_retry_deadline,
    'canceled',(v_billing.cancellation_request_id is not null or v_billing.billing_state = 'canceled'
      or v_gate.billing_state = 'canceled'),
    'deletion_pending',(v_billing.billing_state = 'deletion_pending' or v_billing.account_tombstone_id is not null
      or v_gate.billing_state = 'closed'),
    'financial_conflict',v_billing.financial_conflict,
    'current_attempt_number',v_billing.current_checkout_attempt,
    'billing_revision',v_billing.revision,
    'customer_setup',v_customer_setup,
    'attempts',v_attempts
  );
end;
$$;
revoke all on function public.get_program_checkout_snapshot(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.get_program_checkout_snapshot(uuid,uuid,bigint) to service_role;

create function public.record_program_checkout_app_audit(
  p_order_id uuid,p_operation_kind text,p_checkout_attempt_number smallint,
  p_event_kind text,p_reason_code text,p_evidence_digest text,
  p_provider_object_id text default null,p_provider_status text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Checkout audit records are server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_checkout_attempt_number is null or p_event_kind is null or p_reason_code is null
     or p_operation_kind not in ('customer_create','checkout_create')
     or p_event_kind not in ('unknown','conflict','observed')
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or (p_operation_kind = 'customer_create' and p_checkout_attempt_number <> 0)
     or (p_operation_kind = 'checkout_create' and p_checkout_attempt_number not between 1 and 12)
     or (p_event_kind = 'unknown' and p_reason_code <> 'provider_request_unknown')
     or (p_event_kind = 'observed' and (p_operation_kind <> 'checkout_create'
       or p_reason_code <> 'checkout_session_observed' or p_provider_object_id is null
       or p_provider_object_id !~ '^cs_[A-Za-z0-9_]+$'
       or p_provider_status is null or p_provider_status not in ('open','complete','expired','unknown')))
     or (p_event_kind <> 'observed' and (p_provider_object_id is not null or p_provider_status is not null))
     or (p_event_kind = 'conflict' and p_reason_code not in (
       'program_customer_inventory_mismatch','created_customer_is_not_isolated',
       'checkout_session_inventory_ambiguous','checkout_attempt_inventory_mismatch',
       'checkout_session_identity_mismatch','checkout_payment_intent_identity_mismatch',
       'checkout_payment_method_identity_mismatch','checkout_paid_without_succeeded_payment_intent',
       'succeeded_payment_intent_without_paid_checkout')) then return false; end if;
  if not exists (
    select 1 from public.program_billing_operations operation
    where operation.order_id = p_order_id and operation.operation_kind = p_operation_kind
      and operation.checkout_attempt_number = p_checkout_attempt_number
      and operation.installment_number = 0 and operation.payment_attempt_number = 0
      and (p_event_kind <> 'unknown' or operation.operation_state = 'unknown')
  ) then return false; end if;
  insert into public.program_billing_checkout_app_audits (
    order_id,operation_kind,checkout_attempt_number,event_kind,reason_code,evidence_digest,provider_object_id,provider_status
  ) values (p_order_id,p_operation_kind,p_checkout_attempt_number,p_event_kind,p_reason_code,p_evidence_digest,
    p_provider_object_id,p_provider_status);
  return true;
end;
$$;
revoke all on function public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.record_program_checkout_app_audit(uuid,text,smallint,text,text,text,text,text) to service_role;
