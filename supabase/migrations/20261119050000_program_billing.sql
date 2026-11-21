-- Program commerce Gate 4. Requires frozen Gate 3 / 20261119031000.
do $$
begin
  if to_regclass('public.stream_auth_cleanup_components') is null
     or to_regprocedure('private.stream_media_account_ingress_allowed(uuid)') is null
     or to_regprocedure('public.record_stream_auth_cleanup_component_proof(uuid,bigint,text,bigint,bigint,text,text,text,uuid)') is null then
    raise exception 'Program billing requires the frozen Stream media lifecycle Gate 3 contract' using errcode = '55000';
  end if;
end;
$$;

insert into public.stream_auth_cleanup_components (component_key, component_version, resource_set_revision, required_for_auth)
values ('program_billing', 1, 1, true)
on conflict (component_key) do update
set component_version = 1, resource_set_revision = 1, required_for_auth = true, updated_at = now();

create table public.program_billing_orders (
  order_id uuid primary key references public.program_orders (id) on delete restrict,
  revision bigint not null default 0 check (revision >= 0),
  billing_state text not null default 'terms_saved' check (billing_state in
    ('terms_saved','checkout_ready','active','cancel_requested','canceled','paid','deletion_pending','financial_conflict','manual_review')),
  stripe_customer_id text unique check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  provider_platform_account_id text check (provider_platform_account_id is null or provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_livemode boolean,
  saved_payment_method_id text check (saved_payment_method_id is null or saved_payment_method_id ~ '^pm_[A-Za-z0-9_]+$'),
  terms_version smallint not null check (terms_version = 1),
  terms_digest text not null check (terms_digest ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null,
  accepted_total_cents integer not null check (accepted_total_cents > 0),
  accepted_installment_count smallint not null check (accepted_installment_count between 1 and 12),
  disclosed_charge_dates date[] not null default '{}',
  off_session_consent boolean not null,
  retry_window_days smallint,
  cancellation_stops_future_charges boolean not null check (cancellation_stops_future_charges),
  first_settled_at timestamptz,
  anchor_day smallint check (anchor_day is null or anchor_day between 1 and 31),
  anchor_is_end_of_month boolean,
  next_installment_number smallint check (next_installment_number is null or next_installment_number between 2 and 12),
  next_anchor_date date,
  current_checkout_attempt smallint not null default 0 check (current_checkout_attempt between 0 and 12),
  cancellation_request_id uuid,
  cancellation_reason text check (cancellation_reason is null or cancellation_reason in ('buyer','account_deletion')),
  account_tombstone_id uuid,
  financial_conflict boolean not null default false,
  updated_at timestamptz not null default now(),
  check (accepted_installment_count = 1 or
    (off_session_consent and retry_window_days = 7 and cardinality(disclosed_charge_dates) = accepted_installment_count - 1)),
  check (accepted_installment_count <> 1 or
    (not off_session_consent and retry_window_days is null and cardinality(disclosed_charge_dates) = 0)),
  check (cardinality(disclosed_charge_dates) = 0 or array_position(disclosed_charge_dates, null) is null),
  check ((first_settled_at is null and anchor_day is null and anchor_is_end_of_month is null
          and next_installment_number is null and next_anchor_date is null)
    or (first_settled_at is not null and accepted_installment_count = 1
          and anchor_day is null and anchor_is_end_of_month is null
          and next_installment_number is null and next_anchor_date is null)
    or (first_settled_at is not null and accepted_installment_count > 1
          and anchor_day between 1 and 31 and anchor_is_end_of_month is not null
          and next_installment_number is not null and next_anchor_date is not null)),
  check ((cancellation_request_id is null) = (cancellation_reason is null)),
  check ((provider_platform_account_id is null and provider_livemode is null)
       or (provider_platform_account_id is not null and provider_livemode is not null))
);

create table public.program_billing_checkout_attempts (
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  attempt_number smallint not null check (attempt_number between 1 and 12),
  attempt_id uuid not null unique,
  create_idempotency_key text not null unique check (char_length(create_idempotency_key) between 16 and 255),
  create_request_digest text not null check (create_request_digest ~ '^[0-9a-f]{64}$'),
  success_url text not null check (char_length(success_url) between 16 and 2048),
  cancel_url text not null check (char_length(cancel_url) between 16 and 2048),
  create_outcome text not null default 'not_started' check (create_outcome in ('not_started','unknown','created')),
  attempt_state text not null default 'prepared' check (attempt_state in ('prepared','open','expired_unpaid','paid','canceled','financial_conflict')),
  checkout_session_id text unique check (checkout_session_id is null or checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  payment_intent_id text unique check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  explicit_retry_request_id uuid,
  retry_proof_digest text check (retry_proof_digest is null or retry_proof_digest ~ '^[0-9a-f]{64}$'),
  provider_status text not null default 'unknown',
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, attempt_number),
  unique (order_id, attempt_id),
  check ((attempt_number = 1 and explicit_retry_request_id is null and retry_proof_digest is null)
    or (attempt_number > 1 and explicit_retry_request_id is not null and retry_proof_digest is not null))
);

create table public.program_billing_retry_requests (
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  request_id uuid not null,
  requested_by uuid not null,
  prior_attempt_number smallint not null check (prior_attempt_number between 1 and 11),
  requested_at timestamptz not null default now(),
  request_state text not null default 'requested' check (request_state in ('requested','applied','manual_review')),
  proof_digest text check (proof_digest is null or proof_digest ~ '^[0-9a-f]{64}$'),
  primary key (order_id, request_id),
  check ((request_state = 'requested' and proof_digest is null) or (request_state <> 'requested' and proof_digest is not null))
);

create table public.program_billing_installment_invoices (
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  installment_number smallint not null check (installment_number between 2 and 12),
  checkout_attempt_number smallint not null check (checkout_attempt_number between 1 and 12),
  due_date date not null,
  -- This timestamp anchors only the 23-hour provider-create idempotency replay window.
  retry_started_at timestamptz not null,
  collection_started_at timestamptz,
  retry_deadline timestamptz,
  invoice_create_idempotency_key text not null unique,
  line_create_idempotency_key text not null unique,
  finalize_idempotency_key text not null unique,
  invoice_create_outcome text not null default 'not_started' check (invoice_create_outcome in ('not_started','unknown','created')),
  line_create_outcome text not null default 'not_started' check (line_create_outcome in ('not_started','unknown','created')),
  finalize_outcome text not null default 'not_started' check (finalize_outcome in ('not_started','unknown','finalized')),
  invoice_id text unique check (invoice_id is null or invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  invoice_item_id text unique check (invoice_item_id is null or invoice_item_id ~ '^ii_[A-Za-z0-9_]+$'),
  payment_intent_id text unique check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
  current_pay_attempt smallint not null default 0 check (current_pay_attempt between 0 and 16),
  current_pay_idempotency_key text,
  current_pay_outcome text not null default 'none' check (current_pay_outcome in ('none','unknown','failed','requires_action','processing','succeeded')),
  provider_status text not null default 'unpaid' check (provider_status in ('unpaid','requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','void','uncollectible','deleted')),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (order_id, installment_number),
  check ((current_pay_attempt = 0 and current_pay_idempotency_key is null and current_pay_outcome = 'none')
    or (current_pay_attempt > 0 and current_pay_idempotency_key is not null)),
  check ((collection_started_at is null and retry_deadline is null)
    or (collection_started_at is not null and retry_deadline = collection_started_at + interval '7 days')),
  check ((current_pay_attempt = 0 and collection_started_at is null)
    or (current_pay_attempt > 0 and collection_started_at is not null))
);

create table public.program_billing_operations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  operation_kind text not null check (operation_kind in
    ('customer_create','checkout_create','invoice_create','invoice_item_create','invoice_finalize','invoice_pay','checkout_expire','invoice_void','invoice_delete')),
  checkout_attempt_number smallint not null default 0 check (checkout_attempt_number between 0 and 12),
  installment_number smallint not null default 0 check (installment_number between 0 and 12),
  payment_attempt_number smallint not null default 0 check (payment_attempt_number between 0 and 16),
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 255),
  request_digest text not null check (request_digest ~ '^[0-9a-f]{64}$'),
  operation_state text not null default 'intent' check (operation_state in ('intent','unknown','succeeded','terminal_failure')),
  provider_object_id text,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, operation_kind, checkout_attempt_number, installment_number, payment_attempt_number),
  check ((operation_kind = 'customer_create' and checkout_attempt_number = 0 and installment_number = 0 and payment_attempt_number = 0)
    or (operation_kind = 'checkout_create' and checkout_attempt_number > 0 and installment_number = 0 and payment_attempt_number = 0)
    or (operation_kind in ('invoice_create','invoice_item_create','invoice_finalize','invoice_pay','invoice_void','invoice_delete')
        and checkout_attempt_number between 1 and 12 and installment_number between 2 and 12)
    or (operation_kind = 'checkout_expire' and checkout_attempt_number > 0 and installment_number = 0 and payment_attempt_number = 0))
);

create table public.program_billing_invoice_delete_proofs (
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  installment_number smallint not null check (installment_number between 2 and 12),
  checkout_attempt_number smallint not null check (checkout_attempt_number between 1 and 12),
  invoice_id text not null unique check (invoice_id ~ '^in_[A-Za-z0-9_]+$'),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  provider_platform_account_id text not null check (provider_platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  provider_livemode boolean not null,
  operation_id uuid not null unique references public.program_billing_operations (id) on delete restrict,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_digest text not null check (snapshot_digest ~ '^[0-9a-f]{64}$'),
  proof_state text not null default 'prepared' check (proof_state in ('prepared','unknown','deleted','missing','present')),
  terminal_evidence jsonb,
  terminal_digest text check (terminal_digest is null or terminal_digest ~ '^[0-9a-f]{64}$'),
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id,installment_number),
  check ((proof_state in ('prepared','unknown') and terminal_evidence is null and terminal_digest is null)
    or (proof_state in ('deleted','missing','present') and terminal_evidence is not null and terminal_digest is not null))
);

create table public.program_billing_provider_observations (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text unique check (provider_event_id is null or provider_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  checkout_attempt_number smallint check (checkout_attempt_number is null or checkout_attempt_number between 1 and 12),
  installment_number smallint check (installment_number is null or installment_number between 1 and 12),
  provider_object_type text not null check (provider_object_type in ('checkout_session','payment_intent','invoice','invoice_item','customer')),
  provider_object_id text not null,
  provider_status text not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  is_current_attempt boolean not null,
  observed_after_account_fence boolean not null default false,
  manual_review_required boolean not null default false,
  created_at timestamptz not null default now(),
  check ((provider_object_type = 'checkout_session' and provider_object_id ~ '^cs_[A-Za-z0-9_]+$')
    or (provider_object_type = 'payment_intent' and provider_object_id ~ '^pi_[A-Za-z0-9_]+$')
    or (provider_object_type = 'invoice' and provider_object_id ~ '^in_[A-Za-z0-9_]+$')
    or (provider_object_type = 'invoice_item' and provider_object_id ~ '^ii_[A-Za-z0-9_]+$')
    or (provider_object_type = 'customer' and provider_object_id ~ '^cus_[A-Za-z0-9_]+$'))
);

create table public.program_billing_financial_conflicts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.program_billing_orders (order_id) on delete restrict,
  provider_event_id text unique check (provider_event_id is null or provider_event_id ~ '^evt_[A-Za-z0-9_]+$'),
  reason_code text not null check (reason_code in
    ('late_payment_after_terminal_retry','provider_identity_mismatch','payment_after_account_fence','refund_after_account_fence',
     'unmatched_refund_review','ambiguous_provider_inventory','unexpected_invoice_or_collection')),
  provider_object_id text not null,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.program_billing_auth_cleanup_proofs (
  id uuid primary key default gen_random_uuid(),
  tombstone_id uuid not null references public.stream_media_account_tombstones (id) on delete restrict,
  request_id uuid not null,
  resource_set_digest text not null check (resource_set_digest ~ '^[0-9a-f]{64}$'),
  proof_digest text not null check (proof_digest ~ '^[0-9a-f]{64}$'),
  proof_state text not null check (proof_state in ('ready','incomplete','unknown','blocked')),
  created_at timestamptz not null default now(),
  unique (tombstone_id, request_id)
);

-- An immutable completion receipt binds a validated billing drain to the exact
-- Gate 1 state and tombstone. Transition receipts authorize one close; no-op
-- receipts prove a state that was already terminal before deletion handoff.
create table private.program_order_closing_receipts (
  order_id uuid not null references public.program_orders (id) on delete restrict,
  source_revision bigint not null check (source_revision >= 0),
  target_revision bigint not null,
  transition_applied boolean not null,
  target_state text not null check (target_state in ('canceled','closed')),
  buyer_id uuid not null,
  cancellation_request_id uuid not null,
  tombstone_id uuid not null references public.stream_media_account_tombstones (id) on delete restrict,
  tombstone_request_id uuid not null,
  tombstone_revision bigint not null check (tombstone_revision > 0),
  tombstone_state text not null check (tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')),
  checkout_session_id text,
  access_started_on date,
  request_billing_revision bigint not null check (request_billing_revision >= 0),
  billing_revision bigint not null check (billing_revision >= 0),
  terminal_billing_revision bigint not null check (terminal_billing_revision >= billing_revision),
  billing_state text not null check (billing_state = 'deletion_pending'),
  inventory_digest text not null check (inventory_digest ~ '^[0-9a-f]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((transition_applied and target_revision = source_revision + 1)
    or (not transition_applied and target_revision = source_revision)),
  primary key (order_id, request_billing_revision)
);
alter table private.program_order_closing_receipts enable row level security;
revoke all on private.program_order_closing_receipts from public, anon, authenticated, service_role;

create function private.reject_program_order_closing_receipt_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Program order closing receipts are immutable' using errcode = '55000';
end;
$$;
revoke all on function private.reject_program_order_closing_receipt_mutation() from public, anon, authenticated, service_role;
create trigger program_order_closing_receipts_immutable
before update or delete on private.program_order_closing_receipts
for each row execute function private.reject_program_order_closing_receipt_mutation();

alter table public.program_billing_orders enable row level security;
alter table public.program_billing_checkout_attempts enable row level security;
alter table public.program_billing_retry_requests enable row level security;
alter table public.program_billing_installment_invoices enable row level security;
alter table public.program_billing_operations enable row level security;
alter table public.program_billing_provider_observations enable row level security;
alter table public.program_billing_financial_conflicts enable row level security;
alter table public.program_billing_auth_cleanup_proofs enable row level security;
alter table public.program_billing_invoice_delete_proofs enable row level security;

revoke all on public.program_billing_orders, public.program_billing_checkout_attempts,
  public.program_billing_retry_requests, public.program_billing_installment_invoices,
  public.program_billing_operations, public.program_billing_provider_observations,
  public.program_billing_financial_conflicts, public.program_billing_auth_cleanup_proofs,
  public.program_billing_invoice_delete_proofs
from public, anon, authenticated, service_role;

create function private.reject_program_billing_audit_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Program billing audit rows are append only' using errcode = '55000';
end;
$$;
revoke all on function private.reject_program_billing_audit_mutation() from public, anon, authenticated, service_role;
create trigger program_billing_observations_append_only before update or delete on public.program_billing_provider_observations
for each row execute function private.reject_program_billing_audit_mutation();
create trigger program_billing_conflicts_append_only before update or delete on public.program_billing_financial_conflicts
for each row execute function private.reject_program_billing_audit_mutation();
create trigger program_billing_cleanup_proofs_append_only before update or delete on public.program_billing_auth_cleanup_proofs
for each row execute function private.reject_program_billing_audit_mutation();

create function private.validate_program_billing_invoice_delete_proof_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Program invoice delete proofs are permanent' using errcode = '55000';
  end if;
  if new.order_id is distinct from old.order_id or new.installment_number is distinct from old.installment_number
     or new.checkout_attempt_number is distinct from old.checkout_attempt_number
     or new.invoice_id is distinct from old.invoice_id or new.customer_id is distinct from old.customer_id
     or new.provider_platform_account_id is distinct from old.provider_platform_account_id
     or new.provider_livemode is distinct from old.provider_livemode or new.operation_id is distinct from old.operation_id
     or new.snapshot is distinct from old.snapshot or new.snapshot_digest is distinct from old.snapshot_digest
     or new.created_at is distinct from old.created_at or new.revision <> old.revision + 1 then
    raise exception 'Program invoice delete proof identity is immutable' using errcode = '55000';
  end if;
  if old.proof_state <> 'prepared' and old.proof_state <> 'unknown' then
    raise exception 'Program invoice delete proof is already terminal' using errcode = '55000';
  end if;
  if (old.proof_state = 'prepared' and new.proof_state <> 'unknown')
     or (old.proof_state = 'unknown' and new.proof_state not in ('deleted','missing','present')) then
    raise exception 'Program invoice delete proof transition is invalid' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_billing_invoice_delete_proof_change() from public, anon, authenticated, service_role;
create trigger program_billing_invoice_delete_proof_guard before update or delete on public.program_billing_invoice_delete_proofs
for each row execute function private.validate_program_billing_invoice_delete_proof_change();

create function private.validate_program_billing_order_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.revision <> old.revision + 1 then
    raise exception 'Program billing revision must advance by one' using errcode = '40001';
  end if;
  if new.order_id is distinct from old.order_id or new.terms_version is distinct from old.terms_version
    or new.terms_digest is distinct from old.terms_digest or new.accepted_at is distinct from old.accepted_at
    or new.accepted_total_cents is distinct from old.accepted_total_cents
    or new.accepted_installment_count is distinct from old.accepted_installment_count
    or new.disclosed_charge_dates is distinct from old.disclosed_charge_dates
    or new.off_session_consent is distinct from old.off_session_consent
    or new.retry_window_days is distinct from old.retry_window_days
    or new.cancellation_stops_future_charges is distinct from old.cancellation_stops_future_charges then
    raise exception 'Accepted Program billing terms are immutable' using errcode = '55000';
  end if;
  if old.stripe_customer_id is not null and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Program billing Customer binding is immutable' using errcode = '55000';
  end if;
  if old.provider_platform_account_id is not null and (new.provider_platform_account_id is distinct from old.provider_platform_account_id
    or new.provider_livemode is distinct from old.provider_livemode) then
    raise exception 'Program Stripe platform scope is immutable' using errcode = '55000';
  end if;
  if old.saved_payment_method_id is not null and new.saved_payment_method_id is distinct from old.saved_payment_method_id then
    raise exception 'Program saved card binding is immutable' using errcode = '55000';
  end if;
  if old.first_settled_at is not null and (new.first_settled_at is distinct from old.first_settled_at
    or new.anchor_day is distinct from old.anchor_day or new.anchor_is_end_of_month is distinct from old.anchor_is_end_of_month) then
    raise exception 'Program first settlement anchor is immutable' using errcode = '55000';
  end if;
  if old.cancellation_request_id is not null and new.cancellation_request_id is distinct from old.cancellation_request_id then
    raise exception 'Program cancellation is permanent' using errcode = '55000';
  end if;
  if old.cancellation_reason is not null and new.cancellation_reason is distinct from old.cancellation_reason
     and not (old.cancellation_reason = 'buyer' and new.cancellation_reason = 'account_deletion'
       and new.account_tombstone_id is not null) then
    raise exception 'Program cancellation reason can only promote to account deletion' using errcode = '55000';
  end if;
  if old.account_tombstone_id is not null and new.account_tombstone_id is distinct from old.account_tombstone_id then
    raise exception 'Program deletion tombstone is immutable' using errcode = '55000';
  end if;
  if new.financial_conflict and not old.financial_conflict and new.billing_state <> 'financial_conflict' then
    raise exception 'Financial conflict must block further billing' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_billing_order_change() from public, anon, authenticated, service_role;
create trigger program_billing_order_guard before update on public.program_billing_orders
for each row execute function private.validate_program_billing_order_change();

create function private.validate_program_billing_operation_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.order_id is distinct from old.order_id
    or new.operation_kind is distinct from old.operation_kind
    or new.checkout_attempt_number is distinct from old.checkout_attempt_number
    or new.installment_number is distinct from old.installment_number
    or new.payment_attempt_number is distinct from old.payment_attempt_number
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_digest is distinct from old.request_digest
    or new.created_at is distinct from old.created_at or new.revision <> old.revision + 1 then
    raise exception 'Program provider operation identity is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_program_billing_operation_change() from public, anon, authenticated, service_role;
create trigger program_billing_operation_guard before update on public.program_billing_operations
for each row execute function private.validate_program_billing_operation_change();
create function private.program_billing_order_is_eligible(p_order_id uuid, p_buyer_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.program_orders orders
    join public.programs program on program.id = orders.program_id and program.published
    where orders.id = p_order_id and orders.buyer_id = p_buyer_id
      and program.platform_owned = orders.platform_owned
      and (program.platform_owned or (
        program.coach_id = orders.seller_profile_id
        and exists (select 1 from public.coach_members link
          where link.coach_id = program.coach_id and link.member_id = p_buyer_id)
      ))
      and private.has_role(p_buyer_id, 'member'::public.user_role)
      and private.has_platform_tier(p_buyer_id, 'regular')
  );
$$;
revoke all on function private.program_billing_order_is_eligible(uuid,uuid) from public, anon, authenticated, service_role;

create function private.program_billing_provider_scope_matches(p_order_id uuid,p_scope jsonb)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.program_billing_orders billing
    where billing.order_id = p_order_id and billing.provider_platform_account_id is not null
      and billing.provider_livemode is not null
      and jsonb_typeof(p_scope) = 'object'
      and p_scope->>'platformAccountId' = billing.provider_platform_account_id
      and p_scope->>'livemode' = billing.provider_livemode::text
  );
$$;
revoke all on function private.program_billing_provider_scope_matches(uuid,jsonb) from public, anon, authenticated, service_role;

create function private.program_billing_customer_credit_balance_is_zero(p_credit_balance jsonb)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
begin
  if jsonb_typeof(p_credit_balance) is distinct from 'object' then return false; end if;
  return not exists (
    select 1 from jsonb_each(p_credit_balance) credit
    where jsonb_typeof(credit.value) is distinct from 'number'
      or credit.value <> '0'::jsonb
  );
end;
$$;
revoke all on function private.program_billing_customer_credit_balance_is_zero(jsonb)
  from public, anon, authenticated, service_role;

create function private.ensure_program_billing_operation(
  p_order_id uuid, p_operation_kind text, p_checkout_attempt smallint, p_installment smallint,
  p_payment_attempt smallint, p_request_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_idempotency_key text;
  v_prior_digest text;
begin
  v_idempotency_key := 'program:' || p_order_id::text || ':' || p_operation_kind
    || ':a' || p_checkout_attempt::text || ':i' || p_installment::text || ':p' || p_payment_attempt::text || ':v1';
  insert into public.program_billing_operations (
    order_id, operation_kind, checkout_attempt_number, installment_number,
    payment_attempt_number, idempotency_key, request_digest
  ) values (
    p_order_id, p_operation_kind, p_checkout_attempt, p_installment,
    p_payment_attempt, v_idempotency_key, p_request_digest
  ) on conflict (order_id, operation_kind, checkout_attempt_number, installment_number, payment_attempt_number) do nothing;
  select operation.request_digest into v_prior_digest from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = p_operation_kind
    and operation.checkout_attempt_number = p_checkout_attempt
    and operation.installment_number = p_installment
    and operation.payment_attempt_number = p_payment_attempt for share;
  if v_prior_digest is distinct from p_request_digest then
    raise exception 'Program provider operation idempotency identity changed' using errcode = '23505';
  end if;
  return v_idempotency_key;
end;
$$;
revoke all on function private.ensure_program_billing_operation(uuid,text,smallint,smallint,smallint,text)
from public, anon, authenticated, service_role;

create function public.prepare_program_billing_terms(
  p_order_id uuid, p_expected_revision bigint, p_terms_digest text,
  p_charge_dates date[], p_off_session_consent boolean, p_retry_window_days smallint
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_prior public.program_billing_orders%rowtype;
  v_dates date[];
  v_anchor_day integer;
  v_end_of_month boolean;
  v_next_month date;
  v_last_day date;
  v_expected_date date;
  v_index integer;
  v_today date := (now() at time zone 'America/New_York')::date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program billing terms are server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_revision is null or p_terms_digest is null
     or p_terms_digest !~ '^[0-9a-f]{64}$' or p_charge_dates is null then
    raise exception 'Program billing terms are invalid' using errcode = '22023';
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then
    return jsonb_build_object('status','buyer_or_program_ineligible');
  end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  if v_order.payment_plan = 'free' then return jsonb_build_object('status','free_grant_no_provider'); end if;
  if p_off_session_consent is distinct from (v_order.installment_count > 1)
     or p_retry_window_days is distinct from (case when v_order.installment_count > 1 then 7 else null end)
     or cardinality(p_charge_dates) <> greatest(0,v_order.installment_count - 1)
     or (cardinality(p_charge_dates) > 0 and array_position(p_charge_dates,null) is not null)
     or coalesce(array_lower(p_charge_dates,1),1) <> 1
     or v_order.effective_total_cents <= 0 then
    return jsonb_build_object('status','terms_do_not_match_order');
  end if;
  v_dates := p_charge_dates;
  if cardinality(v_dates) > 0 then
    if v_dates[1] <= v_today then return jsonb_build_object('status','buyer_confirmation_required'); end if;
    v_anchor_day := extract(day from v_dates[1])::integer;
    v_end_of_month := v_dates[1] =
      (date_trunc('month',v_dates[1]::timestamp) + interval '1 month - 1 day')::date;
    for v_index in 2..cardinality(v_dates) loop
      v_next_month := date_trunc('month',(v_dates[v_index - 1] + interval '1 month'))::date;
      v_last_day := (v_next_month + interval '1 month - 1 day')::date;
      v_expected_date := case when v_end_of_month then v_last_day
        else v_next_month + least(v_anchor_day,extract(day from v_last_day)::integer) - 1 end;
      if v_dates[v_index] <> v_expected_date then return jsonb_build_object('status','charge_dates_not_monthly'); end if;
    end loop;
  end if;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  if not found then return jsonb_build_object('status','order_state_missing'); end if;
  select billing.* into v_prior from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if found then
    if v_prior.revision <> p_expected_revision or v_prior.terms_digest <> p_terms_digest
       or v_prior.disclosed_charge_dates <> v_dates then return jsonb_build_object('status','revision_or_terms_mismatch'); end if;
    return jsonb_build_object('status','already_saved','revision',v_prior.revision);
  end if;
  if p_expected_revision <> 0 then return jsonb_build_object('status','revision_mismatch'); end if;
  insert into public.program_billing_orders (
    order_id,revision,billing_state,terms_version,terms_digest,accepted_at,accepted_total_cents,
    accepted_installment_count,disclosed_charge_dates,off_session_consent,retry_window_days,
    cancellation_stops_future_charges
  ) values (
    p_order_id,1,'terms_saved',1,p_terms_digest,now(),v_order.effective_total_cents,
    v_order.installment_count,v_dates,p_off_session_consent,p_retry_window_days,true
  );
  return jsonb_build_object('status','saved','revision',1);
end;
$$;
revoke all on function public.prepare_program_billing_terms(uuid,bigint,text,date[],boolean,smallint) from public, anon, authenticated;
grant execute on function public.prepare_program_billing_terms(uuid,bigint,text,date[],boolean,smallint) to service_role;

create function public.prepare_program_billing_customer(
  p_order_id uuid,p_expected_revision bigint,p_provider_platform_account_id text,p_provider_livemode boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_digest text;
  v_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Customer creation is server managed' using errcode = '42501';
  end if;
  if p_provider_platform_account_id is null or p_provider_platform_account_id !~ '^acct_[A-Za-z0-9]+$'
     or p_provider_livemode is null then return jsonb_build_object('status','provider_scope_invalid'); end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then return jsonb_build_object('status','buyer_or_program_ineligible'); end if;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision then return jsonb_build_object('status','revision_mismatch'); end if;
  if v_billing.cancellation_request_id is not null or v_billing.financial_conflict then return jsonb_build_object('status','billing_closed'); end if;
  if v_billing.provider_platform_account_id is not null and
     (v_billing.provider_platform_account_id is distinct from p_provider_platform_account_id
       or v_billing.provider_livemode is distinct from p_provider_livemode) then
    return jsonb_build_object('status','provider_scope_mismatch');
  end if;
  if v_billing.provider_platform_account_id is null then
    update public.program_billing_orders billing set provider_platform_account_id = p_provider_platform_account_id,
      provider_livemode = p_provider_livemode,revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id returning * into v_billing;
  end if;
  if v_billing.stripe_customer_id is not null then
    return jsonb_build_object('status','already_bound','customer_id',v_billing.stripe_customer_id,'revision',v_billing.revision,
      'provider_scope',jsonb_build_object('platform_account_id',v_billing.provider_platform_account_id,'livemode',v_billing.provider_livemode));
  end if;
  v_digest := private.stream_media_identity_digest(p_order_id::text || '|customer_create|' || v_billing.terms_digest);
  v_key := private.ensure_program_billing_operation(p_order_id,'customer_create',0::smallint,0::smallint,0::smallint,v_digest);
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.idempotency_key = v_key;
  return jsonb_build_object('status','prepared','customer_id',v_billing.stripe_customer_id,
    'idempotency_key',v_key,'revision',v_billing.revision,
    'create_outcome',case when v_operation.operation_state = 'unknown' then 'unknown'
      when v_operation.operation_state = 'succeeded' then 'created' else 'not_started' end,
    'create_requested_at',v_operation.created_at,
    'retry_unknown_until',v_operation.created_at + interval '23 hours',
    'provider_scope',jsonb_build_object('platform_account_id',v_billing.provider_platform_account_id,'livemode',v_billing.provider_livemode));
end;
$$;
revoke all on function public.prepare_program_billing_customer(uuid,bigint,text,boolean) from public, anon, authenticated;
grant execute on function public.prepare_program_billing_customer(uuid,bigint,text,boolean) to service_role;

create function public.bind_program_billing_customer(
  p_order_id uuid,p_expected_revision bigint,p_customer_id text,p_provider_evidence jsonb,p_evidence_digest text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Customer binding is server managed' using errcode = '42501';
  end if;
  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9_]+$'
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_provider_evidence is null then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return false; end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return false; end if;
  if p_provider_evidence->>'id' is distinct from p_customer_id
     or p_provider_evidence->>'deleted' is distinct from 'false'
     or p_provider_evidence->>'balance' is distinct from '0'
     or p_provider_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'providerScope')
     or p_provider_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_provider_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or not (p_provider_evidence ? 'discountId')
     or p_provider_evidence->>'discountId' is not null
     or p_provider_evidence->>'taxExempt' is distinct from 'none'
     or p_provider_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_provider_evidence->'metadata'->>'program_billing_purpose' is distinct from 'program_order'
     or not private.program_billing_customer_credit_balance_is_zero(p_provider_evidence->'invoiceCreditBalance') then
    return false;
  end if;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'customer_create'
    and operation.operation_state in ('intent','unknown') for update;
  if not found then return false; end if;
  update public.program_billing_orders billing set stripe_customer_id = p_customer_id,
    billing_state = 'checkout_ready', revision = billing.revision + 1, updated_at = now()
  where billing.order_id = p_order_id;
  update public.program_billing_operations operation set operation_state = 'succeeded',
    provider_object_id = p_customer_id, revision = operation.revision + 1, updated_at = now()
  where operation.id = v_operation.id;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  return false;
end;
$$;
revoke all on function public.bind_program_billing_customer(uuid,bigint,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.bind_program_billing_customer(uuid,bigint,text,jsonb,text) to service_role;
create function public.prepare_program_checkout_attempt(
  p_order_id uuid,p_expected_revision bigint,p_success_url text,p_cancel_url text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_attempt_number smallint;
  v_attempt_id uuid;
  v_prior_attempts jsonb := '[]'::jsonb;
  v_digest text;
  v_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Checkout attempts are server managed' using errcode = '42501';
  end if;
  if p_success_url is null or p_cancel_url is null
     or char_length(p_success_url) not between 16 and 2048
     or char_length(p_cancel_url) not between 16 and 2048
     or p_success_url not like 'https://%' or p_cancel_url not like 'https://%'
     or split_part(split_part(p_success_url,'/',3),'?',1) = ''
     or split_part(split_part(p_cancel_url,'/',3),'?',1) = ''
     or split_part(split_part(p_success_url,'/',3),'?',1) <> split_part(split_part(p_cancel_url,'/',3),'?',1)
     or split_part(split_part(p_success_url,'/',3),'?',1) like '%@%'
     or split_part(split_part(p_cancel_url,'/',3),'?',1) like '%@%'
     or p_success_url ~ '[[:cntrl:]#]' or p_cancel_url ~ '[[:cntrl:]#]' then
    return jsonb_build_object('status','invalid_checkout_return_urls');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then return jsonb_build_object('status','buyer_or_program_ineligible'); end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.stripe_customer_id is null
     or v_billing.provider_platform_account_id is null or v_billing.provider_livemode is null
     or v_billing.cancellation_request_id is not null or v_billing.financial_conflict
     or v_billing.first_settled_at is not null or v_order.installment_count not between 1 and 12
     or v_order.effective_total_cents <> v_billing.accepted_total_cents
     or v_order.installment_count <> v_billing.accepted_installment_count then
    return jsonb_build_object('status','checkout_not_ready');
  end if;
  if v_billing.current_checkout_attempt > 0 then
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = v_billing.current_checkout_attempt for update;
    if not found then return jsonb_build_object('status','attempt_missing'); end if;
    if v_attempt.attempt_state = 'expired_unpaid' then return jsonb_build_object('status','explicit_retry_required'); end if;
    if v_attempt.attempt_state not in ('prepared','open') then return jsonb_build_object('status','checkout_not_open'); end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'attemptNumber',attempt.attempt_number,'attemptId',attempt.attempt_id,
      'checkoutSessionId',attempt.checkout_session_id,'paymentIntentId',attempt.payment_intent_id
    ) order by attempt.attempt_number),'[]'::jsonb) into v_prior_attempts
    from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number < v_attempt.attempt_number;
    return jsonb_build_object('status','prepared','attempt_number',v_attempt.attempt_number,
      'attempt_id',v_attempt.attempt_id,'checkout_session_id',v_attempt.checkout_session_id,
      'payment_intent_id',v_attempt.payment_intent_id,'idempotency_key',v_attempt.create_idempotency_key,
      'create_outcome',v_attempt.create_outcome,'create_requested_at',v_attempt.created_at,
      'success_url',v_attempt.success_url,'cancel_url',v_attempt.cancel_url,
      'prior_attempts',v_prior_attempts,'revision',v_billing.revision);
  end if;
  v_attempt_number := 1;
  v_attempt_id := gen_random_uuid();
  v_digest := private.stream_media_identity_digest(p_order_id::text || '|checkout|' || v_billing.terms_digest || '|'
    || v_order.installment_amounts_cents[1]::text || '|' || v_attempt_number::text || '|'
    || p_success_url || '|' || p_cancel_url);
  v_key := private.ensure_program_billing_operation(p_order_id,'checkout_create',v_attempt_number,0::smallint,0::smallint,v_digest);
  insert into public.program_billing_checkout_attempts (
    order_id,attempt_number,attempt_id,create_idempotency_key,create_request_digest,success_url,cancel_url
  ) values (p_order_id,v_attempt_number,v_attempt_id,v_key,v_digest,p_success_url,p_cancel_url) returning * into v_attempt;
  update public.program_billing_orders billing set current_checkout_attempt = v_attempt_number,
    billing_state = 'checkout_ready', revision = billing.revision + 1, updated_at = now()
  where billing.order_id = p_order_id;
  return jsonb_build_object('status','prepared','attempt_number',v_attempt_number,'attempt_id',v_attempt_id,
    'checkout_session_id',null,'payment_intent_id',null,'idempotency_key',v_key,
    'create_outcome','not_started','create_requested_at',v_attempt.created_at,
    'success_url',v_attempt.success_url,'cancel_url',v_attempt.cancel_url,
    'prior_attempts',v_prior_attempts,'revision',v_billing.revision + 1);
end;
$$;
revoke all on function public.prepare_program_checkout_attempt(uuid,bigint,text,text) from public, anon, authenticated;
grant execute on function public.prepare_program_checkout_attempt(uuid,bigint,text,text) to service_role;

create function public.mark_program_checkout_create_unknown(p_order_id uuid,p_attempt_number smallint)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Checkout observations are server managed' using errcode = '42501';
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return false; end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number = p_attempt_number for update;
  if not found then return false; end if;
  update public.program_billing_checkout_attempts attempt set create_outcome = 'unknown',
    revision = attempt.revision + 1, updated_at = now()
  where attempt.order_id = p_order_id and attempt.attempt_number = p_attempt_number
    and attempt.checkout_session_id is null;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'checkout_create'
    and operation.checkout_attempt_number = p_attempt_number and operation.installment_number = 0
    and operation.payment_attempt_number = 0 for update;
  if found and v_operation.operation_state = 'intent' then
    update public.program_billing_operations operation set operation_state = 'unknown',
      revision = operation.revision + 1, updated_at = now() where operation.id = v_operation.id;
  end if;
  return true;
end;
$$;
revoke all on function public.mark_program_checkout_create_unknown(uuid,smallint) from public, anon, authenticated;
grant execute on function public.mark_program_checkout_create_unknown(uuid,smallint) to service_role;

create function public.bind_program_billing_checkout_session(
  p_order_id uuid,p_expected_revision bigint,p_attempt_number smallint,
  p_checkout_session_id text,p_payment_intent_id text,p_provider_evidence jsonb,p_evidence_digest text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_amount integer;
  v_fee integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program Checkout binding is server managed' using errcode = '42501';
  end if;
  if p_checkout_session_id is null or p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
     or (p_payment_intent_id is not null and p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$')
     or p_provider_evidence is null or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return false; end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number = p_attempt_number for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.current_checkout_attempt <> p_attempt_number
     or v_billing.cancellation_request_id is not null or v_billing.financial_conflict then return false; end if;
  v_amount := v_order.installment_amounts_cents[1];
  v_fee := case when v_order.platform_owned then 0 else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
  if p_provider_evidence->>'id' is distinct from p_checkout_session_id
     or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'providerScope')
     or p_provider_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
     or p_provider_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_provider_evidence->>'client_reference_id' is distinct from v_attempt.attempt_id::text
     or p_provider_evidence->>'mode' is distinct from 'payment'
     or p_provider_evidence->>'currency' is distinct from 'usd'
     or (p_provider_evidence->>'amount_total')::integer is distinct from v_amount
     or p_provider_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_provider_evidence->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
     or p_provider_evidence->'metadata'->>'program_checkout_attempt_number' is distinct from p_attempt_number::text
     or p_provider_evidence->'metadata'->>'program_installment_number' is distinct from '1'
     or p_provider_evidence->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
     or p_provider_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_provider_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or not (p_provider_evidence ? 'payment_intent_id')
     or p_provider_evidence->>'payment_intent_id' is distinct from p_payment_intent_id then return false; end if;
  if p_payment_intent_id is null and p_provider_evidence->'payment_intent' is distinct from 'null'::jsonb then
    return false;
  end if;
  if p_provider_evidence->>'status' = 'complete' and p_provider_evidence->>'payment_status' = 'paid'
     and p_payment_intent_id is null then return false; end if;
  if p_payment_intent_id is not null and (
       p_provider_evidence->'payment_intent'->>'customer_id' is distinct from v_billing.stripe_customer_id
       or (p_provider_evidence->'payment_intent'->>'amount')::integer is distinct from v_amount
       or p_provider_evidence->'payment_intent'->>'currency' is distinct from 'usd'
       or (p_provider_evidence->'payment_intent'->>'application_fee_amount')::integer is distinct from nullif(v_fee,0)
       or p_provider_evidence->'payment_intent'->>'transfer_destination_id' is distinct from v_order.connected_account_id
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_checkout_attempt_number' is distinct from p_attempt_number::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_installment_number' is distinct from '1'
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
       or p_provider_evidence->'payment_intent'->>'livemode' is distinct from v_billing.provider_livemode::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
  ) then return false; end if;
  if v_attempt.checkout_session_id is not null and v_attempt.checkout_session_id <> p_checkout_session_id then return false; end if;
  if v_attempt.payment_intent_id is not null and v_attempt.payment_intent_id is distinct from p_payment_intent_id then return false; end if;
  if p_attempt_number = 1 and v_gate_state.checkout_session_id is null then
    if not public.bind_program_checkout_session(p_order_id,v_gate_state.revision,p_checkout_session_id) then return false; end if;
  elsif p_attempt_number = 1 and v_gate_state.checkout_session_id is distinct from p_checkout_session_id then
    return false;
  end if;
  update public.program_billing_checkout_attempts attempt
  set checkout_session_id = p_checkout_session_id, payment_intent_id = p_payment_intent_id,
      create_outcome = 'created',
      attempt_state = case when p_provider_evidence->>'status' = 'open' then 'open'
        when p_provider_evidence->>'status' = 'expired' and p_provider_evidence->>'payment_status' = 'unpaid' then 'expired_unpaid'
        when p_provider_evidence->>'status' = 'complete' and p_provider_evidence->>'payment_status' = 'paid' then 'paid'
        else attempt.attempt_state end,
      provider_status = p_provider_evidence->>'status', revision = attempt.revision + 1, updated_at = now()
  where attempt.order_id = p_order_id and attempt.attempt_number = p_attempt_number;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'checkout_create'
    and operation.checkout_attempt_number = p_attempt_number and operation.installment_number = 0
    and operation.payment_attempt_number = 0 for update;
  if found then
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_checkout_session_id, revision = operation.revision + 1, updated_at = now()
    where operation.id = v_operation.id;
  end if;
  insert into public.program_billing_provider_observations (
    order_id,checkout_attempt_number,provider_object_type,provider_object_id,provider_status,evidence_digest,is_current_attempt
  ) values (p_order_id,p_attempt_number,'checkout_session',p_checkout_session_id,
    p_provider_evidence->>'status',p_evidence_digest,true);
  update public.program_billing_orders billing set revision = billing.revision + 1, updated_at = now()
  where billing.order_id = p_order_id;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or unique_violation then return false;
end;
$$;
revoke all on function public.bind_program_billing_checkout_session(uuid,bigint,smallint,text,text,jsonb,text)
from public, anon, authenticated;
grant execute on function public.bind_program_billing_checkout_session(uuid,bigint,smallint,text,text,jsonb,text) to service_role;

create function public.request_program_checkout_retry(p_order_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid := auth.uid();
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_prior public.program_billing_retry_requests%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    raise exception 'A signed-in buyer must request checkout retry' using errcode = '42501';
  end if;
  if p_order_id is null or p_request_id is null then return jsonb_build_object('status','invalid_request'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then return jsonb_build_object('status','buyer_or_program_ineligible'); end if;
  select state.* into v_gate_state from public.program_order_state state
  join public.program_orders orders on orders.id = state.order_id
  where state.order_id = p_order_id and orders.buyer_id = v_buyer_id for update of state;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.cancellation_request_id is not null or v_billing.financial_conflict
     or v_billing.first_settled_at is not null or v_billing.current_checkout_attempt < 1 then
    return jsonb_build_object('status','retry_not_allowed');
  end if;
  select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number = v_billing.current_checkout_attempt for update;
  if not found then return jsonb_build_object('status','attempt_missing'); end if;
  select request.* into v_prior from public.program_billing_retry_requests request
  where request.order_id = p_order_id and request.request_id = p_request_id;
  if found then
    if v_prior.requested_by <> v_buyer_id or v_prior.prior_attempt_number <> v_billing.current_checkout_attempt then
      return jsonb_build_object('status','request_identity_mismatch');
    end if;
    return jsonb_build_object('status','already_requested','attempt_number',v_prior.prior_attempt_number);
  end if;
  insert into public.program_billing_retry_requests (order_id,request_id,requested_by,prior_attempt_number)
  values (p_order_id,p_request_id,v_buyer_id,v_billing.current_checkout_attempt);
  return jsonb_build_object('status','requested','attempt_number',v_billing.current_checkout_attempt);
end;
$$;
revoke all on function public.request_program_checkout_retry(uuid,uuid) from public, anon, service_role;
grant execute on function public.request_program_checkout_retry(uuid,uuid) to authenticated;

create function public.advance_program_checkout_attempt(
  p_order_id uuid,p_expected_revision bigint,p_request_id uuid,p_terminal_proof jsonb,p_proof_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_retry public.program_billing_retry_requests%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_item jsonb;
  v_count integer;
  v_expected_pi_count integer;
  v_amount integer;
  v_next smallint;
  v_next_id uuid;
  v_key text;
  v_digest text;
  v_index integer;
  v_success_url text;
  v_cancel_url text;
  v_prior_attempts jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program checkout retry proof is server managed' using errcode = '42501';
  end if;
  if p_proof_digest is null or p_proof_digest !~ '^[0-9a-f]{64}$' or p_terminal_proof is null then
    raise exception 'Program checkout retry proof is invalid' using errcode = '22023';
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_billing.financial_conflict or v_billing.first_settled_at is not null
     or (v_order.promotion_id is not null and not exists (
       select 1 from public.program_promotion_reservations reservation
       where reservation.order_id = p_order_id and reservation.state = 'reserved'
     )) then return jsonb_build_object('status','retry_not_allowed'); end if;
  select request.* into v_retry from public.program_billing_retry_requests request
  where request.order_id = p_order_id and request.request_id = p_request_id
    and request.request_state = 'requested' and request.requested_by = v_buyer_id for update;
  if not found or v_retry.prior_attempt_number <> v_billing.current_checkout_attempt then
    return jsonb_build_object('status','retry_request_missing');
  end if;
  if p_terminal_proof->>'completeInventory' is distinct from 'true'
     or p_terminal_proof->>'orderId' is distinct from p_order_id::text
     or p_terminal_proof->>'customerId' is distinct from v_billing.stripe_customer_id
     or (p_terminal_proof->>'priorAttemptNumber')::integer is distinct from v_billing.current_checkout_attempt
     or jsonb_typeof(p_terminal_proof->'attempts') is distinct from 'array'
     or jsonb_typeof(p_terminal_proof->'sessionIds') is distinct from 'array'
     or jsonb_typeof(p_terminal_proof->'paymentIntentIds') is distinct from 'array'
     or jsonb_typeof(p_terminal_proof->'invoiceIds') is distinct from 'array'
     or jsonb_typeof(p_terminal_proof->'subscriptionIds') is distinct from 'array'
     or jsonb_typeof(p_terminal_proof->'scheduleIds') is distinct from 'array'
     or (p_terminal_proof->>'pendingInvoiceItemCount')::integer is distinct from 0
     or jsonb_array_length(p_terminal_proof->'invoiceIds') is distinct from 0
     or jsonb_array_length(p_terminal_proof->'subscriptionIds') is distinct from 0
     or jsonb_array_length(p_terminal_proof->'scheduleIds') is distinct from 0 then
    return jsonb_build_object('status','terminal_proof_incomplete');
  end if;
  v_count := jsonb_array_length(p_terminal_proof->'attempts');
  select count(*)::integer into v_expected_pi_count
  from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number <= v_billing.current_checkout_attempt
    and attempt.payment_intent_id is not null;
  if v_count <> v_billing.current_checkout_attempt
     or jsonb_array_length(p_terminal_proof->'sessionIds') <> v_count
     or jsonb_array_length(p_terminal_proof->'paymentIntentIds') <> v_expected_pi_count then
    return jsonb_build_object('status','terminal_proof_inventory_mismatch');
  end if;
  v_amount := v_order.installment_amounts_cents[1];
  for v_index in 1..v_billing.current_checkout_attempt loop
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = v_index for update;
    if not found or v_attempt.checkout_session_id is null then
      return jsonb_build_object('status','attempt_inventory_incomplete');
    end if;
    select item.value into v_item from jsonb_array_elements(p_terminal_proof->'attempts') as item(value)
    where (item.value->>'attemptNumber')::integer = v_index;
    if not found or v_item->>'attemptId' is distinct from v_attempt.attempt_id::text
       or v_item->>'sessionId' is distinct from v_attempt.checkout_session_id
       or not (v_item ? 'paymentIntentId') or not (v_item ? 'paymentIntentStatus')
       or v_item->>'paymentIntentId' is distinct from v_attempt.payment_intent_id
       or v_item->>'sessionStatus' is distinct from 'expired'
       or v_item->>'sessionPaymentStatus' is distinct from 'unpaid'
       or (v_attempt.payment_intent_id is null and
          (jsonb_typeof(v_item->'paymentIntentId') is distinct from 'null'
            or jsonb_typeof(v_item->'paymentIntentStatus') is distinct from 'null'))
       or (v_attempt.payment_intent_id is not null and
          (v_item->>'paymentIntentStatus' is distinct from 'canceled'
            or jsonb_typeof(v_item->'paymentIntentId') is distinct from 'string'
            or jsonb_typeof(v_item->'paymentIntentStatus') is distinct from 'string'))
       or (v_item->>'amountCents')::integer is distinct from v_amount
       or (v_item->>'amountReceivedCents')::integer is distinct from 0
       or v_item->>'currency' is distinct from 'usd'
       or v_item->>'customerId' is distinct from v_billing.stripe_customer_id
       or not (p_terminal_proof->'sessionIds' @> to_jsonb(array[v_attempt.checkout_session_id]))
       or (v_attempt.payment_intent_id is not null and
           not (p_terminal_proof->'paymentIntentIds' @> to_jsonb(array[v_attempt.payment_intent_id]))) then
      return jsonb_build_object('status','terminal_attempt_proof_mismatch');
    end if;
  end loop;
  v_next := v_billing.current_checkout_attempt + 1;
  if v_next > 12 then return jsonb_build_object('status','retry_limit_reached'); end if;
  select attempt.success_url,attempt.cancel_url into v_success_url,v_cancel_url
  from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number = v_billing.current_checkout_attempt;
  if not found or v_success_url is null or v_cancel_url is null then
    return jsonb_build_object('status','checkout_request_snapshot_missing');
  end if;
  v_next_id := gen_random_uuid();
  v_digest := private.stream_media_identity_digest(p_order_id::text || '|checkout|' || v_billing.terms_digest || '|'
    || v_amount::text || '|' || v_next::text || '|' || v_success_url || '|' || v_cancel_url);
  v_key := private.ensure_program_billing_operation(p_order_id,'checkout_create',v_next,0::smallint,0::smallint,v_digest);
  update public.program_billing_checkout_attempts attempt set attempt_state = 'expired_unpaid',
    provider_status = 'expired_unpaid',
    revision = attempt.revision + 1, updated_at = now()
  where attempt.order_id = p_order_id and attempt.attempt_number = v_billing.current_checkout_attempt;
  insert into public.program_billing_checkout_attempts (
    order_id,attempt_number,attempt_id,create_idempotency_key,create_request_digest,
    explicit_retry_request_id,retry_proof_digest,success_url,cancel_url
  ) values (p_order_id,v_next,v_next_id,v_key,v_digest,p_request_id,p_proof_digest,v_success_url,v_cancel_url) returning * into v_attempt;
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptNumber',attempt.attempt_number,'attemptId',attempt.attempt_id,
    'checkoutSessionId',attempt.checkout_session_id,'paymentIntentId',attempt.payment_intent_id
  ) order by attempt.attempt_number),'[]'::jsonb) into v_prior_attempts
  from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.attempt_number < v_next;
  update public.program_billing_retry_requests request set request_state = 'applied', proof_digest = p_proof_digest
  where request.order_id = p_order_id and request.request_id = p_request_id;
  update public.program_billing_orders billing set current_checkout_attempt = v_next,
    revision = billing.revision + 1, updated_at = now() where billing.order_id = p_order_id;
  return jsonb_build_object('status','prepared','attempt_number',v_next,'attempt_id',v_next_id,
    'idempotency_key',v_key,'create_outcome','not_started','revision',v_billing.revision + 1,
    'create_requested_at',v_attempt.created_at,'prior_attempts',v_prior_attempts,
    'success_url',v_attempt.success_url,'cancel_url',v_attempt.cancel_url,
    'retry_request_id',p_request_id,'retry_proof_digest',p_proof_digest);
exception when invalid_text_representation or numeric_value_out_of_range or unique_violation or invalid_parameter_value then
  return jsonb_build_object('status','terminal_proof_invalid');
end;
$$;
revoke all on function public.advance_program_checkout_attempt(uuid,bigint,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.advance_program_checkout_attempt(uuid,bigint,uuid,jsonb,text) to service_role;
create function public.prepare_program_billing_invoice(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,p_today date
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_previous public.program_order_installments%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_due_date date;
  v_amount integer;
  v_deadline timestamptz;
  v_digest text;
  v_create_key text;
  v_line_key text;
  v_finalize_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program invoice preparation is server managed' using errcode = '42501';
  end if;
  if p_today is null or p_today <> (now() at time zone 'America/New_York')::date then
    return jsonb_build_object('status','invalid_or_stale_date');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then return jsonb_build_object('status','buyer_or_program_ineligible'); end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_billing.provider_platform_account_id is null or v_billing.provider_livemode is null
     or v_billing.financial_conflict or v_billing.first_settled_at is null
     or v_billing.accepted_installment_count < 2 or v_order.installment_count <> v_billing.accepted_installment_count
     or v_billing.saved_payment_method_id is null
     or p_installment_number < 2 or p_installment_number > v_order.installment_count then
    return jsonb_build_object('status','invoice_not_eligible');
  end if;
  v_due_date := v_billing.disclosed_charge_dates[p_installment_number - 1];
  v_amount := v_order.installment_amounts_cents[p_installment_number];
  select installment.* into v_previous from public.program_order_installments installment
  where installment.order_id = p_order_id and installment.installment_number = p_installment_number - 1 for update;
  if not found or v_previous.provider_status <> 'succeeded'
     or v_previous.net_settled_cents <> v_previous.due_cents then
    return jsonb_build_object('status','prior_installment_unsettled');
  end if;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if found then
    if v_invoice.due_date <> v_due_date or v_invoice.checkout_attempt_number <> v_billing.current_checkout_attempt then
      return jsonb_build_object('status','invoice_identity_mismatch');
    end if;
    if v_invoice.collection_started_at is null and p_today > v_invoice.due_date then
      return jsonb_build_object('status','buyer_confirmation_required');
    end if;
    if v_invoice.retry_deadline is not null and now() > v_invoice.retry_deadline then
      return jsonb_build_object('status','retry_expired');
    end if;
    return jsonb_build_object('status','ready','revision',v_billing.revision,
      'installment_number',p_installment_number,'due_date',v_invoice.due_date,'retry_deadline',v_invoice.retry_deadline,
      'retry_started_at',v_invoice.retry_started_at,'collection_started_at',v_invoice.collection_started_at,
      'amount_cents',v_amount,'invoice_id',v_invoice.invoice_id,
      'invoice_item_id',v_invoice.invoice_item_id,'payment_intent_id',v_invoice.payment_intent_id,
      'create_invoice_idempotency_key',v_invoice.invoice_create_idempotency_key,
      'create_line_idempotency_key',v_invoice.line_create_idempotency_key,
      'finalize_idempotency_key',v_invoice.finalize_idempotency_key,
      'invoice_create_outcome',v_invoice.invoice_create_outcome,'line_create_outcome',v_invoice.line_create_outcome,
      'finalize_outcome',v_invoice.finalize_outcome,'current_pay_attempt',v_invoice.current_pay_attempt,
      'current_pay_idempotency_key',v_invoice.current_pay_idempotency_key,'current_pay_outcome',v_invoice.current_pay_outcome);
  end if;
  if p_today < v_due_date then return jsonb_build_object('status','not_due'); end if;
  if p_today > v_due_date then return jsonb_build_object('status','buyer_confirmation_required'); end if;
  v_deadline := null;
  v_digest := private.stream_media_identity_digest(p_order_id::text || '|invoice|' || v_billing.terms_digest || '|'
    || p_installment_number::text || '|' || v_billing.current_checkout_attempt::text || '|' || v_amount::text);
  v_create_key := private.ensure_program_billing_operation(p_order_id,'invoice_create',v_billing.current_checkout_attempt,p_installment_number,0::smallint,v_digest);
  v_line_key := private.ensure_program_billing_operation(p_order_id,'invoice_item_create',v_billing.current_checkout_attempt,p_installment_number,0::smallint,
    private.stream_media_identity_digest(v_digest || '|line'));
  v_finalize_key := private.ensure_program_billing_operation(p_order_id,'invoice_finalize',v_billing.current_checkout_attempt,p_installment_number,0::smallint,
    private.stream_media_identity_digest(v_digest || '|finalize'));
  insert into public.program_billing_installment_invoices (
    order_id,installment_number,checkout_attempt_number,due_date,retry_started_at,collection_started_at,retry_deadline,
    invoice_create_idempotency_key,line_create_idempotency_key,finalize_idempotency_key
  ) values (
    p_order_id,p_installment_number,v_billing.current_checkout_attempt,v_due_date,now(),null,v_deadline,
    v_create_key,v_line_key,v_finalize_key
  ) returning * into v_invoice;
  return jsonb_build_object('status','ready','revision',v_billing.revision,
    'installment_number',p_installment_number,'due_date',v_invoice.due_date,'retry_deadline',v_invoice.retry_deadline,
    'retry_started_at',v_invoice.retry_started_at,'collection_started_at',v_invoice.collection_started_at,
    'amount_cents',v_amount,'invoice_id',null,'invoice_item_id',null,
    'payment_intent_id',null,'create_invoice_idempotency_key',v_create_key,'create_line_idempotency_key',v_line_key,
    'finalize_idempotency_key',v_finalize_key,'invoice_create_outcome','not_started','line_create_outcome','not_started',
    'finalize_outcome','not_started','current_pay_attempt',0,'current_pay_idempotency_key',null,'current_pay_outcome','none');
end;
$$;
revoke all on function public.prepare_program_billing_invoice(uuid,bigint,smallint,date) from public, anon, authenticated;
grant execute on function public.prepare_program_billing_invoice(uuid,bigint,smallint,date) to service_role;

create function public.bind_program_billing_invoice(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,p_invoice_id text,p_evidence jsonb,p_digest text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Program invoice binding is server managed' using errcode = '42501'; end if;
  if p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9_]+$' or p_evidence is null
     or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_invoice.checkout_attempt_number <> v_billing.current_checkout_attempt then return false; end if;
  if p_evidence->>'id' is distinct from p_invoice_id
     or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
     or p_evidence->>'currency' is distinct from 'usd'
     or p_evidence->>'auto_advance' is distinct from 'false'
     or p_evidence->>'collection_method' is distinct from 'charge_automatically'
     or p_evidence->>'billing_reason' is distinct from 'manual'
     or p_evidence->>'status' is distinct from 'draft'
     or p_evidence->>'amount_due' is distinct from '0'
     or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_evidence->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
     or p_evidence->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
     or p_evidence->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
     or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
  if v_invoice.invoice_id is not null and v_invoice.invoice_id <> p_invoice_id then return false; end if;
  update public.program_billing_installment_invoices invoice_state set invoice_id = p_invoice_id,
    invoice_create_outcome = 'created', revision = invoice_state.revision + 1, updated_at = now()
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_create'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if found then update public.program_billing_operations operation set operation_state = 'succeeded',
    provider_object_id = p_invoice_id, revision = operation.revision + 1, updated_at = now()
    where operation.id = v_operation.id; end if;
  insert into public.program_billing_provider_observations (
    order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
    provider_status,evidence_digest,is_current_attempt
  ) values (p_order_id,v_invoice.checkout_attempt_number,p_installment_number,'invoice',p_invoice_id,'draft',p_digest,true);
  return true;
end;
$$;
revoke all on function public.bind_program_billing_invoice(uuid,bigint,smallint,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.bind_program_billing_invoice(uuid,bigint,smallint,text,jsonb,text) to service_role;

create function public.bind_program_billing_invoice_item(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,p_invoice_item_id text,p_evidence jsonb,p_digest text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_order public.program_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Program invoice-item binding is server managed' using errcode = '42501'; end if;
  if p_invoice_item_id is null or p_invoice_item_id !~ '^ii_[A-Za-z0-9_]+$' or p_evidence is null
     or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_invoice.invoice_id is null or v_invoice.checkout_attempt_number <> v_billing.current_checkout_attempt then return false; end if;
  if p_evidence->>'id' is distinct from p_invoice_item_id
     or p_evidence->>'invoice_id' is distinct from v_invoice.invoice_id
     or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
     or p_evidence->>'amount' is distinct from v_order.installment_amounts_cents[p_installment_number]::text
     or p_evidence->>'currency' is distinct from 'usd'
     or (p_evidence->>'quantity' is not null and p_evidence->>'quantity' is distinct from '1')
     or p_evidence->>'discountable' is distinct from 'false'
     or p_evidence->>'proration' is distinct from 'false'
     or p_evidence->>'subscription_id' is not null
     or p_evidence->'discounts' is distinct from '[]'::jsonb
     or p_evidence->'tax_rates' is distinct from '[]'::jsonb
     or p_evidence->'tax_amounts' is distinct from '[]'::jsonb
     or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_evidence->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
     or p_evidence->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
     or p_evidence->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment_line'
     or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
  if v_invoice.invoice_item_id is not null and v_invoice.invoice_item_id <> p_invoice_item_id then return false; end if;
  update public.program_billing_installment_invoices invoice_state set invoice_item_id = p_invoice_item_id,
    line_create_outcome = 'created', revision = invoice_state.revision + 1, updated_at = now()
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_item_create'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if found then
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_invoice_item_id, revision = operation.revision + 1, updated_at = now()
    where operation.id = v_operation.id;
  end if;
  return true;
end;
$$;
revoke all on function public.bind_program_billing_invoice_item(uuid,bigint,smallint,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.bind_program_billing_invoice_item(uuid,bigint,smallint,text,jsonb,text) to service_role;

create function public.bind_program_billing_payment_intent(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,p_payment_intent_id text,p_evidence jsonb,p_digest text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_order public.program_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_fee integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Program PaymentIntent binding is server managed' using errcode = '42501'; end if;
  if p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$' or p_evidence is null
     or p_digest is null or p_digest !~ '^[0-9a-f]{64}$' then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_invoice.invoice_id is null or v_invoice.invoice_item_id is null or v_invoice.finalize_outcome not in ('unknown','finalized')
     or v_invoice.checkout_attempt_number <> v_billing.current_checkout_attempt then return false; end if;
  v_fee := case when v_order.platform_owned then 0 else round(v_order.installment_amounts_cents[p_installment_number] * v_order.application_fee_basis_points / 10000.0)::integer end;
  if p_evidence->>'id' is distinct from p_payment_intent_id
     or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
     or p_evidence->>'amount' is distinct from v_order.installment_amounts_cents[p_installment_number]::text
     or p_evidence->>'amount_received' is null
     or p_evidence->>'amount_received' not in ('0',v_order.installment_amounts_cents[p_installment_number]::text)
     or p_evidence->>'status' is null
     or p_evidence->>'status' not in ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded')
     or p_evidence->>'currency' is distinct from 'usd'
     or p_evidence->>'application_fee_amount' is distinct from nullif(v_fee,0)::text
     or p_evidence->>'transfer_destination_id' is distinct from v_order.connected_account_id
     or p_evidence->>'payment_method_id' is distinct from v_billing.saved_payment_method_id
     or p_evidence->'invoice'->>'id' is distinct from v_invoice.invoice_id
     or p_evidence->'invoice'->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_evidence->'invoice'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice'->'providerScope')
     or p_evidence->'invoice'->>'auto_advance' is distinct from 'false'
     or p_evidence->'invoice'->>'billing_reason' is distinct from 'manual'
     or p_evidence->'invoice'->>'currency' is distinct from 'usd'
     or p_evidence->'invoice'->>'default_payment_method_id' is distinct from v_billing.saved_payment_method_id
     or p_evidence->'invoice'->>'status' not in ('open','paid')
     or (p_evidence->'invoice'->>'starting_balance')::integer is distinct from 0
     or (p_evidence->'invoice'->>'ending_balance' is not null and (p_evidence->'invoice'->>'ending_balance')::integer is distinct from 0)
     or (p_evidence->'invoice'->>'amount_shipping')::integer is distinct from 0
     or (p_evidence->'invoice'->>'total')::integer is distinct from v_order.installment_amounts_cents[p_installment_number]
     or (p_evidence->'invoice'->>'subtotal')::integer is distinct from v_order.installment_amounts_cents[p_installment_number]
     or p_evidence->'invoice'->>'automatic_tax_enabled' is distinct from 'false'
     or p_evidence->'invoice'->'discounts' is distinct from '[]'::jsonb
     or p_evidence->'invoice'->'total_discount_amounts' is distinct from '[]'::jsonb
     or p_evidence->'invoice'->'default_tax_rates' is distinct from '[]'::jsonb
     or p_evidence->'invoice'->'total_taxes' is distinct from '[]'::jsonb
     or p_evidence->'invoice'->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_evidence->'invoice'->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
     or p_evidence->'invoice'->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
     or p_evidence->'invoice'->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
     or p_evidence->'invoice'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_evidence->'invoice'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or jsonb_typeof(p_evidence->'invoice_payments') is distinct from 'array'
     or jsonb_array_length(p_evidence->'invoice_payments') is distinct from 1
     or p_evidence->'invoice_payments'->0->>'invoice_id' is distinct from v_invoice.invoice_id
     or p_evidence->'invoice_payments'->0->>'payment_intent_id' is distinct from p_payment_intent_id
     or p_evidence->'invoice_payments'->0->>'is_default' is distinct from 'true'
     or p_evidence->'invoice_payments'->0->>'type' is distinct from 'payment_intent'
     or p_evidence->'invoice_payments'->0->>'status' is distinct from p_evidence->'invoice'->>'status'
     or p_evidence->'invoice_payments'->0->>'currency' is distinct from 'usd'
     or p_evidence->'invoice_payments'->0->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice_payments'->0->'providerScope')
     or (p_evidence->'invoice_payments'->0->>'amount_requested')::integer is distinct from v_order.installment_amounts_cents[p_installment_number]
     or (p_evidence->'invoice'->>'status' = 'paid' and
       (p_evidence->'invoice_payments'->0->>'amount_paid')::integer is distinct from v_order.installment_amounts_cents[p_installment_number])
     or (p_evidence->'invoice'->>'status' = 'open' and p_evidence->'invoice_payments'->0->>'amount_paid' is not null) then return false; end if;
  if v_invoice.payment_intent_id is not null and v_invoice.payment_intent_id <> p_payment_intent_id then return false; end if;
  update public.program_billing_installment_invoices invoice_state set payment_intent_id = p_payment_intent_id,
    finalize_outcome = 'finalized', revision = invoice_state.revision + 1, updated_at = now()
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_finalize'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if found then
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = v_invoice.invoice_id, revision = operation.revision + 1, updated_at = now()
    where operation.id = v_operation.id;
  end if;
  return true;
end;
$$;
revoke all on function public.bind_program_billing_payment_intent(uuid,bigint,smallint,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.bind_program_billing_payment_intent(uuid,bigint,smallint,text,jsonb,text) to service_role;

-- Resolve only a provider resource already created by a durable unknown operation after
-- buyer cancellation or account deletion wins the race. This routine never creates,
-- finalizes, pays, refunds, settles a Gate 1 installment, or grants access.
create function public.reconcile_program_billing_drain_resource(
  p_order_id uuid,p_expected_revision bigint,p_operation_kind text,
  p_checkout_attempt_number smallint,p_installment_number smallint,p_payment_attempt_number smallint,
  p_provider_object_id text,p_evidence jsonb,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_known_pi record;
  v_item jsonb;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_expected_digest text;
  v_expected_key text;
  v_amount integer;
  v_fee integer;
  v_expected_pi_count integer;
  v_found_pi_count integer;
  v_object_status text;
  v_pi_id text;
  v_pi_status text;
  v_conflict boolean := false;
  v_deleted boolean := false;
  v_operation_state text := 'succeeded';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program cancellation drain reconciliation is server managed' using errcode = '42501';
  end if;
  if p_operation_kind not in ('customer_create','checkout_create','invoice_create','invoice_item_create','invoice_finalize','invoice_pay')
     or p_evidence is null or jsonb_typeof(p_evidence) is distinct from 'object'
     or p_provider_object_id is null or p_provider_object_id !~ '^(cus_[A-Za-z0-9_]+|cs_[A-Za-z0-9_]+|in_[A-Za-z0-9_]+|ii_[A-Za-z0-9_]+|pi_[A-Za-z0-9_]+)$'
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid_drain_proof');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','order_not_found'); end if;
  -- Always take the frozen media account mutex first, then the legacy buyer mutex.
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then
    return jsonb_build_object('status','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision then return jsonb_build_object('status','revision_mismatch'); end if;
  if v_billing.cancellation_request_id is null then return jsonb_build_object('status','cancellation_not_requested'); end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    v_deleted := true;
    select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
    where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
      and tombstone.tombstone_state <> 'completed' for share;
    if not found or not exists (select 1 from public.platform_membership_deletion_locks fence
      where fence.member_id = v_buyer_id) then return jsonb_build_object('status','deletion_fence_mismatch'); end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
      return jsonb_build_object('status','account_fenced');
    end if;
  else
    return jsonb_build_object('status','cancellation_reason_invalid');
  end if;
  if v_billing.provider_platform_account_id is null or v_billing.provider_livemode is null then
    return jsonb_build_object('status','provider_scope_missing_manual_review');
  end if;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = p_operation_kind
    and operation.checkout_attempt_number = p_checkout_attempt_number
    and operation.installment_number = p_installment_number
    and operation.payment_attempt_number = p_payment_attempt_number for update;
  if not found then return jsonb_build_object('status','operation_not_found'); end if;
  if v_operation.operation_state = 'succeeded' and v_operation.provider_object_id = p_provider_object_id then
    return jsonb_build_object('status','already_reconciled');
  end if;
  if v_operation.operation_state <> 'unknown' or v_operation.provider_object_id is not null then
    return jsonb_build_object('status','operation_not_unknown');
  end if;
  v_expected_key := 'program:' || p_order_id::text || ':' || p_operation_kind || ':a'
    || p_checkout_attempt_number::text || ':i' || p_installment_number::text || ':p'
    || p_payment_attempt_number::text || ':v1';
  if v_operation.idempotency_key is distinct from v_expected_key then
    return jsonb_build_object('status','operation_provenance_mismatch');
  end if;

  if p_operation_kind = 'customer_create' then
    v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|customer_create|' || v_billing.terms_digest);
    if p_checkout_attempt_number <> 0 or p_installment_number <> 0 or p_payment_attempt_number <> 0
       or v_operation.request_digest is distinct from v_expected_digest
       or p_evidence->>'id' is distinct from p_provider_object_id or p_provider_object_id !~ '^cus_[A-Za-z0-9_]+$'
       or p_evidence->>'deleted' is distinct from 'false' or p_evidence->>'balance' is distinct from '0'
       or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
       or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'metadata'->>'program_billing_purpose' is distinct from 'program_order'
       or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or not (p_evidence ? 'discountId') or p_evidence->>'discountId' is not null
       or p_evidence->>'taxExempt' is distinct from 'none'
       or not private.program_billing_customer_credit_balance_is_zero(p_evidence->'invoiceCreditBalance') then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    if v_billing.stripe_customer_id is not null and v_billing.stripe_customer_id <> p_provider_object_id then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    update public.program_billing_orders billing set stripe_customer_id = p_provider_object_id,
      revision = billing.revision + 1,updated_at = now() where billing.order_id = p_order_id;
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_provider_object_id,revision = operation.revision + 1,updated_at = now()
    where operation.id = v_operation.id;
    insert into public.program_billing_provider_observations (
      order_id,provider_object_type,provider_object_id,provider_status,evidence_digest,
      is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,'customer',p_provider_object_id,'created',p_evidence_digest,false,true,false);
    return jsonb_build_object('status','resource_reconciled_no_access','resource_type','customer');
  elsif p_operation_kind = 'checkout_create' then
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number for update;
    if not found or p_installment_number <> 0 or p_payment_attempt_number <> 0
       or p_provider_object_id !~ '^cs_[A-Za-z0-9_]+$'
       or v_attempt.checkout_session_id is not null then return jsonb_build_object('status','attempt_identity_mismatch'); end if;
    v_amount := v_order.installment_amounts_cents[1];
    v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|checkout|' || v_billing.terms_digest || '|'
      || v_amount::text || '|' || p_checkout_attempt_number::text || '|' || v_attempt.success_url || '|' || v_attempt.cancel_url);
    if v_operation.request_digest is distinct from v_expected_digest or v_attempt.create_request_digest is distinct from v_expected_digest
       or p_evidence->>'id' is distinct from p_provider_object_id
       or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_evidence->>'client_reference_id' is distinct from v_attempt.attempt_id::text
       or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
       or p_evidence->>'mode' is distinct from 'payment' or p_evidence->>'currency' is distinct from 'usd'
       or (p_evidence->>'amount_total')::integer is distinct from v_amount
       or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
       or p_evidence->'metadata'->>'program_checkout_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_evidence->'metadata'->>'program_installment_number' is distinct from '1'
       or p_evidence->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
       or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or not (p_evidence ? 'payment_intent_id')
       or (case jsonb_typeof(p_evidence->'payment_intent_id')
         when 'null' then jsonb_typeof(p_evidence->'payment_intent') is distinct from 'null'
           or p_evidence->>'payment_intent_inventory_complete' is distinct from 'true'
           or jsonb_typeof(p_evidence->'payment_intents') is distinct from 'array'
         when 'string' then p_evidence->>'payment_intent_id' !~ '^pi_[A-Za-z0-9_]+$'
           or jsonb_typeof(p_evidence->'payment_intent') is distinct from 'object'
           or p_evidence->'payment_intent'->>'id' is distinct from p_evidence->>'payment_intent_id'
           or p_evidence->'payment_intent'->>'customer_id' is distinct from v_billing.stripe_customer_id
           or p_evidence->'payment_intent'->>'livemode' is distinct from v_billing.provider_livemode::text
           or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'payment_intent'->'providerScope')
           or (p_evidence->'payment_intent'->>'amount')::integer is distinct from v_amount
           or p_evidence->'payment_intent'->>'currency' is distinct from 'usd'
           or p_evidence->'payment_intent'->>'application_fee_amount' is distinct from nullif(
             case when v_order.platform_owned then 0 else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end,0)::text
           or p_evidence->'payment_intent'->>'transfer_destination_id' is distinct from v_order.connected_account_id
           or p_evidence->'payment_intent'->'metadata'->>'program_order_id' is distinct from p_order_id::text
           or p_evidence->'payment_intent'->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
           or p_evidence->'payment_intent'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
           or p_evidence->'payment_intent'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
          else true end) then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    v_pi_id := p_evidence->>'payment_intent_id';
    v_pi_status := p_evidence->'payment_intent'->>'status';
    if p_evidence->>'status' is null or p_evidence->>'status' not in ('open','expired','complete')
       or p_evidence->>'payment_status' is null or p_evidence->>'payment_status' not in ('unpaid','paid') then
      return jsonb_build_object('status','provider_state_unresolved_manual_review');
    end if;
    if v_pi_id is null then
      if p_evidence->>'status' not in ('open','expired') or p_evidence->>'payment_status' <> 'unpaid'
         or v_billing.first_settled_at is not null
         or exists (select 1 from public.program_billing_installment_invoices invoice_state
           where invoice_state.order_id = p_order_id) then
        return jsonb_build_object('status','provider_state_unresolved_manual_review');
      end if;
      select count(*)::integer into v_expected_pi_count
      from public.program_billing_checkout_attempts attempt
      where attempt.order_id = p_order_id and attempt.payment_intent_id is not null;
      if jsonb_array_length(p_evidence->'payment_intents') <> v_expected_pi_count
         or exists (select 1 from jsonb_array_elements(p_evidence->'payment_intents') item(value)
           where item.value->>'id' is null or item.value->>'id' not in (
             select attempt.payment_intent_id from public.program_billing_checkout_attempts attempt
             where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
           )) then
        return jsonb_build_object('status','provider_inventory_incomplete_manual_review');
      end if;
      for v_known_pi in
        select attempt.payment_intent_id as pi_id,attempt.attempt_id,attempt.attempt_number
        from public.program_billing_checkout_attempts attempt
        where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
      loop
        select count(*)::integer into v_found_pi_count
        from jsonb_array_elements(p_evidence->'payment_intents') item(value)
        where item.value->>'id' = v_known_pi.pi_id;
        select item.value into v_item from jsonb_array_elements(p_evidence->'payment_intents') item(value)
        where item.value->>'id' = v_known_pi.pi_id;
        v_amount := v_order.installment_amounts_cents[1];
        v_fee := case when v_order.platform_owned then 0
          else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
        if v_found_pi_count <> 1 or not found or v_item->>'customer_id' is distinct from v_billing.stripe_customer_id
           or v_item->>'livemode' is distinct from v_billing.provider_livemode::text
           or not private.program_billing_provider_scope_matches(p_order_id,v_item->'providerScope')
           or v_item->>'status' is distinct from 'canceled'
           or (v_item->>'amount')::integer is distinct from v_amount
           or (v_item->>'amount_received')::integer is distinct from 0
           or v_item->>'currency' is distinct from 'usd'
           or v_item->>'application_fee_amount' is distinct from nullif(v_fee,0)::text
           or v_item->>'transfer_destination_id' is distinct from v_order.connected_account_id
           or v_item->'metadata'->>'program_order_id' is distinct from p_order_id::text
           or v_item->'metadata'->>'program_checkout_attempt_id' is distinct from v_known_pi.attempt_id::text
           or v_item->'metadata'->>'program_checkout_attempt_number' is distinct from v_known_pi.attempt_number::text
           or v_item->'metadata'->>'program_installment_number' is distinct from '1'
           or v_item->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
           or v_item->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
           or v_item->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
          return jsonb_build_object('status','provider_inventory_incomplete_manual_review');
        end if;
      end loop;
    else
      if v_pi_status not in ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled')
         or p_evidence->'payment_intent'->>'amount_received' is null
         or (p_evidence->'payment_intent'->>'amount_received')::integer < 0
         or (p_evidence->'payment_intent'->>'amount_received')::integer > v_amount then
        return jsonb_build_object('status','provider_state_unresolved_manual_review');
      end if;
    end if;
    v_conflict := coalesce(p_evidence->>'payment_status' = 'paid' or v_pi_status = 'succeeded'
      or coalesce((p_evidence->'payment_intent'->>'amount_received')::integer,0) > 0,false);
    if (p_evidence->>'status' = 'expired' and p_evidence->>'payment_status' <> 'unpaid')
       or (p_evidence->>'status' = 'complete' and not v_conflict) then
      return jsonb_build_object('status','provider_state_unresolved_manual_review');
    end if;
    update public.program_billing_checkout_attempts attempt set checkout_session_id = p_provider_object_id,
      payment_intent_id = v_pi_id,create_outcome = 'created',
      attempt_state = case when v_conflict then 'financial_conflict'
        when p_evidence->>'status' = 'open' then 'open' else 'expired_unpaid' end,
      provider_status = case when v_conflict then 'paid' else p_evidence->>'status' end,
      revision = attempt.revision + 1,updated_at = now()
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number;
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_provider_object_id,revision = operation.revision + 1,updated_at = now()
    where operation.id = v_operation.id;
    if p_evidence->>'status' = 'open' then
      perform private.ensure_program_billing_operation(p_order_id,'checkout_expire',p_checkout_attempt_number,0::smallint,0::smallint,
        private.stream_media_identity_digest(p_provider_object_id || '|expire'));
    end if;
    insert into public.program_billing_provider_observations (
      order_id,checkout_attempt_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
      is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,p_checkout_attempt_number,'checkout_session',p_provider_object_id,
      p_evidence->>'status',p_evidence_digest,p_checkout_attempt_number = v_billing.current_checkout_attempt,true,v_conflict);
    if v_pi_id is not null then
      insert into public.program_billing_provider_observations (
        order_id,checkout_attempt_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
        is_current_attempt,observed_after_account_fence,manual_review_required
      ) values (p_order_id,p_checkout_attempt_number,'payment_intent',v_pi_id,v_pi_status,p_evidence_digest,
        p_checkout_attempt_number = v_billing.current_checkout_attempt,true,v_conflict);
    end if;
    if v_conflict then
      insert into public.program_billing_financial_conflicts (order_id,reason_code,provider_object_id,evidence_digest)
      values (p_order_id,case when v_deleted then 'payment_after_account_fence' else 'unexpected_invoice_or_collection' end,v_pi_id,p_evidence_digest);
      update public.program_billing_orders billing set financial_conflict = true,billing_state = 'financial_conflict',
        revision = billing.revision + 1,updated_at = now() where billing.order_id = p_order_id and not billing.financial_conflict;
      return jsonb_build_object('status','late_payment_manual_review_no_access');
    end if;
    update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
    return jsonb_build_object('status','resource_reconciled_no_access','resource_type','checkout_session');
  elsif p_operation_kind = 'invoice_create' then
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    if not found or p_checkout_attempt_number <> v_invoice.checkout_attempt_number or p_payment_attempt_number <> 0
       or p_provider_object_id !~ '^in_[A-Za-z0-9_]+$' or v_invoice.invoice_id is not null then
      return jsonb_build_object('status','invoice_identity_mismatch');
    end if;
    v_amount := v_order.installment_amounts_cents[p_installment_number];
    v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|invoice|' || v_billing.terms_digest || '|'
      || p_installment_number::text || '|' || p_checkout_attempt_number::text || '|' || v_amount::text);
    if v_operation.request_digest is distinct from v_expected_digest or p_evidence->>'id' is distinct from p_provider_object_id
       or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
       or p_evidence->>'currency' is distinct from 'usd' or p_evidence->>'auto_advance' is distinct from 'false'
       or p_evidence->>'collection_method' is distinct from 'charge_automatically'
       or p_evidence->>'billing_reason' is distinct from 'manual'
       or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_evidence->'metadata'->>'program_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_evidence->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
       or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    v_object_status := p_evidence->>'status';
    v_conflict := v_object_status = 'paid' or coalesce((p_evidence->>'amount_paid')::integer,0) > 0;
    if v_object_status not in ('draft','open','paid','void') then return jsonb_build_object('status','provider_state_unresolved_manual_review'); end if;
    update public.program_billing_installment_invoices invoice_state set invoice_id = p_provider_object_id,
      invoice_create_outcome = 'created',provider_status = case when v_conflict then 'succeeded' else 'unpaid' end,
      revision = invoice_state.revision + 1,updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_provider_object_id,revision = operation.revision + 1,updated_at = now()
    where operation.id = v_operation.id;
    insert into public.program_billing_provider_observations (
      order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
      is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,p_checkout_attempt_number,p_installment_number,'invoice',p_provider_object_id,v_object_status,p_evidence_digest,
      p_checkout_attempt_number = v_billing.current_checkout_attempt,true,v_conflict);
    if v_conflict then
      insert into public.program_billing_financial_conflicts (order_id,reason_code,provider_object_id,evidence_digest)
      values (p_order_id,case when v_deleted then 'payment_after_account_fence' else 'unexpected_invoice_or_collection' end,p_provider_object_id,p_evidence_digest);
      update public.program_billing_orders billing set financial_conflict = true,billing_state = 'financial_conflict',
        revision = billing.revision + 1,updated_at = now() where billing.order_id = p_order_id and not billing.financial_conflict;
      return jsonb_build_object('status','late_invoice_payment_manual_review_no_access');
    end if;
    perform private.ensure_program_billing_operation(p_order_id,'invoice_void',v_invoice.checkout_attempt_number,
      p_installment_number,0::smallint,private.stream_media_identity_digest(p_provider_object_id || '|void'));
    update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
    return jsonb_build_object('status','resource_reconciled_no_access','resource_type','invoice');
  elsif p_operation_kind = 'invoice_item_create' then
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    if not found or p_checkout_attempt_number <> v_invoice.checkout_attempt_number or p_payment_attempt_number <> 0
       or v_invoice.invoice_id is null or v_invoice.invoice_item_id is not null or p_provider_object_id !~ '^ii_[A-Za-z0-9_]+$' then
      return jsonb_build_object('status','invoice_item_identity_mismatch');
    end if;
    v_amount := v_order.installment_amounts_cents[p_installment_number];
    v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|invoice|' || v_billing.terms_digest || '|'
      || p_installment_number::text || '|' || p_checkout_attempt_number::text || '|' || v_amount::text);
    if v_operation.request_digest is distinct from private.stream_media_identity_digest(v_expected_digest || '|line')
       or p_evidence->>'id' is distinct from p_provider_object_id or p_evidence->>'invoice_id' is distinct from v_invoice.invoice_id
       or p_evidence->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_evidence->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'providerScope')
       or p_evidence->>'amount' is distinct from v_amount::text or p_evidence->>'currency' is distinct from 'usd'
       or p_evidence->>'discountable' is distinct from 'false' or p_evidence->>'proration' is distinct from 'false'
       or p_evidence->>'subscription_id' is not null
       or p_evidence->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_evidence->'metadata'->>'program_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_evidence->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment_line'
       or p_evidence->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    update public.program_billing_installment_invoices invoice_state set invoice_item_id = p_provider_object_id,
      line_create_outcome = 'created',revision = invoice_state.revision + 1,updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
    update public.program_billing_operations operation set operation_state = 'succeeded',
      provider_object_id = p_provider_object_id,revision = operation.revision + 1,updated_at = now()
    where operation.id = v_operation.id;
    insert into public.program_billing_provider_observations (
      order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
      is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,p_checkout_attempt_number,p_installment_number,'invoice_item',p_provider_object_id,'created',p_evidence_digest,
      p_checkout_attempt_number = v_billing.current_checkout_attempt,true,false);
    update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
    return jsonb_build_object('status','resource_reconciled_no_access','resource_type','invoice_item');
  else
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    if not found or p_checkout_attempt_number <> v_invoice.checkout_attempt_number
       or (p_operation_kind = 'invoice_finalize' and p_payment_attempt_number <> 0)
       or (p_operation_kind = 'invoice_pay' and p_payment_attempt_number < 1)
       or v_invoice.invoice_id is null or v_invoice.invoice_item_id is null then
      return jsonb_build_object('status','invoice_identity_mismatch');
    end if;
    v_amount := v_order.installment_amounts_cents[p_installment_number];
    v_fee := case when v_order.platform_owned then 0 else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
    if p_operation_kind = 'invoice_finalize' then
      v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|invoice|' || v_billing.terms_digest || '|'
        || p_installment_number::text || '|' || p_checkout_attempt_number::text || '|' || v_amount::text);
      v_expected_digest := private.stream_media_identity_digest(v_expected_digest || '|finalize');
      if v_invoice.finalize_outcome <> 'unknown' or v_invoice.payment_intent_id is not null
         or v_operation.request_digest is distinct from v_expected_digest
         or p_provider_object_id is distinct from v_invoice.invoice_id then return jsonb_build_object('status','invoice_finalize_identity_mismatch'); end if;
      if jsonb_typeof(p_evidence->'invoice') = 'object'
         and jsonb_typeof(p_evidence->'invoice_lines') = 'array'
         and jsonb_array_length(p_evidence->'invoice_lines') = 1
         and (p_evidence->'invoice_payments' is null or p_evidence->'invoice_payments' = '[]'::jsonb)
         and p_evidence->'payment_intent' is null
         and v_invoice.payment_intent_id is null and v_invoice.current_pay_attempt = 0
         and v_invoice.current_pay_outcome = 'none' and v_invoice.collection_started_at is null
         and v_invoice.retry_deadline is null
         and not exists (select 1 from public.program_billing_operations pay_operation
           where pay_operation.order_id = p_order_id and pay_operation.operation_kind = 'invoice_pay'
             and pay_operation.checkout_attempt_number = p_checkout_attempt_number
             and pay_operation.installment_number = p_installment_number)
         and p_evidence->'invoice'->>'status' = 'draft'
         and p_evidence->'invoice'->>'id' = v_invoice.invoice_id
         and p_evidence->'invoice'->>'customer_id' = v_billing.stripe_customer_id
         and p_evidence->'invoice'->>'livemode' = v_billing.provider_livemode::text
         and private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice'->'providerScope')
         and p_evidence->'invoice'->>'auto_advance' = 'false'
         and p_evidence->'invoice'->>'currency' = 'usd'
         and p_evidence->'invoice'->'metadata'->>'program_order_id' = p_order_id::text
         and p_evidence->'invoice'->'metadata'->>'program_installment_number' = p_installment_number::text
         and p_evidence->'invoice'->'metadata'->>'program_attempt_number' = p_checkout_attempt_number::text
         and p_evidence->'invoice'->'metadata'->>'program_billing_kind' = 'standalone_installment'
         and p_evidence->'invoice'->'metadata'->>'program_platform_account_id' = v_billing.provider_platform_account_id
         and p_evidence->'invoice'->'metadata'->>'program_livemode' = v_billing.provider_livemode::text
         and p_evidence->'invoice'->>'billing_reason' = 'manual'
         and (p_evidence->'invoice'->>'starting_balance')::integer = 0
         and (p_evidence->'invoice'->>'amount_shipping')::integer = 0
         and (p_evidence->'invoice'->>'subtotal')::integer = v_amount
         and (p_evidence->'invoice'->>'total')::integer = v_amount
         and p_evidence->'invoice'->'discounts' = '[]'::jsonb
         and p_evidence->'invoice'->'total_discount_amounts' = '[]'::jsonb
         and p_evidence->'invoice'->'default_tax_rates' = '[]'::jsonb
         and p_evidence->'invoice'->'total_taxes' = '[]'::jsonb
         and p_evidence->'invoice_lines'->0->>'invoice_id' = v_invoice.invoice_id
         and p_evidence->'invoice_lines'->0->>'invoice_item_id' = v_invoice.invoice_item_id
         and p_evidence->'invoice_lines'->0->>'livemode' = v_billing.provider_livemode::text
         and private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice_lines'->0->'providerScope')
         and (p_evidence->'invoice_lines'->0->>'amount')::integer = v_amount
         and p_evidence->'invoice_lines'->0->>'currency' = 'usd'
         and p_evidence->'invoice_lines'->0->>'proration' = 'false'
         and p_evidence->'invoice_lines'->0->>'subscription_id' is null
         and p_evidence->'invoice_lines'->0->'discounts' = '[]'::jsonb
         and p_evidence->'invoice_lines'->0->'tax_rates' = '[]'::jsonb
         and p_evidence->'invoice_lines'->0->'tax_amounts' = '[]'::jsonb
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_order_id' = p_order_id::text
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_installment_number' = p_installment_number::text
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_attempt_number' = p_checkout_attempt_number::text
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_billing_kind' = 'standalone_installment_line'
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_platform_account_id' = v_billing.provider_platform_account_id
         and p_evidence->'invoice_lines'->0->'metadata'->>'program_livemode' = v_billing.provider_livemode::text then
        update public.program_billing_operations operation set operation_state = 'terminal_failure',
          provider_object_id = v_invoice.invoice_id,revision = operation.revision + 1,updated_at = now()
        where operation.id = v_operation.id;
        update public.program_billing_installment_invoices invoice_state set finalize_outcome = 'not_started',
          provider_status = 'unpaid',revision = invoice_state.revision + 1,updated_at = now()
        where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
        insert into public.program_billing_provider_observations (
          order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
          is_current_attempt,observed_after_account_fence,manual_review_required
        ) values (p_order_id,p_checkout_attempt_number,p_installment_number,'invoice',v_invoice.invoice_id,'draft',p_evidence_digest,
          p_checkout_attempt_number = v_billing.current_checkout_attempt,true,false);
        perform private.ensure_program_billing_operation(p_order_id,'invoice_void',p_checkout_attempt_number,
          p_installment_number,0::smallint,private.stream_media_identity_digest(v_invoice.invoice_id || '|void'));
        update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
        where billing.order_id = p_order_id;
        return jsonb_build_object('status','finalize_not_applied_invoice_remains_unpaid');
      end if;
    else
      v_expected_digest := private.stream_media_identity_digest(p_order_id::text || '|pay|' || v_invoice.invoice_id || '|'
        || coalesce(v_invoice.payment_intent_id,'') || '|' || v_amount::text || '|' || p_payment_attempt_number::text);
      if p_provider_object_id is distinct from v_invoice.payment_intent_id
         or v_invoice.current_pay_attempt <> p_payment_attempt_number or v_invoice.current_pay_outcome <> 'unknown'
         or v_operation.request_digest is distinct from v_expected_digest then
        return jsonb_build_object('status','invoice_pay_identity_mismatch');
      end if;
    end if;
    if jsonb_typeof(p_evidence->'invoice') is distinct from 'object'
       or jsonb_typeof(p_evidence->'invoice_lines') is distinct from 'array'
       or jsonb_array_length(p_evidence->'invoice_lines') is distinct from 1
       or jsonb_typeof(p_evidence->'invoice_payments') is distinct from 'array'
       or jsonb_array_length(p_evidence->'invoice_payments') is distinct from 1
       or jsonb_typeof(p_evidence->'payment_intent') is distinct from 'object' then
      return jsonb_build_object('status','provider_inventory_incomplete');
    end if;
    v_pi_id := p_evidence->'payment_intent'->>'id';
    v_pi_status := p_evidence->'payment_intent'->>'status';
    if v_pi_id is null or v_pi_id !~ '^pi_[A-Za-z0-9_]+$'
       or p_evidence->'invoice'->>'id' is distinct from v_invoice.invoice_id
       or p_evidence->'invoice'->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_evidence->'invoice'->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice'->'providerScope')
       or p_evidence->'invoice'->>'auto_advance' is distinct from 'false'
       or p_evidence->'invoice'->>'billing_reason' is distinct from 'manual'
       or p_evidence->'invoice'->>'currency' is distinct from 'usd'
       or p_evidence->'invoice'->>'status' not in ('open','paid')
       or p_evidence->'invoice'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'invoice'->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_evidence->'invoice'->'metadata'->>'program_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_evidence->'invoice'->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
       or p_evidence->'invoice'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'invoice'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or (p_evidence->'invoice'->>'total')::integer is distinct from v_amount
       or (p_evidence->'invoice'->>'subtotal')::integer is distinct from v_amount
       or (p_evidence->'invoice'->>'subtotal_excluding_tax')::integer is distinct from v_amount
       or (p_evidence->'invoice'->>'starting_balance')::integer is distinct from 0
       or (p_evidence->'invoice'->>'ending_balance')::integer is distinct from 0
       or (p_evidence->'invoice'->>'amount_shipping')::integer is distinct from 0
       or p_evidence->'invoice'->>'amount_paid' is null
       or (p_evidence->'invoice'->>'amount_paid')::integer not in (0,v_amount)
       or (p_evidence->'invoice'->>'amount_overpaid')::integer is distinct from 0
       or ((p_evidence->'invoice'->>'status' = 'paid') and
         ((p_evidence->'invoice'->>'amount_paid')::integer is distinct from v_amount
          or (p_evidence->'invoice'->>'amount_remaining')::integer is distinct from 0))
       or ((p_evidence->'invoice'->>'status' = 'open') and
         ((p_evidence->'invoice'->>'amount_paid')::integer <> 0
          or (p_evidence->'invoice'->>'amount_remaining')::integer is distinct from v_amount))
       or p_evidence->'invoice'->>'automatic_tax_enabled' is distinct from 'false'
       or p_evidence->'invoice'->'discounts' is distinct from '[]'::jsonb
       or p_evidence->'invoice'->'total_discount_amounts' is distinct from '[]'::jsonb
       or p_evidence->'invoice'->'default_tax_rates' is distinct from '[]'::jsonb
       or p_evidence->'invoice'->'total_taxes' is distinct from '[]'::jsonb
       or p_evidence->'invoice_lines'->0->'tax_amounts' is distinct from '[]'::jsonb
       or p_evidence->'invoice_lines'->0->>'invoice_item_id' is distinct from v_invoice.invoice_item_id
       or p_evidence->'invoice_lines'->0->>'invoice_id' is distinct from v_invoice.invoice_id
       or p_evidence->'invoice_lines'->0->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice_lines'->0->'providerScope')
       or (p_evidence->'invoice_lines'->0->>'amount')::integer is distinct from v_amount
       or p_evidence->'invoice_lines'->0->>'currency' is distinct from 'usd'
       or p_evidence->'invoice_lines'->0->>'discountable' is distinct from 'false'
       or p_evidence->'invoice_lines'->0->>'proration' is distinct from 'false'
       or p_evidence->'invoice_lines'->0->>'subscription_id' is not null
       or p_evidence->'invoice_lines'->0->'discounts' is distinct from '[]'::jsonb
       or p_evidence->'invoice_lines'->0->'tax_rates' is distinct from '[]'::jsonb
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment_line'
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_evidence->'invoice_lines'->0->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or p_evidence->'invoice_payments'->0->>'invoice_id' is distinct from v_invoice.invoice_id
       or p_evidence->'invoice_payments'->0->>'payment_intent_id' is distinct from v_pi_id
       or p_evidence->'invoice_payments'->0->>'is_default' is distinct from 'true'
       or p_evidence->'invoice_payments'->0->>'type' is distinct from 'payment_intent'
       or p_evidence->'invoice_payments'->0->>'status' is distinct from p_evidence->'invoice'->>'status'
       or p_evidence->'invoice_payments'->0->>'currency' is distinct from 'usd'
       or p_evidence->'invoice_payments'->0->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'invoice_payments'->0->'providerScope')
       or (p_evidence->'invoice_payments'->0->>'amount_requested')::integer is distinct from v_amount
       or (p_evidence->'invoice'->>'status' = 'paid' and
         (p_evidence->'invoice_payments'->0->>'amount_paid')::integer is distinct from v_amount)
       or (p_evidence->'invoice'->>'status' = 'open' and
         (p_evidence->'invoice_payments'->0->>'amount_paid' is not null
          and (p_evidence->'invoice_payments'->0->>'amount_paid')::integer <> 0))
       or p_evidence->'payment_intent'->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_evidence->'payment_intent'->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_evidence->'payment_intent'->'providerScope')
       or (p_evidence->'payment_intent'->>'amount')::integer is distinct from v_amount
       or p_evidence->'payment_intent'->>'currency' is distinct from 'usd'
       or p_evidence->'payment_intent'->>'status' not in
         ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded')
       or p_evidence->'payment_intent'->>'amount_received' is null
       or (p_evidence->'payment_intent'->>'amount_received')::integer not in (0,v_amount)
       or p_evidence->'payment_intent'->>'application_fee_amount' is distinct from nullif(v_fee,0)::text
       or p_evidence->'payment_intent'->>'transfer_destination_id' is distinct from v_order.connected_account_id
       or p_evidence->'payment_intent'->>'payment_method_id' is distinct from v_billing.saved_payment_method_id
       or p_evidence->'invoice'->>'default_payment_method_id' is distinct from v_billing.saved_payment_method_id then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    v_conflict := p_evidence->'invoice'->>'status' = 'paid'
      or v_pi_status = 'succeeded' or coalesce((p_evidence->'payment_intent'->>'amount_received')::integer,0) > 0;
    if p_operation_kind = 'invoice_pay' and v_pi_status not in
      ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled') then
      return jsonb_build_object('status','provider_state_unresolved_manual_review');
    end if;
    if p_operation_kind = 'invoice_finalize' and v_pi_status not in
      ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded') then
      return jsonb_build_object('status','provider_state_unresolved_manual_review');
    end if;
    if v_conflict and (p_evidence->'invoice_payments'->0->>'amount_paid' is null
       or (p_evidence->'invoice_payments'->0->>'amount_paid')::integer is distinct from v_amount
       or (p_evidence->'payment_intent'->>'amount_received')::integer is distinct from v_amount
       or p_evidence->'invoice'->>'status' <> 'paid' or v_pi_status <> 'succeeded') then
      return jsonb_build_object('status','provider_payment_topology_mismatch_manual_review');
    end if;
    if not v_conflict and (p_evidence->'invoice'->>'status' <> 'open'
       or coalesce((p_evidence->'payment_intent'->>'amount_received')::integer,0) <> 0) then
      return jsonb_build_object('status','provider_payment_state_unresolved');
    end if;
    if v_invoice.payment_intent_id is not null and v_invoice.payment_intent_id <> v_pi_id then
      return jsonb_build_object('status','provider_identity_mismatch_manual_review');
    end if;
    update public.program_billing_installment_invoices invoice_state set payment_intent_id = v_pi_id,
      finalize_outcome = case when p_operation_kind = 'invoice_finalize' then 'finalized' else invoice_state.finalize_outcome end,
      provider_status = case when v_conflict then 'succeeded' else v_pi_status end,
      current_pay_outcome = case when p_operation_kind <> 'invoice_pay' then invoice_state.current_pay_outcome
        when v_pi_status = 'succeeded' then 'succeeded'
        when v_pi_status = 'processing' then 'processing'
        when v_pi_status = 'requires_action' then 'requires_action'
        else 'failed' end,
      revision = invoice_state.revision + 1,updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
    v_operation_state := case when p_operation_kind = 'invoice_pay' and v_pi_status in ('requires_payment_method','requires_confirmation','canceled')
      then 'terminal_failure' else 'succeeded' end;
    update public.program_billing_operations operation set operation_state = v_operation_state,
      provider_object_id = case when p_operation_kind = 'invoice_finalize' then v_invoice.invoice_id else v_pi_id end,
      revision = operation.revision + 1,updated_at = now() where operation.id = v_operation.id;
    insert into public.program_billing_provider_observations (
      order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,provider_status,evidence_digest,
      is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,p_checkout_attempt_number,p_installment_number,'invoice',v_invoice.invoice_id,
      p_evidence->'invoice'->>'status',p_evidence_digest,p_checkout_attempt_number = v_billing.current_checkout_attempt,true,v_conflict),
      (p_order_id,p_checkout_attempt_number,p_installment_number,'payment_intent',v_pi_id,v_pi_status,p_evidence_digest,
      p_checkout_attempt_number = v_billing.current_checkout_attempt,true,v_conflict);
    if v_conflict then
      insert into public.program_billing_financial_conflicts (order_id,reason_code,provider_object_id,evidence_digest)
      values (p_order_id,case when v_deleted then 'payment_after_account_fence' else 'unexpected_invoice_or_collection' end,v_pi_id,p_evidence_digest);
      update public.program_billing_orders billing set financial_conflict = true,billing_state = 'financial_conflict',
        revision = billing.revision + 1,updated_at = now() where billing.order_id = p_order_id and not billing.financial_conflict;
      return jsonb_build_object('status','late_payment_manual_review_no_access');
    end if;
    if p_operation_kind = 'invoice_finalize' then
      perform private.ensure_program_billing_operation(p_order_id,'invoice_void',p_checkout_attempt_number,
        p_installment_number,0::smallint,private.stream_media_identity_digest(v_invoice.invoice_id || '|void'));
    end if;
    update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
    return jsonb_build_object('status',case when v_pi_status in ('processing','requires_action')
      then 'resource_reconciled_pending_no_access' else 'resource_reconciled_no_access' end,
      'resource_type',p_operation_kind,'payment_intent_status',v_pi_status);
  end if;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or unique_violation then
  return jsonb_build_object('status','provider_identity_mismatch_manual_review');
end;
$$;
revoke all on function public.reconcile_program_billing_drain_resource(uuid,bigint,text,smallint,smallint,smallint,text,jsonb,text)
from public, anon, authenticated;
grant execute on function public.reconcile_program_billing_drain_resource(uuid,bigint,text,smallint,smallint,smallint,text,jsonb,text)
to service_role;

create function public.mark_program_billing_operation_unknown(
  p_order_id uuid,p_operation_kind text,p_checkout_attempt smallint,p_installment smallint,p_payment_attempt smallint
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program provider operation state is server managed' using errcode = '42501';
  end if;
  if p_operation_kind not in ('customer_create','checkout_create','invoice_create','invoice_item_create','invoice_finalize') then
    return false;
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not private.stream_media_account_ingress_allowed(v_buyer_id) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.cancellation_request_id is not null or v_billing.financial_conflict
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return false; end if;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = p_operation_kind
    and operation.checkout_attempt_number = p_checkout_attempt
    and operation.installment_number = p_installment
    and operation.payment_attempt_number = p_payment_attempt for update;
  if not found or v_operation.operation_state not in ('intent','unknown') then return false; end if;
  if v_operation.operation_state = 'intent' then
    update public.program_billing_operations operation set operation_state = 'unknown',
      revision = operation.revision + 1, updated_at = now() where operation.id = v_operation.id;
  end if;
  if p_operation_kind = 'checkout_create' then
    update public.program_billing_checkout_attempts attempt set create_outcome = 'unknown',
      revision = attempt.revision + 1, updated_at = now()
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt
      and attempt.checkout_session_id is null;
  elsif p_operation_kind in ('invoice_create','invoice_item_create','invoice_finalize') then
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment for update;
    if not found or v_invoice.checkout_attempt_number <> p_checkout_attempt then return false; end if;
    update public.program_billing_installment_invoices invoice_state set
      invoice_create_outcome = case when p_operation_kind = 'invoice_create' then 'unknown' else invoice_state.invoice_create_outcome end,
      line_create_outcome = case when p_operation_kind = 'invoice_item_create' then 'unknown' else invoice_state.line_create_outcome end,
      finalize_outcome = case when p_operation_kind = 'invoice_finalize' then 'unknown' else invoice_state.finalize_outcome end,
      revision = invoice_state.revision + 1, updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment;
  end if;
  return true;
end;
$$;
revoke all on function public.mark_program_billing_operation_unknown(uuid,text,smallint,smallint,smallint)
from public, anon, authenticated;
grant execute on function public.mark_program_billing_operation_unknown(uuid,text,smallint,smallint,smallint) to service_role;

create function public.mark_program_billing_cancellation_operation_unknown(
  p_order_id uuid,p_operation_kind text,p_checkout_attempt_number smallint,p_installment_number smallint
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_digest text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program cancellation provider operations are server managed' using errcode = '42501';
  end if;
  if p_operation_kind not in ('checkout_expire','invoice_void') then return false; end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return false; end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.cancellation_request_id is null then return false; end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
    where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
      and tombstone.tombstone_state <> 'completed' for share;
    if not found or not exists (select 1 from public.platform_membership_deletion_locks fence
      where fence.member_id = v_buyer_id) then return false; end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
      return false;
    end if;
  else
    return false;
  end if;
  if p_operation_kind = 'checkout_expire' then
    if p_installment_number <> 0 then return false; end if;
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number for update;
    if not found or v_attempt.checkout_session_id is null or v_attempt.attempt_state = 'paid' then return false; end if;
    v_digest := private.stream_media_identity_digest(v_attempt.checkout_session_id || '|expire');
  else
    if p_installment_number < 2 then return false; end if;
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    if not found or v_invoice.checkout_attempt_number <> p_checkout_attempt_number
       or v_invoice.invoice_id is null or v_invoice.provider_status = 'succeeded' then return false; end if;
    v_digest := private.stream_media_identity_digest(v_invoice.invoice_id || '|void');
  end if;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = p_operation_kind
    and operation.checkout_attempt_number = p_checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if not found or v_operation.request_digest is distinct from v_digest
     or v_operation.operation_state not in ('intent','unknown') then return false; end if;
  if v_operation.operation_state = 'intent' then
    update public.program_billing_operations operation set operation_state = 'unknown',
      revision = operation.revision + 1,updated_at = now() where operation.id = v_operation.id;
  end if;
  return true;
end;
$$;
revoke all on function public.mark_program_billing_cancellation_operation_unknown(uuid,text,smallint,smallint)
from public, anon, authenticated;
grant execute on function public.mark_program_billing_cancellation_operation_unknown(uuid,text,smallint,smallint)
to service_role;

create function public.prepare_program_invoice_pay_attempt(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,
  p_invoice_id text,p_payment_intent_id text,p_verified_status text,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_previous public.program_order_installments%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_pay_attempt smallint;
  v_key text;
  v_digest text;
  v_amount integer;
  v_operation public.program_billing_operations%rowtype;
  v_collection_started_at timestamptz;
  v_retry_deadline timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program invoice payment attempts are server managed' using errcode = '42501';
  end if;
  if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_verified_status not in ('requires_payment_method','requires_confirmation') then
    return jsonb_build_object('status','payment_status_not_retryable');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  if exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  if not private.program_billing_order_is_eligible(p_order_id,v_buyer_id) then return jsonb_build_object('status','buyer_or_program_ineligible'); end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_billing.revision <> p_expected_revision or v_billing.cancellation_request_id is not null
     or v_billing.financial_conflict or v_invoice.invoice_id is distinct from p_invoice_id
     or v_invoice.payment_intent_id is distinct from p_payment_intent_id
     or v_invoice.checkout_attempt_number <> v_billing.current_checkout_attempt
     or v_invoice.current_pay_outcome not in ('none','failed')
     or (v_invoice.retry_deadline is not null and now() > v_invoice.retry_deadline) then
    return jsonb_build_object('status','pay_not_eligible');
  end if;
  if v_invoice.collection_started_at is null and (now() at time zone 'America/New_York')::date > v_invoice.due_date then
    return jsonb_build_object('status','buyer_confirmation_required');
  end if;
  select installment.* into v_previous from public.program_order_installments installment
  where installment.order_id = p_order_id and installment.installment_number = p_installment_number - 1 for update;
  if not found or v_previous.provider_status <> 'succeeded' or v_previous.net_settled_cents <> v_previous.due_cents then
    return jsonb_build_object('status','prior_installment_unsettled');
  end if;
  v_pay_attempt := v_invoice.current_pay_attempt + 1;
  if v_pay_attempt > 16 then return jsonb_build_object('status','retry_limit_reached'); end if;
  v_amount := v_order.installment_amounts_cents[p_installment_number];
  v_collection_started_at := coalesce(v_invoice.collection_started_at,now());
  v_retry_deadline := coalesce(v_invoice.retry_deadline,v_collection_started_at + interval '7 days');
  v_digest := private.stream_media_identity_digest(p_order_id::text || '|pay|' || p_invoice_id || '|'
    || p_payment_intent_id || '|' || v_amount::text || '|' || v_pay_attempt::text);
  v_key := private.ensure_program_billing_operation(p_order_id,'invoice_pay',
    v_invoice.checkout_attempt_number,p_installment_number,v_pay_attempt,v_digest);
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.idempotency_key = v_key for update;
  if found and v_operation.operation_state = 'intent' then
    update public.program_billing_operations operation set operation_state = 'unknown',
      revision = operation.revision + 1,updated_at = now() where operation.id = v_operation.id;
  end if;
  update public.program_billing_installment_invoices invoice_state set
    current_pay_attempt = v_pay_attempt,current_pay_idempotency_key = v_key,
    current_pay_outcome = 'unknown',provider_status = 'unpaid',
    collection_started_at = v_collection_started_at,retry_deadline = v_retry_deadline,
    revision = invoice_state.revision + 1,updated_at = now()
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
  insert into public.program_billing_provider_observations (
    order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
    provider_status,evidence_digest,is_current_attempt
  ) values (p_order_id,v_invoice.checkout_attempt_number,p_installment_number,'payment_intent',
    p_payment_intent_id,p_verified_status,p_evidence_digest,true);
  return jsonb_build_object('status','prepared','attempt_number',v_pay_attempt,'idempotency_key',v_key);
end;
$$;
revoke all on function public.prepare_program_invoice_pay_attempt(uuid,bigint,smallint,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.prepare_program_invoice_pay_attempt(uuid,bigint,smallint,text,text,text,text) to service_role;
create function public.record_program_billing_provider_observation(
  p_order_id uuid,p_checkout_attempt_number smallint,p_installment_number smallint,
  p_provider_object_type text,p_provider_object_id text,p_provider_status text,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_current boolean := false;
  v_identity_matches boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program provider observations are server managed' using errcode = '42501';
  end if;
  if p_provider_object_type not in ('checkout_session','payment_intent','invoice','invoice_item','customer')
     or p_provider_status is null then
    return jsonb_build_object('status','invalid_observation');
  end if;
  if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid_digest');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if private.stream_account_is_tombstoned(v_buyer_id)
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
    insert into public.program_billing_provider_observations (
      order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_order_id,p_checkout_attempt_number,p_installment_number,p_provider_object_type,p_provider_object_id,
      p_provider_status,p_evidence_digest,false,true,p_provider_status = 'succeeded');
    if p_provider_object_type = 'payment_intent' and p_provider_status = 'succeeded' then
      insert into public.program_billing_financial_conflicts
        (order_id,reason_code,provider_object_id,evidence_digest)
      values (p_order_id,'payment_after_account_fence',p_provider_object_id,p_evidence_digest);
      return jsonb_build_object('status','manual_review_after_account_fence');
    end if;
    return jsonb_build_object('status','audited_after_account_fence');
  end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_busy'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found then return jsonb_build_object('status','billing_state_missing'); end if;
  if p_installment_number = 1 then
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number for update;
    v_identity_matches := found and case p_provider_object_type
      when 'checkout_session' then v_attempt.checkout_session_id = p_provider_object_id
      when 'payment_intent' then v_attempt.payment_intent_id = p_provider_object_id
      when 'customer' then v_billing.stripe_customer_id = p_provider_object_id
      else false end;
    v_current := found and p_checkout_attempt_number = v_billing.current_checkout_attempt
      and v_attempt.attempt_state not in ('expired_unpaid','canceled','financial_conflict')
      and v_identity_matches;
  elsif p_installment_number between 2 and 12 then
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    v_current := found and v_invoice.checkout_attempt_number = p_checkout_attempt_number
      and v_billing.current_checkout_attempt = p_checkout_attempt_number;
    v_identity_matches := found and case p_provider_object_type
      when 'invoice' then v_invoice.invoice_id = p_provider_object_id
      when 'invoice_item' then v_invoice.invoice_item_id = p_provider_object_id
      when 'payment_intent' then v_invoice.payment_intent_id = p_provider_object_id
      when 'customer' then v_billing.stripe_customer_id = p_provider_object_id
      else false end;
    v_current := v_current and v_identity_matches;
  end if;
  insert into public.program_billing_provider_observations (
    order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
    provider_status,evidence_digest,is_current_attempt,manual_review_required
  ) values (p_order_id,p_checkout_attempt_number,p_installment_number,p_provider_object_type,p_provider_object_id,
    p_provider_status,p_evidence_digest,v_current,not v_identity_matches or (p_provider_status = 'succeeded' and not v_current));
  if not v_identity_matches then
    if p_provider_object_type = 'payment_intent' and p_provider_status = 'succeeded' then
      insert into public.program_billing_financial_conflicts
        (order_id,reason_code,provider_object_id,evidence_digest)
      values (p_order_id,'provider_identity_mismatch',p_provider_object_id,p_evidence_digest);
      update public.program_billing_orders billing set financial_conflict = true,
        billing_state = 'financial_conflict',revision = billing.revision + 1,updated_at = now()
      where billing.order_id = p_order_id and not billing.financial_conflict;
    end if;
    return jsonb_build_object('status','provider_identity_mismatch_manual_review');
  end if;
  if p_provider_object_type = 'payment_intent' and p_provider_status = 'succeeded' and not v_current then
    insert into public.program_billing_financial_conflicts
      (order_id,reason_code,provider_object_id,evidence_digest)
    values (p_order_id,'late_payment_after_terminal_retry',p_provider_object_id,p_evidence_digest);
    update public.program_billing_orders billing set financial_conflict = true,
      billing_state = 'financial_conflict',revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id and not billing.financial_conflict;
    return jsonb_build_object('status','late_payment_manual_review');
  end if;
  if not v_current then return jsonb_build_object('status','stale_attempt_audited'); end if;
  if p_provider_object_type = 'payment_intent' and p_installment_number = 1
     and p_provider_status in ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','failed') then
    update public.program_billing_checkout_attempts attempt set provider_status = p_provider_status,
      attempt_state = case when p_provider_status = 'succeeded' then 'paid'
        when p_provider_status = 'canceled' then 'canceled' else attempt.attempt_state end,
      revision = attempt.revision + 1,updated_at = now()
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number;
  elsif p_provider_object_type = 'payment_intent' and p_installment_number between 2 and 12
     and p_provider_status in ('requires_payment_method','requires_confirmation','requires_action','processing','succeeded','canceled','failed') then
    update public.program_billing_installment_invoices invoice_state set provider_status = p_provider_status,
      current_pay_outcome = case when invoice_state.current_pay_attempt = 0 then 'none'
        when p_provider_status in ('requires_payment_method','requires_confirmation','failed','canceled') then 'failed'
        when p_provider_status = 'requires_action' then 'requires_action'
        when p_provider_status = 'processing' then 'processing'
        when p_provider_status = 'succeeded' then 'succeeded'
        else invoice_state.current_pay_outcome end,
      revision = invoice_state.revision + 1,updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
    if v_invoice.current_pay_attempt > 0 then
      select operation.* into v_operation from public.program_billing_operations operation
      where operation.order_id = p_order_id and operation.operation_kind = 'invoice_pay'
        and operation.checkout_attempt_number = p_checkout_attempt_number
        and operation.installment_number = p_installment_number
        and operation.payment_attempt_number = v_invoice.current_pay_attempt for update;
      if found and v_operation.operation_state in ('intent','unknown') then
        update public.program_billing_operations operation set operation_state =
          case when p_provider_status in ('requires_payment_method','requires_confirmation','failed','canceled') then 'terminal_failure' else 'succeeded' end,
          provider_object_id = p_provider_object_id,revision = operation.revision + 1,updated_at = now()
        where operation.id = v_operation.id;
      end if;
    end if;
  end if;
  return jsonb_build_object('status','observed_current');
end;
$$;
revoke all on function public.record_program_billing_provider_observation(uuid,smallint,smallint,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.record_program_billing_provider_observation(uuid,smallint,smallint,text,text,text,text)
to service_role;
create function public.record_program_billing_refund(
  p_order_id uuid,p_installment_number smallint,p_expected_installment_revision bigint,
  p_event_id text,p_refund_id text,p_payment_intent_id text,p_charge_id text,
  p_refund_cents integer,p_provider_evidence jsonb,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_installment public.program_order_installments%rowtype;
  v_claim public.program_payment_intent_claims%rowtype;
  v_prior public.program_billing_provider_observations%rowtype;
  v_core_ok boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program refund reconciliation is server managed' using errcode = '42501';
  end if;
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or p_refund_id is null or p_refund_id !~ '^re_[A-Za-z0-9_]+$'
     or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     or p_charge_id is null or p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
     or p_refund_cents is null or p_refund_cents <= 0
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_provider_evidence is null then return jsonb_build_object('status','invalid_refund_proof'); end if;
  select event.* into v_prior from public.program_billing_provider_observations event
  where event.provider_event_id = p_event_id;
  if found then
    if v_prior.provider_object_id = p_payment_intent_id and v_prior.evidence_digest = p_evidence_digest then
      return jsonb_build_object('status','already_recorded');
    end if;
    return jsonb_build_object('status','event_identity_mismatch');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','order_not_found'); end if;
  if private.stream_account_is_tombstoned(v_buyer_id)
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
    insert into public.program_billing_provider_observations (
      provider_event_id,order_id,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_event_id,p_order_id,p_installment_number,'payment_intent',p_payment_intent_id,
      'refund_marker',p_evidence_digest,false,true,true);
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,'refund_after_account_fence',p_payment_intent_id,p_evidence_digest);
    return jsonb_build_object('status','refund_after_account_fence_manual_review');
  end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_busy'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select installment.* into v_installment from public.program_order_installments installment
  where installment.order_id = p_order_id and installment.installment_number = p_installment_number for update;
  select claim.* into v_claim from public.program_payment_intent_claims claim
  where claim.payment_intent_id = p_payment_intent_id and claim.order_id = p_order_id
    and claim.installment_number = p_installment_number;
  if not found or v_installment.revision <> p_expected_installment_revision
     or not exists (select 1 from public.program_provider_object_claims provider_claim
       where provider_claim.provider = 'stripe' and provider_claim.object_type = 'charge'
         and provider_claim.object_id = p_charge_id and provider_claim.canonical_payment_intent_id = p_payment_intent_id
         and provider_claim.order_id = p_order_id and provider_claim.installment_number = p_installment_number)
     or p_provider_evidence->>'event_id' is distinct from p_event_id
     or p_provider_evidence->>'refund_id' is distinct from p_refund_id
     or p_provider_evidence->>'payment_intent_id' is distinct from p_payment_intent_id
     or p_provider_evidence->>'charge_id' is distinct from p_charge_id
     or (p_provider_evidence->>'amount')::integer is distinct from p_refund_cents then
    insert into public.program_billing_provider_observations (
      provider_event_id,order_id,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,manual_review_required
    ) values (p_event_id,p_order_id,p_installment_number,'payment_intent',p_payment_intent_id,
      'refund_marker',p_evidence_digest,false,true);
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,'unmatched_refund_review',p_refund_id,p_evidence_digest);
    return jsonb_build_object('status','refund_manual_review');
  end if;
  v_core_ok := public.record_program_refund_marker(
    p_order_id,p_installment_number,v_installment.revision,p_event_id,p_refund_id,
    p_payment_intent_id,p_charge_id,p_refund_cents
  );
  insert into public.program_billing_provider_observations (
    provider_event_id,order_id,installment_number,provider_object_type,provider_object_id,
    provider_status,evidence_digest,is_current_attempt,manual_review_required
  ) values (p_event_id,p_order_id,p_installment_number,'payment_intent',p_payment_intent_id,
    'refund_marker',p_evidence_digest,true,not v_core_ok);
  if not v_core_ok then
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,'unmatched_refund_review',p_refund_id,p_evidence_digest);
    return jsonb_build_object('status','refund_marker_rejected_manual_review');
  end if;
  return jsonb_build_object('status','refund_recorded_for_review_policy');
end;
$$;
revoke all on function public.record_program_billing_refund(uuid,smallint,bigint,text,text,text,text,integer,jsonb,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_program_billing_refund(uuid,smallint,bigint,text,text,text,text,integer,jsonb,text)
to service_role;

create function public.request_program_billing_cancellation(p_order_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid := auth.uid();
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    raise exception 'A signed-in buyer must request Program cancellation' using errcode = '42501';
  end if;
  if p_order_id is null or p_request_id is null then return jsonb_build_object('status','invalid_request'); end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_fenced'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state
  join public.program_orders orders on orders.id = state.order_id
  where state.order_id = p_order_id and orders.buyer_id = v_buyer_id for update of state;
  if not found then return jsonb_build_object('status','not_found'); end if;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found then return jsonb_build_object('status','billing_history_only'); end if;
  if v_billing.cancellation_request_id is not null then
    if v_billing.cancellation_request_id = p_request_id and v_billing.cancellation_reason = 'buyer' then
      return jsonb_build_object('status','already_requested','billing_state',v_billing.billing_state);
    end if;
    return jsonb_build_object('status','already_closed');
  end if;
  update public.program_billing_orders billing set cancellation_request_id = p_request_id,
    cancellation_reason = 'buyer',billing_state = 'cancel_requested',
    revision = billing.revision + 1,updated_at = now()
  where billing.order_id = p_order_id;
  update public.program_billing_operations operation set operation_state = 'terminal_failure',
    revision = operation.revision + 1,updated_at = now()
  where operation.order_id = p_order_id and operation.operation_state = 'intent';
  for v_attempt in
    select attempt.* from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.checkout_session_id is not null order by attempt.attempt_number
  loop
    perform private.ensure_program_billing_operation(p_order_id,'checkout_expire',v_attempt.attempt_number,0::smallint,0::smallint,
      private.stream_media_identity_digest(v_attempt.checkout_session_id || '|expire'));
  end loop;
  for v_invoice in
    select invoice_state.* from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null order by invoice_state.installment_number
  loop
    perform private.ensure_program_billing_operation(p_order_id,'invoice_void',v_invoice.checkout_attempt_number,
      v_invoice.installment_number,0::smallint,private.stream_media_identity_digest(v_invoice.invoice_id || '|void'));
  end loop;
  if v_gate_state.billing_state not in ('cancel_requested','canceled','closed') then
    update public.program_order_state state set billing_state = 'cancel_requested',
      revision = state.revision + 1,updated_at = now() where state.order_id = p_order_id;
  end if;
  return jsonb_build_object('status','cancellation_requested','revision',v_billing.revision + 1);
end;
$$;
revoke all on function public.request_program_billing_cancellation(uuid,uuid) from public, anon, service_role;
grant execute on function public.request_program_billing_cancellation(uuid,uuid) to authenticated;
create function private.program_billing_cancel_inventory_is_complete(p_order_id uuid,p_inventory jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.program_orders%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_item jsonb;
  v_intent jsonb;
  v_expected_pi_count integer;
  v_session_count integer;
  v_invoice_count integer;
  v_deleted_invoice_count integer;
  v_amount integer;
  v_fee integer;
begin
  if p_inventory is null or p_inventory->>'completeInventory' is distinct from 'true'
     or jsonb_typeof(p_inventory->'sessions') is distinct from 'array'
     or jsonb_typeof(p_inventory->'paymentIntents') is distinct from 'array'
     or jsonb_typeof(p_inventory->'invoices') is distinct from 'array'
     or jsonb_typeof(p_inventory->'deletedInvoices') is distinct from 'array'
     or jsonb_typeof(p_inventory->'subscriptions') is distinct from 'array'
     or jsonb_typeof(p_inventory->'schedules') is distinct from 'array'
     or p_inventory->>'pendingInvoiceItemCount' is distinct from '0'
     or jsonb_array_length(p_inventory->'subscriptions') <> 0
     or jsonb_array_length(p_inventory->'schedules') <> 0 then return false; end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id;
  if not found then return false; end if;
  if v_billing.stripe_customer_id is null then
    return p_inventory ? 'customerId' and p_inventory->'customerId' = 'null'::jsonb
      and p_inventory ? 'customer' and p_inventory->'customer' = 'null'::jsonb
      and jsonb_array_length(p_inventory->'sessions') = 0
      and jsonb_array_length(p_inventory->'paymentIntents') = 0
      and jsonb_array_length(p_inventory->'invoices') = 0
      and jsonb_array_length(p_inventory->'deletedInvoices') = 0
      and not exists (select 1 from public.program_billing_checkout_attempts attempt
        where attempt.order_id = p_order_id and (attempt.checkout_session_id is not null or attempt.payment_intent_id is not null))
      and not exists (select 1 from public.program_billing_installment_invoices invoice_state
        where invoice_state.order_id = p_order_id and (invoice_state.invoice_id is not null or invoice_state.payment_intent_id is not null))
      and not exists (select 1 from public.program_billing_operations operation
        where operation.order_id = p_order_id and operation.operation_kind = 'customer_create'
          and operation.operation_state in ('unknown','succeeded'));
  end if;
  if jsonb_typeof(p_inventory->'customer') is distinct from 'object'
     or p_inventory->>'customerId' is distinct from v_billing.stripe_customer_id
     or p_inventory->'customer'->>'id' is distinct from v_billing.stripe_customer_id
     or p_inventory->'customer'->>'deleted' is distinct from 'false'
     or p_inventory->'customer'->>'balance' is distinct from '0'
     or v_billing.provider_platform_account_id is null or v_billing.provider_livemode is null
     or p_inventory->'customer'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_inventory->'customer'->'providerScope')
     or not (p_inventory->'customer' ? 'discountId')
     or p_inventory->'customer'->>'discountId' is not null
     or p_inventory->'customer'->>'taxExempt' is distinct from 'none'
     or p_inventory->'customer'->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_inventory->'customer'->'metadata'->>'program_billing_purpose' is distinct from 'program_order'
     or p_inventory->'customer'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_inventory->'customer'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_customer_credit_balance_is_zero(p_inventory->'customer'->'invoiceCreditBalance') then
    return false; end if;
  select count(*)::integer into v_session_count from public.program_billing_checkout_attempts attempt
  where attempt.order_id = p_order_id and attempt.checkout_session_id is not null;
  select count(*)::integer into v_invoice_count from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null
    and invoice_state.provider_status <> 'deleted';
  select count(*)::integer into v_deleted_invoice_count from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null
    and invoice_state.provider_status = 'deleted';
  select count(*)::integer into v_expected_pi_count from (
    select attempt.payment_intent_id as pi_id from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
    union all
    select invoice_state.payment_intent_id as pi_id from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.payment_intent_id is not null
  ) known_pi;
  if jsonb_array_length(p_inventory->'sessions') is distinct from v_session_count
     or jsonb_array_length(p_inventory->'invoices') is distinct from v_invoice_count
     or jsonb_array_length(p_inventory->'deletedInvoices') is distinct from v_deleted_invoice_count
     or jsonb_array_length(p_inventory->'paymentIntents') is distinct from v_expected_pi_count then return false; end if;

  for v_attempt in
    select attempt.* from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id order by attempt.attempt_number
  loop
    if v_attempt.checkout_session_id is not null then
      v_amount := v_order.installment_amounts_cents[1];
      v_fee := case when v_order.platform_owned then 0
        else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
      select item.value into v_item from jsonb_array_elements(p_inventory->'sessions') item(value)
      where item.value->>'id' = v_attempt.checkout_session_id;
      if not found or v_item->>'customerId' is distinct from v_billing.stripe_customer_id
         or v_item->>'livemode' is distinct from v_billing.provider_livemode::text
         or not private.program_billing_provider_scope_matches(p_order_id,v_item->'providerScope')
         or not (v_item ? 'paymentIntentId')
         or v_item->>'paymentIntentId' is distinct from v_attempt.payment_intent_id
         or v_item->'metadata'->>'program_order_id' is distinct from p_order_id::text
         or v_item->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
         or v_item->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
         or v_item->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
      if v_item->>'status' = 'expired' and v_item->>'paymentStatus' = 'unpaid' then
        if v_attempt.payment_intent_id is not null then
          select item.value into v_intent from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
          where item.value->>'id' = v_attempt.payment_intent_id;
          if not found or v_intent->>'id' is distinct from v_attempt.payment_intent_id
             or v_intent->>'customerId' is distinct from v_billing.stripe_customer_id
             or v_intent->>'status' is distinct from 'canceled'
             or not (v_intent ? 'applicationFeeAmount') or not (v_intent ? 'transferDestinationId')
             or v_intent->>'livemode' is distinct from v_billing.provider_livemode::text
             or not private.program_billing_provider_scope_matches(p_order_id,v_intent->'providerScope')
             or (v_intent->>'amount')::integer is distinct from v_amount
             or (v_intent->>'amountReceived')::integer is distinct from 0
             or v_intent->>'currency' is distinct from 'usd'
             or v_intent->>'applicationFeeAmount' is distinct from nullif(v_fee,0)::text
             or v_intent->>'transferDestinationId' is distinct from v_order.connected_account_id
             or v_intent->'metadata'->>'program_order_id' is distinct from p_order_id::text
             or v_intent->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
             or v_intent->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
             or v_intent->'metadata'->>'program_checkout_attempt_number' is distinct from v_attempt.attempt_number::text
             or v_intent->'metadata'->>'program_installment_number' is distinct from '1'
             or v_intent->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
             or v_intent->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
        end if;
      elsif v_item->>'status' = 'complete' and v_item->>'paymentStatus' = 'paid' then
        if v_attempt.payment_intent_id is null
           or not exists (select 1 from public.program_payment_intent_claims claim
             where claim.payment_intent_id = v_attempt.payment_intent_id and claim.order_id = p_order_id
               and claim.installment_number = 1) then return false; end if;
        select item.value into v_intent from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
        where item.value->>'id' = v_attempt.payment_intent_id;
        if not found or v_intent->>'id' is distinct from v_attempt.payment_intent_id
           or v_intent->>'customerId' is distinct from v_billing.stripe_customer_id
           or v_intent->>'status' is distinct from 'succeeded'
           or not (v_intent ? 'applicationFeeAmount') or not (v_intent ? 'transferDestinationId')
           or v_intent->>'livemode' is distinct from v_billing.provider_livemode::text
           or not private.program_billing_provider_scope_matches(p_order_id,v_intent->'providerScope')
           or (v_intent->>'amount')::integer is distinct from v_amount
           or (v_intent->>'amountReceived')::integer is distinct from v_amount
           or v_intent->>'currency' is distinct from 'usd'
           or v_intent->>'applicationFeeAmount' is distinct from nullif(v_fee,0)::text
           or v_intent->>'transferDestinationId' is distinct from v_order.connected_account_id
           or v_intent->'metadata'->>'program_order_id' is distinct from p_order_id::text
           or v_intent->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
           or v_intent->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
           or v_intent->'metadata'->>'program_checkout_attempt_number' is distinct from v_attempt.attempt_number::text
           or v_intent->'metadata'->>'program_installment_number' is distinct from '1'
           or v_intent->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
           or v_intent->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
      else
        return false;
      end if;
    end if;
    if v_attempt.payment_intent_id is not null then
      if not exists (select 1 from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
        where item.value->>'id' = v_attempt.payment_intent_id) then return false; end if;
    end if;
  end loop;

  for v_invoice in
    select invoice_state.* from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id order by invoice_state.installment_number
  loop
    if v_invoice.invoice_id is not null then
      if v_invoice.provider_status = 'deleted' then
        if not (p_inventory->'deletedInvoices' @> to_jsonb(array[v_invoice.invoice_id]))
           or exists (select 1 from jsonb_array_elements(p_inventory->'invoices') item(value)
             where item.value->>'id' = v_invoice.invoice_id)
           or v_invoice.payment_intent_id is not null
           or not exists (select 1 from public.program_billing_invoice_delete_proofs proof
             join public.program_billing_operations operation on operation.id = proof.operation_id
             where proof.order_id = p_order_id and proof.installment_number = v_invoice.installment_number
               and proof.checkout_attempt_number = v_invoice.checkout_attempt_number
               and proof.invoice_id = v_invoice.invoice_id and proof.customer_id = v_billing.stripe_customer_id
               and proof.provider_platform_account_id = v_billing.provider_platform_account_id
               and proof.provider_livemode = v_billing.provider_livemode
               and proof.proof_state in ('deleted','missing')
               and proof.terminal_digest is not null
               and operation.operation_kind = 'invoice_delete' and operation.operation_state = 'succeeded'
               and operation.provider_object_id = v_invoice.invoice_id)
           or exists (select 1 from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
             where item.value->'metadata'->>'program_installment_number' = v_invoice.installment_number::text
               and item.value->'metadata'->>'program_order_id' = p_order_id::text)
        then return false; end if;
        continue;
      end if;
      select item.value into v_item from jsonb_array_elements(p_inventory->'invoices') item(value)
      where item.value->>'id' = v_invoice.invoice_id;
      if not found or v_item->>'customerId' is distinct from v_billing.stripe_customer_id
         or v_item->>'livemode' is distinct from v_billing.provider_livemode::text
         or not private.program_billing_provider_scope_matches(p_order_id,v_item->'providerScope')
         or v_item->>'currency' is distinct from 'usd' or v_item->>'autoAdvance' is distinct from 'false'
         or v_item->>'billingReason' is distinct from 'manual'
         or v_item->'metadata'->>'program_order_id' is distinct from p_order_id::text
         or v_item->'metadata'->>'program_installment_number' is distinct from v_invoice.installment_number::text
         or v_item->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
         or v_item->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
         or jsonb_typeof(v_item->'lines') is distinct from 'array'
         or jsonb_array_length(v_item->'lines') is distinct from (case when v_invoice.invoice_item_id is null then 0 else 1 end) then return false; end if;
      v_amount := v_order.installment_amounts_cents[v_invoice.installment_number];
      if v_invoice.invoice_item_id is not null then
        if v_item->'lines'->0->>'invoiceItemId' is distinct from v_invoice.invoice_item_id
           or (v_item->'lines'->0->>'amount')::integer is distinct from v_amount
           or v_item->'lines'->0->>'livemode' is distinct from v_billing.provider_livemode::text
           or not private.program_billing_provider_scope_matches(p_order_id,v_item->'lines'->0->'providerScope')
           or v_item->'lines'->0->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
           or v_item->'lines'->0->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then return false; end if;
      end if;
      if v_item->>'status' = 'paid' then
        if v_invoice.payment_intent_id is null or v_invoice.invoice_item_id is null
           or not exists (select 1 from public.program_payment_intent_claims claim
             where claim.payment_intent_id = v_invoice.payment_intent_id and claim.order_id = p_order_id
               and claim.installment_number = v_invoice.installment_number)
           or jsonb_array_length(v_item->'lines') is distinct from 1 then return false; end if;
        if (v_item->>'amountPaid')::integer is distinct from v_amount
           or (v_item->>'amountRemaining')::integer is distinct from 0
           then return false; end if;
        select item.value into v_intent from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
        where item.value->>'id' = v_invoice.payment_intent_id;
        v_fee := case when v_order.platform_owned then 0
          else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
        if not found or v_intent->>'id' is distinct from v_invoice.payment_intent_id
           or v_intent->>'customerId' is distinct from v_billing.stripe_customer_id
           or v_intent->>'status' is distinct from 'succeeded'
           or not (v_intent ? 'applicationFeeAmount') or not (v_intent ? 'transferDestinationId')
           or v_intent->>'livemode' is distinct from v_billing.provider_livemode::text
           or not private.program_billing_provider_scope_matches(p_order_id,v_intent->'providerScope')
           or (v_intent->>'amount')::integer is distinct from v_amount
           or (v_intent->>'amountReceived')::integer is distinct from v_amount
           or v_intent->>'currency' is distinct from 'usd'
           or v_intent->>'applicationFeeAmount' is distinct from nullif(v_fee,0)::text
           or v_intent->>'transferDestinationId' is distinct from v_order.connected_account_id then return false; end if;
      elsif v_item->>'status' = 'void' then
        if v_invoice.payment_intent_id is not null then
          select item.value into v_intent from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
          where item.value->>'id' = v_invoice.payment_intent_id;
          v_amount := v_order.installment_amounts_cents[v_invoice.installment_number];
          v_fee := case when v_order.platform_owned then 0
            else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;
          if not found or v_intent->>'id' is distinct from v_invoice.payment_intent_id
             or v_intent->>'customerId' is distinct from v_billing.stripe_customer_id
             or v_intent->>'status' is distinct from 'canceled'
             or not (v_intent ? 'applicationFeeAmount') or not (v_intent ? 'transferDestinationId')
             or v_intent->>'livemode' is distinct from v_billing.provider_livemode::text
             or not private.program_billing_provider_scope_matches(p_order_id,v_intent->'providerScope')
             or (v_intent->>'amount')::integer is distinct from v_amount
             or (v_intent->>'amountReceived')::integer is distinct from 0
             or v_intent->>'currency' is distinct from 'usd'
             or v_intent->>'applicationFeeAmount' is distinct from nullif(v_fee,0)::text
             or v_intent->>'transferDestinationId' is distinct from v_order.connected_account_id then return false; end if;
        end if;
      else
        return false;
      end if;
    end if;
    if v_invoice.payment_intent_id is not null and not exists (
      select 1 from jsonb_array_elements(p_inventory->'paymentIntents') item(value)
      where item.value->>'id' = v_invoice.payment_intent_id
    ) then return false; end if;
  end loop;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return false;
end;
$$;
revoke all on function private.program_billing_cancel_inventory_is_complete(uuid,jsonb)
from public, anon, authenticated, service_role;

create function private.prepare_program_order_closing_receipt(
  p_order_id uuid,p_expected_gate_revision bigint,p_target_state text,
  p_request_billing_revision bigint,p_guard_billing_revision bigint,
  p_transition_applied boolean,p_provider_inventory jsonb,p_evidence_digest text
)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_terminal_billing_revision bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program order closing receipts are server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_gate_revision is null
     or p_request_billing_revision is null or p_guard_billing_revision is null
     or p_transition_applied is null or p_target_state is null
     or p_target_state not in ('canceled','closed')
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_provider_inventory is null then
    raise exception 'Program order closing receipt request is invalid' using errcode = '22023';
  end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  if not found then raise exception 'Program closing order is missing' using errcode = '55000'; end if;
  select state.* into v_gate_state from public.program_order_state state
  where state.order_id = p_order_id for update;
  if not found or v_gate_state.revision <> p_expected_gate_revision
     or (p_transition_applied and v_gate_state.billing_state <> 'cancel_requested')
     or (not p_transition_applied and v_gate_state.billing_state <> p_target_state) then
    raise exception 'Program closing Gate 1 revision is stale' using errcode = '40001';
  end if;
  select billing.* into v_billing from public.program_billing_orders billing
  where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_guard_billing_revision
     or v_billing.billing_state <> 'deletion_pending'
     or v_billing.cancellation_reason <> 'account_deletion'
     or v_billing.cancellation_request_id is null
     or v_billing.account_tombstone_id is null then
    raise exception 'Program closing billing identity is stale' using errcode = '40001';
  end if;
  select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
  where tombstone.id = v_billing.account_tombstone_id
    and tombstone.account_id = v_order.buyer_id
    and tombstone.tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')
  for share;
  if not found or not exists (select 1 from public.platform_membership_deletion_locks fence
    where fence.member_id = v_order.buyer_id) then
    raise exception 'Program closing tombstone or account fence is missing' using errcode = '55000';
  end if;
  if not private.program_billing_cancel_inventory_is_complete(p_order_id,p_provider_inventory)
     or exists (select 1 from public.program_billing_operations operation
       where operation.order_id = p_order_id and operation.operation_state in ('unknown','intent')) then
    raise exception 'Program closing receipt requires complete resolved provider inventory' using errcode = '55000';
  end if;
  if p_transition_applied and p_target_state = 'closed' then
    if v_gate_state.checkout_session_id is null
       or not exists (select 1 from public.program_promotion_reservations reservation
         where reservation.order_id = p_order_id and reservation.state = 'reserved'
           and reservation.checkout_session_id = v_gate_state.checkout_session_id
           and reservation.promotion_id = v_order.promotion_id
           and reservation.program_id = v_order.program_id
           and reservation.offer_version_id = v_order.offer_version_id
           and reservation.member_id = v_order.buyer_id)
       or exists (select 1 from public.program_promotion_redemptions redemption
         where redemption.order_id = p_order_id)
       or exists (select 1 from public.program_order_installments installment
         where installment.order_id = p_order_id and installment.net_settled_cents > 0) then
      raise exception 'Program closing receipt does not match the reserved Gate 1 Session' using errcode = '55000';
    end if;
    if p_guard_billing_revision <> p_request_billing_revision then
      raise exception 'Program closing Session receipt billing revision is stale' using errcode = '40001';
    end if;
    v_terminal_billing_revision := p_request_billing_revision + 1;
  elsif p_transition_applied and p_target_state = 'canceled' then
    if v_gate_state.billing_state <> 'cancel_requested'
       or p_guard_billing_revision <> p_request_billing_revision + 1
       or exists (select 1 from public.program_promotion_reservations reservation
         where reservation.order_id = p_order_id and reservation.state = 'reserved') then
      raise exception 'Program canceled receipt billing revision or promotion state is stale' using errcode = '55000';
    end if;
    v_terminal_billing_revision := p_guard_billing_revision;
  else
    if p_guard_billing_revision <> p_request_billing_revision + 1
       or v_gate_state.billing_state not in ('canceled','closed')
       or exists (select 1 from public.program_promotion_reservations reservation
      where reservation.order_id = p_order_id and reservation.state = 'reserved') then
      raise exception 'Program terminal replay receipt has stale billing or promotion state' using errcode = '55000';
    end if;
    v_terminal_billing_revision := v_billing.revision;
  end if;
  insert into private.program_order_closing_receipts (
    order_id,source_revision,target_revision,transition_applied,target_state,buyer_id,cancellation_request_id,
    tombstone_id,tombstone_request_id,tombstone_revision,tombstone_state,
    checkout_session_id,access_started_on,request_billing_revision,billing_revision,terminal_billing_revision,billing_state,
    inventory_digest,evidence_digest
  ) values (
    p_order_id,v_gate_state.revision,
    case when p_transition_applied then v_gate_state.revision + 1 else v_gate_state.revision end,
    p_transition_applied,p_target_state,v_order.buyer_id,
    v_billing.cancellation_request_id,v_tombstone.id,v_tombstone.request_id,v_tombstone.revision,v_tombstone.tombstone_state,
    v_gate_state.checkout_session_id,v_gate_state.access_started_on,p_request_billing_revision,
    v_billing.revision,v_terminal_billing_revision,v_billing.billing_state,
    private.stream_media_identity_digest(p_provider_inventory::text),p_evidence_digest
  );
end;
$$;
revoke all on function private.prepare_program_order_closing_receipt(uuid,bigint,text,bigint,bigint,boolean,jsonb,text)
  from public, anon, authenticated, service_role;

create function private.reconcile_program_order_retention_closing(target_order_id uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_order public.program_orders%rowtype;
  v_version public.program_content_versions%rowtype;
  v_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_receipt private.program_order_closing_receipts%rowtype;
  v_coach_id uuid;
  v_locked_coach_id uuid;
  v_is_paid boolean := false;
  v_is_zero boolean := false;
  v_checkout_expected boolean := false;
  v_terminal boolean := false;
  v_lesson_count integer := 0;
  v_source_identity text;
  v_item record;
  v_obligation public.stream_media_retention_obligations%rowtype;
  v_event public.stream_media_retention_events%rowtype;
  v_has_paid boolean;
  v_has_zero boolean;
  v_has_checkout boolean;
  v_release_basis text;
  v_release_hash text;
  v_release_request_id uuid;
  v_release_digest text;
begin
  if target_order_id is null or auth.role() is distinct from 'service_role' then
    raise exception 'Program closing retention reconciliation is server managed' using errcode = '42501';
  end if;
  select orders.* into v_order from public.program_orders orders where orders.id = target_order_id;
  if not found then
    raise exception 'Program closing retention order is missing' using errcode = '55000';
  end if;
  select program.coach_id into v_coach_id from public.programs program where program.id = v_order.program_id;
  if not found then
    raise exception 'Program closing retention owner is missing' using errcode = '55000';
  end if;

  perform private.stream_try_lock_accounts(array[v_order.buyer_id,v_coach_id]);
  perform private.try_lock_program_media_versions(v_order.program_id,array[v_order.content_version_id]);
  select program.coach_id into v_locked_coach_id from public.programs program
  where program.id = v_order.program_id for share;
  if not found or v_locked_coach_id is distinct from v_coach_id then
    raise exception 'Program closing retention owner changed while locks were acquired' using errcode = '40001';
  end if;

  select state.* into v_state from public.program_order_state state
  where state.order_id = target_order_id for update;
  if not found or v_state.billing_state not in ('cancel_requested','canceled','closed') then
    raise exception 'Program closing retention state is not an authorized cancellation state' using errcode = '55000';
  end if;
  select billing.* into v_billing from public.program_billing_orders billing
  where billing.order_id = target_order_id for update;
  if not found or v_billing.cancellation_reason <> 'account_deletion'
     or v_billing.billing_state <> 'deletion_pending'
     or v_billing.cancellation_request_id is null
     or v_billing.account_tombstone_id is null then
    raise exception 'Program closing retention billing identity is not deletion fenced' using errcode = '55000';
  end if;
  select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
  where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_order.buyer_id
    and tombstone.tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')
    and exists (select 1 from public.platform_membership_deletion_locks fence
      where fence.member_id = v_order.buyer_id)
  for share;
  if not found then
    raise exception 'Program closing retention tombstone or account fence is missing' using errcode = '55000';
  end if;

  v_terminal := v_state.billing_state in ('canceled','closed');
  if v_terminal then
    select receipt.* into v_receipt from private.program_order_closing_receipts receipt
    where receipt.order_id = target_order_id
      and receipt.source_revision = v_state.revision - 1
      and receipt.target_revision = v_state.revision
      and receipt.transition_applied
      and receipt.target_state = v_state.billing_state
      and receipt.buyer_id = v_order.buyer_id
      and receipt.cancellation_request_id = v_billing.cancellation_request_id
      and receipt.tombstone_id = v_tombstone.id
      and receipt.tombstone_request_id = v_tombstone.request_id
      and receipt.tombstone_revision = v_tombstone.revision
      and receipt.tombstone_state = v_tombstone.tombstone_state
      and receipt.checkout_session_id is not distinct from v_state.checkout_session_id
      and receipt.access_started_on is not distinct from v_state.access_started_on
      and receipt.billing_revision = v_billing.revision
      and receipt.terminal_billing_revision = receipt.request_billing_revision + 1
      and ((receipt.target_state = 'closed' and receipt.billing_revision = receipt.request_billing_revision)
        or (receipt.target_state = 'canceled' and receipt.billing_revision = receipt.request_billing_revision + 1))
      and receipt.billing_state = v_billing.billing_state
      and receipt.inventory_digest ~ '^[0-9a-f]{64}$'
      and receipt.evidence_digest ~ '^[0-9a-f]{64}$'
    for share;
    if not found then
      raise exception 'Program closing retention requires the exact immutable terminal receipt' using errcode = '55000';
    end if;
    if v_billing.financial_conflict or v_billing.billing_state = 'financial_conflict'
       or exists (select 1 from public.program_billing_financial_conflicts conflict
         where conflict.order_id = target_order_id)
       or exists (select 1 from public.program_billing_operations operation
         where operation.order_id = target_order_id and operation.operation_state in ('intent','unknown')) then
      raise exception 'Program closing retention has unresolved billing evidence' using errcode = '55000';
    end if;
  end if;

  select v_state.billing_state = 'paid'
      or exists (select 1 from public.program_payment_events payment
        where payment.order_id = target_order_id and payment.provider_status = 'succeeded' and payment.amount_cents > 0)
      or exists (select 1 from public.program_order_installments installment
        where installment.order_id = target_order_id and installment.net_settled_cents > 0)
      or exists (select 1 from public.program_payment_intent_claims claim
        where claim.order_id = target_order_id)
    into v_is_paid;
  v_is_zero := v_order.effective_total_cents = 0;
  v_checkout_expected := not v_is_paid and not v_is_zero
    and (v_state.billing_state in ('awaiting_checkout','checkout_pending','active','cancel_requested') or v_terminal);

  if v_terminal and v_checkout_expected then
    if exists (select 1 from public.program_billing_checkout_attempts attempt
        where attempt.order_id = target_order_id and attempt.attempt_state not in ('expired_unpaid','canceled'))
       or exists (select 1 from public.program_billing_installment_invoices invoice_state
        where invoice_state.order_id = target_order_id and invoice_state.provider_status not in ('void','deleted'))
       or exists (select 1 from public.program_promotion_reservations reservation
        where reservation.order_id = target_order_id and reservation.state = 'reserved')
       or exists (select 1 from public.program_promotion_redemptions redemption
        where redemption.order_id = target_order_id)
       or exists (select 1 from public.program_billing_provider_observations observation
        where observation.order_id = target_order_id and observation.manual_review_required) then
      raise exception 'Program closing receipt does not prove an unpaid checkout release' using errcode = '55000';
    end if;
  end if;

  select version.* into v_version from public.program_content_versions version
  where version.program_id = v_order.program_id and version.id = v_order.content_version_id
  for share;
  if not found or v_version.lesson_count < 1
     or v_version.lesson_count is distinct from v_order.lesson_count then
    raise exception 'Program closing retention immutable lesson version is missing or inconsistent' using errcode = '55000';
  end if;

  for v_item in
    select lesson.id as lesson_id, lesson.video_id, lesson.cloudflare_uid as raw_uid,
      coalesce(binding.registry_id,video.stream_provider_account_registry_id) as registry_id,
      version.revision_number::bigint as source_revision, program.coach_id as coach_id,
      exists (select 1 from public.stream_media_source_bindings media_binding
        where media_binding.source_kind = 'program_lesson'
          and media_binding.source_identity = lesson.id::text
          and media_binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication',
            'active','retained','quarantined')) as has_media_binding
    from public.program_content_version_lessons lesson
    join public.program_content_versions version
      on version.program_id = lesson.program_id and version.id = lesson.content_version_id
    join public.programs program on program.id = lesson.program_id
    left join public.videos video on video.id = lesson.video_id
    left join public.stream_media_source_bindings binding
      on binding.source_kind = 'program_lesson' and binding.source_identity = lesson.id::text
        and binding.raw_provider_uid = lesson.cloudflare_uid
        and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
    where lesson.program_id = v_order.program_id and lesson.content_version_id = v_order.content_version_id
    order by coalesce(binding.registry_id,video.stream_provider_account_registry_id)::text,lesson.cloudflare_uid,lesson.id
    for share of lesson,version
  loop
    v_lesson_count := v_lesson_count + 1;
    if v_item.video_id is null and v_item.raw_uid is null and not v_item.has_media_binding then
      continue;
    end if;
    if v_item.raw_uid is null or v_item.registry_id is null then
      raise exception 'Program media lesson is missing its immutable provider identity; manual review is required' using errcode = '55000';
    end if;
    v_source_identity := target_order_id::text || ':' || v_item.lesson_id::text;

    select obligation.* into v_obligation from public.stream_media_retention_obligations obligation
    where obligation.registry_id is not distinct from v_item.registry_id
      and obligation.raw_provider_uid = v_item.raw_uid
      and obligation.source_kind = 'program_order'
      and obligation.source_identity = v_source_identity
      and obligation.source_revision = v_item.source_revision
      and obligation.obligation_kind = 'paid_order'
    for update;
    v_has_paid := found;
    if v_is_paid or v_has_paid then
      if not v_has_paid or v_obligation.obligation_state <> 'active' then
        raise exception 'Program paid media retention is missing or released; manual review is required' using errcode = '55000';
      end if;
    end if;

    select obligation.* into v_obligation from public.stream_media_retention_obligations obligation
    where obligation.registry_id is not distinct from v_item.registry_id
      and obligation.raw_provider_uid = v_item.raw_uid
      and obligation.source_kind = 'program_order'
      and obligation.source_identity = v_source_identity
      and obligation.source_revision = v_item.source_revision
      and obligation.obligation_kind = 'zero_total_order'
    for update;
    v_has_zero := found;
    if v_is_zero or v_has_zero then
      if not v_has_zero or v_obligation.obligation_state <> 'active' then
        raise exception 'Program zero-total media retention is missing or released; manual review is required' using errcode = '55000';
      end if;
    end if;

    select obligation.* into v_obligation from public.stream_media_retention_obligations obligation
    where obligation.registry_id is not distinct from v_item.registry_id
      and obligation.raw_provider_uid = v_item.raw_uid
      and obligation.source_kind = 'program_order'
      and obligation.source_identity = v_source_identity
      and obligation.source_revision = v_item.source_revision
      and obligation.obligation_kind = 'checkout_intent'
    for update;
    v_has_checkout := found;
    if v_checkout_expected and (not v_has_checkout or v_obligation.obligation_state <> 'active') then
      raise exception 'Program unpaid checkout media retention is missing or released before terminal proof' using errcode = '55000';
    end if;

    if v_terminal and v_checkout_expected then
      if not v_has_checkout then
        raise exception 'Program terminal checkout retention row is missing' using errcode = '55000';
      end if;
      v_release_basis := concat_ws('|','program_billing_closing_checkout_release_v1',
        v_receipt.order_id::text,v_receipt.request_billing_revision::text,v_receipt.source_revision::text,
        v_receipt.target_revision::text,v_receipt.target_state,v_receipt.inventory_digest,v_receipt.evidence_digest,
        v_tombstone.id::text,v_tombstone.request_id::text,v_tombstone.revision::text,
        v_obligation.id::text,v_obligation.registry_id::text,v_obligation.raw_provider_uid,
        v_obligation.source_identity,v_obligation.source_revision::text);
      v_release_hash := pg_catalog.md5(v_release_basis);
      v_release_request_id := (substring(v_release_hash from 1 for 8) || '-' ||
        substring(v_release_hash from 9 for 4) || '-' || substring(v_release_hash from 13 for 4) || '-' ||
        substring(v_release_hash from 17 for 4) || '-' || substring(v_release_hash from 21 for 12))::uuid;
      v_release_digest := private.stream_media_identity_digest(v_release_basis);

      if v_obligation.obligation_state = 'active' then
        perform private.stream_set_retention_obligation(v_item.registry_id,v_item.raw_uid,'program_order',
          v_source_identity,v_item.source_revision,'checkout_intent',false,v_item.coach_id,
          'program_billing_closing_checkout_release',v_release_request_id,v_release_digest);
        select obligation.* into v_obligation from public.stream_media_retention_obligations obligation
        where obligation.registry_id is not distinct from v_item.registry_id
          and obligation.raw_provider_uid = v_item.raw_uid and obligation.source_kind = 'program_order'
          and obligation.source_identity = v_source_identity and obligation.source_revision = v_item.source_revision
          and obligation.obligation_kind = 'checkout_intent'
        for update;
      end if;
      if not found or v_obligation.obligation_state <> 'released' or v_obligation.release_event_id is null then
        raise exception 'Program closing checkout release did not reach its exact terminal state' using errcode = '55000';
      end if;
      select event.* into v_event from public.stream_media_retention_events event
      where event.id = v_obligation.release_event_id and event.obligation_id = v_obligation.id
        and event.event_kind = 'released' and event.actor_id is not distinct from v_item.coach_id
        and event.reason_code = 'program_billing_closing_checkout_release'
        and event.request_id = v_release_request_id and event.evidence_digest = v_release_digest
      for share;
      if not found then
        raise exception 'Program closing checkout release event does not match its receipt identity' using errcode = '55000';
      end if;
    elsif not v_terminal and v_checkout_expected and v_obligation.obligation_state <> 'active' then
      raise exception 'Program cancel-requested checkout retention must remain active' using errcode = '55000';
    end if;
  end loop;

  if v_lesson_count = 0 or v_lesson_count is distinct from v_version.lesson_count
     or v_lesson_count is distinct from v_order.lesson_count then
    raise exception 'Program closing retention immutable lesson identities are missing or inconsistent' using errcode = '55000';
  end if;
end;
$$;
revoke all on function private.reconcile_program_order_retention_closing(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.guard_program_order_media_retention()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id uuid;
  v_program_id uuid;
  v_buyer_id uuid;
  v_coach_id uuid;
  v_version_id uuid;
  v_buyer_tombstoned boolean;
  v_coach_tombstoned boolean;
  v_billing public.program_billing_orders%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_receipt private.program_order_closing_receipts%rowtype;
  v_closing_transition_valid boolean := false;
begin
  if tg_table_name='program_orders' then
    v_order_id:=new.id; v_program_id:=new.program_id; v_buyer_id:=new.buyer_id; v_version_id:=new.content_version_id;
  else
    v_order_id:=case when tg_op='DELETE' then old.order_id else new.order_id end;
    select orders.program_id,orders.buyer_id,orders.content_version_id
      into v_program_id,v_buyer_id,v_version_id from public.program_orders orders where orders.id=v_order_id;
  end if;
  if v_program_id is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  select program.coach_id into v_coach_id from public.programs program where program.id=v_program_id;
  perform private.stream_require_read_committed();
  perform private.stream_try_lock_accounts(array[v_buyer_id,v_coach_id]);
  v_buyer_tombstoned:=private.stream_account_is_tombstoned(v_buyer_id);
  v_coach_tombstoned:=private.stream_account_is_tombstoned(v_coach_id);
  if v_buyer_tombstoned or v_coach_tombstoned then
    if tg_table_name='program_order_state' and tg_op='UPDATE'
       and v_buyer_tombstoned and not v_coach_tombstoned
       and auth.role() is not distinct from 'service_role'
       and new.order_id=old.order_id and new.revision=old.revision + 1
       and new.checkout_session_id is not distinct from old.checkout_session_id
       and new.access_started_on is not distinct from old.access_started_on then
      select billing.* into v_billing from public.program_billing_orders billing
      where billing.order_id=v_order_id for share;
      if found and v_billing.cancellation_reason='account_deletion'
         and v_billing.billing_state='deletion_pending'
         and v_billing.account_tombstone_id is not null
         and v_billing.cancellation_request_id is not null then
        select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
        where tombstone.id=v_billing.account_tombstone_id and tombstone.account_id=v_buyer_id
          and tombstone.tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')
          and exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id=v_buyer_id)
        for share;
        if found and new.billing_state='cancel_requested'
           and old.billing_state in ('awaiting_checkout','checkout_pending','active','paid') then
          v_closing_transition_valid:=true;
        elsif found and old.billing_state='cancel_requested'
           and new.billing_state in ('canceled','closed') then
          select receipt.* into v_receipt from private.program_order_closing_receipts receipt
          where receipt.order_id=v_order_id and receipt.source_revision=old.revision
            and receipt.target_revision=new.revision and receipt.target_state=new.billing_state
            and receipt.buyer_id=v_buyer_id
            and receipt.cancellation_request_id=v_billing.cancellation_request_id
            and receipt.tombstone_id=v_tombstone.id
            and receipt.tombstone_request_id=v_tombstone.request_id
            and receipt.tombstone_revision=v_tombstone.revision
            and receipt.tombstone_state=v_tombstone.tombstone_state
            and receipt.transition_applied
            and receipt.checkout_session_id is not distinct from old.checkout_session_id
            and receipt.access_started_on is not distinct from old.access_started_on
            and receipt.billing_revision=v_billing.revision
            and receipt.terminal_billing_revision=receipt.request_billing_revision + 1
            and ((receipt.target_state='closed' and receipt.billing_revision=receipt.request_billing_revision)
              or (receipt.target_state='canceled' and receipt.billing_revision=receipt.request_billing_revision + 1))
            and receipt.billing_state=v_billing.billing_state
            and receipt.inventory_digest ~ '^[0-9a-f]{64}$'
            and receipt.evidence_digest ~ '^[0-9a-f]{64}$';
          v_closing_transition_valid:=found;
        end if;
      end if;
      if v_closing_transition_valid then
        perform private.try_lock_program_media_versions(v_program_id,array[v_version_id]);
        perform private.reconcile_program_order_retention_closing(v_order_id);
        return new;
      end if;
    end if;
    raise exception 'Program order media identity is closing' using errcode='55000';
  end if;
  perform private.try_lock_program_media_versions(v_program_id,array[v_version_id]);
  perform private.sync_program_order_retention(v_order_id);
  insert into public.stream_media_source_account_edges(binding_id,account_id,relation_kind)
  select binding.id,v_buyer_id,'assigned_member'
  from public.program_content_version_lessons lesson
  join public.stream_media_source_bindings binding
    on binding.source_kind='program_lesson' and binding.source_identity=lesson.id::text
      and binding.raw_provider_uid=lesson.cloudflare_uid
      and binding.binding_state in ('legacy_unverified','provisional_bound','ready_for_publication','active','retained','quarantined')
  where lesson.program_id=v_program_id and lesson.content_version_id=v_version_id
  on conflict do nothing;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_program_order_media_retention() from public,anon,authenticated,service_role;

create function public.prepare_program_billing_draft_invoice_delete(
  p_order_id uuid,p_expected_revision bigint,p_installment_number smallint,
  p_invoice_id text,p_snapshot jsonb,p_snapshot_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_finalize_operation public.program_billing_operations%rowtype;
  v_void_operation public.program_billing_operations%rowtype;
  v_item_operation public.program_billing_operations%rowtype;
  v_proof public.program_billing_invoice_delete_proofs%rowtype;
  v_line jsonb;
  v_item_count integer;
  v_item_op_found boolean := false;
  v_expected_amount integer;
  v_expected_pi_count integer;
  v_expected_invoice_count integer;
  v_operation_digest text;
  v_finalize_digest text;
  v_void_digest text;
  v_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program draft Invoice deletion is server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_revision is null or p_installment_number not between 2 and 12
     or p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9_]+$'
     or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
     or p_snapshot_digest is null or p_snapshot_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid_delete_snapshot');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then
    return jsonb_build_object('status','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.revision <> p_expected_revision then return jsonb_build_object('status','revision_mismatch'); end if;
  if v_billing.cancellation_request_id is null then return jsonb_build_object('status','cancellation_not_requested'); end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    if not exists (select 1 from public.stream_media_account_tombstones tombstone
      join public.platform_membership_deletion_locks fence on fence.member_id = tombstone.account_id
      where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
        and tombstone.tombstone_state <> 'completed') then return jsonb_build_object('status','deletion_fence_mismatch'); end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
      return jsonb_build_object('status','account_fenced');
    end if;
  else
    return jsonb_build_object('status','cancellation_reason_invalid');
  end if;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_invoice.invoice_id is distinct from p_invoice_id or v_invoice.invoice_create_outcome <> 'created'
     or v_invoice.provider_status = 'succeeded' or v_invoice.payment_intent_id is not null
     or v_invoice.finalize_outcome <> 'not_started' or v_invoice.current_pay_attempt <> 0
     or v_invoice.current_pay_outcome <> 'none' or v_invoice.collection_started_at is not null
     or v_invoice.retry_deadline is not null
     or v_invoice.checkout_attempt_number not between 1 and 12 then
    return jsonb_build_object('status','invoice_delete_identity_mismatch');
  end if;
  select operation.* into v_item_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_item_create'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  v_item_op_found := found;
  v_expected_amount := case when v_invoice.invoice_item_id is null then 0
    else v_order.installment_amounts_cents[p_installment_number] end;
  if p_snapshot->>'customerId' is distinct from v_billing.stripe_customer_id
     or p_snapshot->>'pendingInvoiceItemCount' is distinct from '0'
     or jsonb_typeof(p_snapshot->'providerScope') is distinct from 'object'
     or p_snapshot->'providerScope'->>'platformAccountId' is distinct from v_billing.provider_platform_account_id
     or p_snapshot->'providerScope'->>'livemode' is distinct from v_billing.provider_livemode::text
     or p_snapshot->>'invoiceIds' is null or jsonb_typeof(p_snapshot->'invoiceIds') is distinct from 'array'
     or p_snapshot->>'paymentIntents' is null or jsonb_typeof(p_snapshot->'paymentIntents') is distinct from 'array'
     or p_snapshot->>'pendingInvoiceItemIds' is null or p_snapshot->'pendingInvoiceItemIds' is distinct from '[]'::jsonb
     or p_snapshot->>'subscriptionIds' is null or p_snapshot->'subscriptionIds' is distinct from '[]'::jsonb
     or p_snapshot->>'scheduleIds' is null or p_snapshot->'scheduleIds' is distinct from '[]'::jsonb
     or jsonb_typeof(p_snapshot->'lines') is distinct from 'array'
     or jsonb_typeof(p_snapshot->'invoicePayments') is distinct from 'array'
     or jsonb_array_length(p_snapshot->'invoicePayments') <> 0
     or jsonb_typeof(p_snapshot->'customer') is distinct from 'object'
     or p_snapshot->'customer'->>'id' is distinct from v_billing.stripe_customer_id
     or p_snapshot->'customer'->>'deleted' is distinct from 'false'
     or p_snapshot->'customer'->>'balance' is distinct from '0'
     or not (p_snapshot->'customer' ? 'discountId')
     or p_snapshot->'customer'->>'discountId' is not null
     or p_snapshot->'customer'->>'taxExempt' is distinct from 'none'
     or p_snapshot->'customer'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_snapshot->'customer'->'providerScope')
     or p_snapshot->'customer'->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_snapshot->'customer'->'metadata'->>'program_billing_purpose' is distinct from 'program_order'
     or p_snapshot->'customer'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_snapshot->'customer'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_customer_credit_balance_is_zero(p_snapshot->'customer'->'invoiceCreditBalance') then
    return jsonb_build_object('status','delete_snapshot_inventory_incomplete');
  end if;
  select count(*)::integer into v_expected_invoice_count from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null;
  if jsonb_array_length(p_snapshot->'invoiceIds') <> v_expected_invoice_count
     or exists (select 1 from public.program_billing_installment_invoices invoice_state
       where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null
         and not p_snapshot->'invoiceIds' @> to_jsonb(array[invoice_state.invoice_id]))
     or jsonb_array_length(p_snapshot->'invoiceIds') <>
       (select count(distinct item.value) from jsonb_array_elements_text(p_snapshot->'invoiceIds') item(value)) then
    return jsonb_build_object('status','delete_snapshot_invoice_inventory_mismatch');
  end if;
  select count(*)::integer into v_expected_pi_count from (
    select attempt.payment_intent_id as pi_id from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
    union
    select invoice_state.payment_intent_id as pi_id from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.payment_intent_id is not null
  ) known_pi;
  if jsonb_array_length(p_snapshot->'paymentIntents') <> v_expected_pi_count
     or jsonb_array_length(p_snapshot->'paymentIntents') <>
       (select count(distinct item.value->>'id') from jsonb_array_elements(p_snapshot->'paymentIntents') item(value))
     or exists (select 1 from (
       select attempt.payment_intent_id as pi_id from public.program_billing_checkout_attempts attempt
       where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
       union
       select invoice_state.payment_intent_id as pi_id from public.program_billing_installment_invoices invoice_state
       where invoice_state.order_id = p_order_id and invoice_state.payment_intent_id is not null
     ) known_pi where not exists (select 1 from jsonb_array_elements(p_snapshot->'paymentIntents') item(value)
       where item.value->>'id' = known_pi.pi_id))
     or exists (select 1 from jsonb_array_elements(p_snapshot->'paymentIntents') item(value)
       where item.value->>'customerId' is distinct from v_billing.stripe_customer_id
         or item.value->>'livemode' is distinct from v_billing.provider_livemode::text
         or not private.program_billing_provider_scope_matches(p_order_id,item.value->'providerScope')) then
    return jsonb_build_object('status','delete_snapshot_payment_inventory_mismatch');
  end if;
  v_item_count := jsonb_array_length(p_snapshot->'lines');
  if v_item_count > 1 or (v_invoice.invoice_item_id is not null and v_item_count <> 1)
     or (v_invoice.invoice_item_id is null and v_item_count = 1
       and (not v_item_op_found or v_item_operation.operation_state <> 'unknown'))
     or (v_invoice.invoice_item_id is null and v_item_count = 0
       and v_item_op_found and v_item_operation.operation_state = 'succeeded') then
    return jsonb_build_object('status','delete_snapshot_line_mismatch');
  end if;
  if v_item_count = 1 then
    if v_invoice.invoice_item_id is not null then
      select item.value into v_line from jsonb_array_elements(p_snapshot->'lines') item(value)
      where item.value->>'invoiceItemId' = v_invoice.invoice_item_id;
    else
      select item.value into v_line from jsonb_array_elements(p_snapshot->'lines') item(value) limit 1;
    end if;
    if not found or v_line->>'invoiceId' is distinct from p_invoice_id
       or v_line->>'invoiceItemId' is null or v_line->>'invoiceItemId' !~ '^ii_[A-Za-z0-9_]+$'
       or v_line->>'customerId' is distinct from v_billing.stripe_customer_id
       or v_line->>'amount' is distinct from v_order.installment_amounts_cents[p_installment_number]::text
       or v_line->>'currency' is distinct from 'usd'
       or v_line->>'discountable' is distinct from 'false' or v_line->>'proration' is distinct from 'false'
       or v_line->>'subscriptionId' is not null
       or v_line->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,v_line->'providerScope')
       or v_line->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or v_line->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or v_line->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
       or v_line->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment_line' then
      return jsonb_build_object('status','delete_snapshot_line_mismatch');
    end if;
  end if;
  if p_snapshot->>'invoice' is null or jsonb_typeof(p_snapshot->'invoice') is distinct from 'object'
     or p_snapshot->'invoice'->>'id' is distinct from p_invoice_id
     or p_snapshot->'invoice'->>'customerId' is distinct from v_billing.stripe_customer_id
     or p_snapshot->'invoice'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_snapshot->'invoice'->'providerScope')
     or p_snapshot->'invoice'->>'status' is distinct from 'draft'
     or p_snapshot->'invoice'->>'autoAdvance' is distinct from 'false'
     or p_snapshot->'invoice'->>'collectionMethod' is distinct from 'charge_automatically'
     or p_snapshot->'invoice'->>'billingReason' is distinct from 'manual'
     or p_snapshot->'invoice'->>'currency' is distinct from 'usd'
     or p_snapshot->'invoice'->>'subscriptionId' is not null
     or p_snapshot->'invoice'->>'parentType' is not null
     or p_snapshot->'invoice'->>'amountDue' is distinct from v_expected_amount::text
     or p_snapshot->'invoice'->>'amountPaid' is distinct from '0'
     or p_snapshot->'invoice'->>'amountRemaining' is distinct from v_expected_amount::text
     or p_snapshot->'invoice'->>'amountOverpaid' is distinct from '0'
     or p_snapshot->'invoice'->>'amountShipping' is distinct from '0'
     or p_snapshot->'invoice'->>'subtotal' is distinct from v_expected_amount::text
     or p_snapshot->'invoice'->>'total' is distinct from v_expected_amount::text
     or p_snapshot->'invoice'->>'startingBalance' is distinct from '0'
     or p_snapshot->'invoice'->>'automaticTaxEnabled' is distinct from 'false'
     or p_snapshot->'invoice'->>'defaultPaymentMethodId' is distinct from v_billing.saved_payment_method_id
     or p_snapshot->'invoice'->'discounts' is distinct from '[]'::jsonb
     or p_snapshot->'invoice'->'totalDiscountAmounts' is distinct from '[]'::jsonb
     or p_snapshot->'invoice'->'defaultTaxRates' is distinct from '[]'::jsonb
     or p_snapshot->'invoice'->'totalTaxes' is distinct from '[]'::jsonb
     or p_snapshot->'invoice'->'metadata'->>'program_order_id' is distinct from p_order_id::text
     or p_snapshot->'invoice'->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
     or p_snapshot->'invoice'->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
     or p_snapshot->'invoice'->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
     or p_snapshot->'invoice'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
     or p_snapshot->'invoice'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
    return jsonb_build_object('status','delete_snapshot_invoice_mismatch');
  end if;
  v_finalize_digest := private.stream_media_identity_digest(p_order_id::text || '|invoice|' || v_billing.terms_digest || '|'
    || p_installment_number::text || '|' || v_invoice.checkout_attempt_number::text || '|'
    || v_order.installment_amounts_cents[p_installment_number]::text);
  v_finalize_digest := private.stream_media_identity_digest(v_finalize_digest || '|finalize');
  select operation.* into v_finalize_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_finalize'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if not found or v_finalize_operation.request_digest is distinct from v_finalize_digest
     or v_finalize_operation.operation_state <> 'terminal_failure'
     or (v_finalize_operation.provider_object_id is not null and v_finalize_operation.provider_object_id <> p_invoice_id) then
    return jsonb_build_object('status','invoice_finalize_unresolved');
  end if;
  v_void_digest := private.stream_media_identity_digest(p_invoice_id || '|void');
  perform private.ensure_program_billing_operation(p_order_id,'invoice_void',v_invoice.checkout_attempt_number,
    p_installment_number,0::smallint,v_void_digest);
  select operation.* into v_void_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_void'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if not found or v_void_operation.request_digest is distinct from v_void_digest
     or v_void_operation.operation_state in ('unknown','succeeded')
     or (v_void_operation.provider_object_id is not null and v_void_operation.provider_object_id <> p_invoice_id) then
    return jsonb_build_object('status','invoice_void_unresolved');
  end if;
  if v_void_operation.operation_state = 'intent' then
    update public.program_billing_operations operation set operation_state = 'terminal_failure',
      provider_object_id = p_invoice_id,revision = operation.revision + 1,updated_at = now()
    where operation.id = v_void_operation.id;
  end if;
  select proof.* into v_proof from public.program_billing_invoice_delete_proofs proof
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number for update;
  if found then
    if v_proof.invoice_id is distinct from p_invoice_id or v_proof.snapshot_digest is distinct from p_snapshot_digest
       or v_proof.snapshot is distinct from p_snapshot then return jsonb_build_object('status','delete_snapshot_conflict'); end if;
    select operation.* into v_operation from public.program_billing_operations operation where operation.id = v_proof.operation_id;
    return jsonb_build_object('status','already_prepared','idempotency_key',v_operation.idempotency_key,
      'snapshot_digest',v_proof.snapshot_digest,'proof_state',v_proof.proof_state);
  end if;
  v_operation_digest := private.stream_media_identity_digest(p_order_id::text || '|' || p_invoice_id || '|draft-delete|' || p_snapshot_digest);
  v_key := private.ensure_program_billing_operation(p_order_id,'invoice_delete',v_invoice.checkout_attempt_number,
    p_installment_number,0::smallint,v_operation_digest);
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_delete'
    and operation.checkout_attempt_number = v_invoice.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0 for update;
  if v_operation.operation_state not in ('intent','unknown') or v_operation.provider_object_id is not null then
    return jsonb_build_object('status','delete_operation_not_available');
  end if;
  insert into public.program_billing_invoice_delete_proofs (
    order_id,installment_number,checkout_attempt_number,invoice_id,customer_id,
    provider_platform_account_id,provider_livemode,operation_id,snapshot,snapshot_digest
  ) values (p_order_id,p_installment_number,v_invoice.checkout_attempt_number,p_invoice_id,v_billing.stripe_customer_id,
    v_billing.provider_platform_account_id,v_billing.provider_livemode,v_operation.id,p_snapshot,p_snapshot_digest);
  return jsonb_build_object('status','prepared','idempotency_key',v_key,'snapshot_digest',p_snapshot_digest,
    'operation_id',v_operation.id);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value or unique_violation then
  return jsonb_build_object('status','delete_snapshot_invalid');
end;
$$;
revoke all on function public.prepare_program_billing_draft_invoice_delete(uuid,bigint,smallint,text,jsonb,text)
from public, anon, authenticated, service_role;
grant execute on function public.prepare_program_billing_draft_invoice_delete(uuid,bigint,smallint,text,jsonb,text) to service_role;

create function public.get_program_billing_draft_invoice_delete(
  p_order_id uuid,p_installment_number smallint,p_invoice_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_billing public.program_billing_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_proof public.program_billing_invoice_delete_proofs%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program draft Invoice deletion is server managed' using errcode = '42501';
  end if;
  if p_order_id is null or p_installment_number not between 2 and 12
     or p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9_]+$' then
    return jsonb_build_object('status','invalid_delete_identity');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then
    return jsonb_build_object('status','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for share;
  if not found or v_billing.cancellation_request_id is null then
    return jsonb_build_object('status','cancellation_not_requested');
  end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    if not exists (select 1 from public.stream_media_account_tombstones tombstone
      join public.platform_membership_deletion_locks fence on fence.member_id = tombstone.account_id
      where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
        and tombstone.tombstone_state <> 'completed') then
      return jsonb_build_object('status','deletion_fence_mismatch');
    end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
      return jsonb_build_object('status','account_fenced');
    end if;
  else
    return jsonb_build_object('status','cancellation_reason_invalid');
  end if;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for share;
  if not found or v_invoice.invoice_id is distinct from p_invoice_id then
    return jsonb_build_object('status','invoice_identity_mismatch');
  end if;
  select proof.* into v_proof from public.program_billing_invoice_delete_proofs proof
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number
    and proof.invoice_id = p_invoice_id for share;
  if not found then return jsonb_build_object('status','no_delete_proof'); end if;
  if v_proof.checkout_attempt_number <> v_invoice.checkout_attempt_number
     or v_proof.customer_id is distinct from v_billing.stripe_customer_id
     or v_proof.provider_platform_account_id is distinct from v_billing.provider_platform_account_id
     or v_proof.provider_livemode is distinct from v_billing.provider_livemode then
    return jsonb_build_object('status','delete_proof_identity_mismatch');
  end if;
  select operation.* into v_operation from public.program_billing_operations operation
  where operation.id = v_proof.operation_id for share;
  if not found or v_operation.operation_kind <> 'invoice_delete'
     or v_operation.checkout_attempt_number <> v_proof.checkout_attempt_number
     or v_operation.installment_number <> p_installment_number
     or v_operation.payment_attempt_number <> 0
     or v_operation.request_digest is distinct from private.stream_media_identity_digest(
       p_order_id::text || '|' || p_invoice_id || '|draft-delete|' || v_proof.snapshot_digest)
     or v_operation.idempotency_key is distinct from ('program:' || p_order_id::text || ':invoice_delete:a'
       || v_proof.checkout_attempt_number::text || ':i' || p_installment_number::text || ':p0:v1') then
    return jsonb_build_object('status','delete_operation_identity_mismatch');
  end if;
  return jsonb_build_object('status','found','orderId',p_order_id,'installmentNumber',p_installment_number,
    'checkoutAttemptNumber',v_proof.checkout_attempt_number,'invoiceId',v_proof.invoice_id,
    'customerId',v_proof.customer_id,
    'providerScope',jsonb_build_object('platformAccountId',v_proof.provider_platform_account_id,
      'livemode',v_proof.provider_livemode),
    'snapshot',v_proof.snapshot,'snapshotDigest',v_proof.snapshot_digest,'proofState',v_proof.proof_state,
    'operationState',v_operation.operation_state,'idempotencyKey',v_operation.idempotency_key);
end;
$$;
revoke all on function public.get_program_billing_draft_invoice_delete(uuid,smallint,text)
from public, anon, authenticated, service_role;
grant execute on function public.get_program_billing_draft_invoice_delete(uuid,smallint,text) to service_role;

create function public.mark_program_billing_draft_invoice_delete_unknown(
  p_order_id uuid,p_installment_number smallint,p_invoice_id text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_billing public.program_billing_orders%rowtype;
  v_proof public.program_billing_invoice_delete_proofs%rowtype;
  v_operation public.program_billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program draft Invoice deletion is server managed' using errcode = '42501';
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.cancellation_request_id is null then return false; end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    if not exists (select 1 from public.stream_media_account_tombstones tombstone
      join public.platform_membership_deletion_locks fence on fence.member_id = tombstone.account_id
      where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
        and tombstone.tombstone_state <> 'completed') then return false; end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then return false; end if;
  else return false; end if;
  select proof.* into v_proof from public.program_billing_invoice_delete_proofs proof
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number and proof.invoice_id = p_invoice_id for update;
  if not found then return false; end if;
  select operation.* into v_operation from public.program_billing_operations operation where operation.id = v_proof.operation_id for update;
  if v_proof.proof_state = 'unknown' and v_operation.operation_state = 'unknown' then return false; end if;
  if v_proof.proof_state <> 'prepared' or v_operation.operation_state <> 'intent' then return false; end if;
  update public.program_billing_invoice_delete_proofs proof set proof_state = 'unknown',
    revision = proof.revision + 1,updated_at = now()
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number;
  update public.program_billing_operations operation set operation_state = 'unknown',
    revision = operation.revision + 1,updated_at = now() where operation.id = v_operation.id;
  return true;
end;
$$;
revoke all on function public.mark_program_billing_draft_invoice_delete_unknown(uuid,smallint,text)
from public, anon, authenticated, service_role;
grant execute on function public.mark_program_billing_draft_invoice_delete_unknown(uuid,smallint,text) to service_role;

create function public.reconcile_program_billing_draft_invoice_delete(
  p_order_id uuid,p_installment_number smallint,p_invoice_id text,p_idempotency_key text,
  p_snapshot_digest text,p_terminal_evidence jsonb,p_terminal_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_billing public.program_billing_orders%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_proof public.program_billing_invoice_delete_proofs%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_expected_pi_count integer;
  v_expected_invoice_count integer;
  v_status text;
  v_missing boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program draft Invoice deletion is server managed' using errcode = '42501';
  end if;
  if p_terminal_evidence is null or jsonb_typeof(p_terminal_evidence) is distinct from 'object'
     or p_terminal_digest is null or p_terminal_digest !~ '^[0-9a-f]{64}$'
     or p_snapshot_digest is null or p_snapshot_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status','invalid_delete_terminal_proof');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found or not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then
    return jsonb_build_object('status','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found or v_billing.cancellation_request_id is null then return jsonb_build_object('status','cancellation_not_requested'); end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    if not exists (select 1 from public.stream_media_account_tombstones tombstone
      join public.platform_membership_deletion_locks fence on fence.member_id = tombstone.account_id
      where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
        and tombstone.tombstone_state <> 'completed') then return jsonb_build_object('status','deletion_fence_mismatch'); end if;
  elsif v_billing.cancellation_reason = 'buyer' then
    if private.stream_account_is_tombstoned(v_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
      return jsonb_build_object('status','account_fenced'); end if;
  else return jsonb_build_object('status','cancellation_reason_invalid'); end if;
  select proof.* into v_proof from public.program_billing_invoice_delete_proofs proof
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number and proof.invoice_id = p_invoice_id for update;
  if not found or v_proof.proof_state <> 'unknown' or v_proof.customer_id is distinct from v_billing.stripe_customer_id
     or v_proof.provider_platform_account_id is distinct from v_billing.provider_platform_account_id
     or v_proof.provider_livemode is distinct from v_billing.provider_livemode
     or v_proof.snapshot_digest is distinct from p_snapshot_digest then return jsonb_build_object('status','delete_snapshot_identity_mismatch'); end if;
  select operation.* into v_operation from public.program_billing_operations operation where operation.id = v_proof.operation_id for update;
  if not found or v_operation.operation_kind <> 'invoice_delete' or v_operation.operation_state <> 'unknown'
     or v_operation.idempotency_key is distinct from p_idempotency_key
     or v_operation.request_digest is distinct from private.stream_media_identity_digest(
       p_order_id::text || '|' || p_invoice_id || '|draft-delete|' || p_snapshot_digest) then
    return jsonb_build_object('status','delete_operation_identity_mismatch');
  end if;
  select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
  if not found or v_invoice.invoice_id is distinct from p_invoice_id or v_invoice.checkout_attempt_number <> v_proof.checkout_attempt_number
     or v_invoice.payment_intent_id is not null then return jsonb_build_object('status','invoice_delete_row_mismatch'); end if;
  v_status := p_terminal_evidence->>'status';
  if p_terminal_evidence->'providerScope'->>'platformAccountId' is distinct from v_billing.provider_platform_account_id
     or p_terminal_evidence->'providerScope'->>'livemode' is distinct from v_billing.provider_livemode::text then
    return jsonb_build_object('status','provider_scope_mismatch');
  end if;
  if v_status = 'deleted' then
    if p_terminal_evidence->>'invoiceId' is distinct from p_invoice_id
       or p_terminal_evidence->>'object' is distinct from 'invoice'
       or p_terminal_evidence->>'deleted' is distinct from 'true' then
      return jsonb_build_object('status','delete_response_identity_mismatch');
    end if;
  elsif v_status = 'missing' then
    if p_terminal_evidence->>'invoiceId' is distinct from p_invoice_id
       or p_terminal_evidence->>'httpStatus' is distinct from '404'
       or p_terminal_evidence->>'errorCode' is distinct from 'resource_missing'
       or jsonb_typeof(p_terminal_evidence->'inventory') is distinct from 'object'
       or p_terminal_evidence->'inventory'->>'completeInventory' is distinct from 'true'
       or p_terminal_evidence->'inventory'->>'customerId' is distinct from v_billing.stripe_customer_id
       or p_terminal_evidence->'inventory'->>'pendingInvoiceItemCount' is distinct from '0'
       or p_terminal_evidence->'inventory'->'pendingInvoiceItemIds' is distinct from '[]'::jsonb
       or p_terminal_evidence->'inventory'->'subscriptionIds' is distinct from '[]'::jsonb
       or p_terminal_evidence->'inventory'->'scheduleIds' is distinct from '[]'::jsonb
       or jsonb_typeof(p_terminal_evidence->'inventory'->'customer') is distinct from 'object'
       or p_terminal_evidence->'inventory'->'customer'->>'id' is distinct from v_billing.stripe_customer_id
       or p_terminal_evidence->'inventory'->'customer'->>'deleted' is distinct from 'false'
       or p_terminal_evidence->'inventory'->'customer'->>'balance' is distinct from '0'
       or p_terminal_evidence->'inventory'->'customer'->>'livemode' is distinct from v_billing.provider_livemode::text
       or p_terminal_evidence->'inventory'->'customer'->>'discountId' is not null
       or not (p_terminal_evidence->'inventory'->'customer' ? 'discountId')
       or p_terminal_evidence->'inventory'->'customer'->>'taxExempt' is distinct from 'none'
       or not private.program_billing_provider_scope_matches(p_order_id,p_terminal_evidence->'inventory'->'customer'->'providerScope')
       or p_terminal_evidence->'inventory'->'customer'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_terminal_evidence->'inventory'->'customer'->'metadata'->>'program_billing_purpose' is distinct from 'program_order'
       or p_terminal_evidence->'inventory'->'customer'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_terminal_evidence->'inventory'->'customer'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_customer_credit_balance_is_zero(
         p_terminal_evidence->'inventory'->'customer'->'invoiceCreditBalance')
       or jsonb_typeof(p_terminal_evidence->'inventory'->'invoices') is distinct from 'array'
       or jsonb_typeof(p_terminal_evidence->'inventory'->'paymentIntents') is distinct from 'array' then
      return jsonb_build_object('status','delete_absence_proof_incomplete');
    end if;
    if exists (select 1 from jsonb_array_elements(p_terminal_evidence->'inventory'->'invoices') item(value)
      where item.value->>'id' = p_invoice_id) then return jsonb_build_object('status','delete_absence_contradicted'); end if;
    select count(*)::integer into v_expected_invoice_count from public.program_billing_installment_invoices invoice_state
      where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null
        and invoice_state.provider_status <> 'deleted' and invoice_state.invoice_id <> p_invoice_id;
    if jsonb_array_length(p_terminal_evidence->'inventory'->'invoices') <> v_expected_invoice_count
       or jsonb_array_length(p_terminal_evidence->'inventory'->'invoices') <>
         (select count(distinct item.value->>'id') from jsonb_array_elements(p_terminal_evidence->'inventory'->'invoices') item(value))
       or exists (select 1 from public.program_billing_installment_invoices invoice_state
         where invoice_state.order_id = p_order_id and invoice_state.invoice_id is not null
           and invoice_state.provider_status <> 'deleted' and invoice_state.invoice_id <> p_invoice_id
           and not exists (select 1 from jsonb_array_elements(p_terminal_evidence->'inventory'->'invoices') item(value)
             where item.value->>'id' = invoice_state.invoice_id
               and item.value->>'customerId' = v_billing.stripe_customer_id
               and item.value->>'livemode' = v_billing.provider_livemode::text
               and private.program_billing_provider_scope_matches(p_order_id,item.value->'providerScope')
               and item.value->'metadata'->>'program_order_id' = p_order_id::text)) then
      return jsonb_build_object('status','delete_absence_invoice_inventory_mismatch');
    end if;
    select count(*)::integer into v_expected_pi_count from (
      select attempt.payment_intent_id as pi_id from public.program_billing_checkout_attempts attempt
      where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
      union
      select invoice_state.payment_intent_id as pi_id from public.program_billing_installment_invoices invoice_state
      where invoice_state.order_id = p_order_id and invoice_state.payment_intent_id is not null
    ) known_pi;
    if jsonb_array_length(p_terminal_evidence->'inventory'->'paymentIntents') <> v_expected_pi_count
       or jsonb_array_length(p_terminal_evidence->'inventory'->'paymentIntents') <>
         (select count(distinct item.value->>'id') from jsonb_array_elements(p_terminal_evidence->'inventory'->'paymentIntents') item(value))
       or exists (select 1 from (
         select attempt.payment_intent_id as pi_id from public.program_billing_checkout_attempts attempt
         where attempt.order_id = p_order_id and attempt.payment_intent_id is not null
         union
         select invoice_state.payment_intent_id as pi_id from public.program_billing_installment_invoices invoice_state
         where invoice_state.order_id = p_order_id and invoice_state.payment_intent_id is not null
       ) known_pi where not exists (select 1 from jsonb_array_elements(p_terminal_evidence->'inventory'->'paymentIntents') item(value)
         where item.value->>'id' = known_pi.pi_id and item.value->>'customerId' = v_billing.stripe_customer_id
           and item.value->>'livemode' = v_billing.provider_livemode::text
           and private.program_billing_provider_scope_matches(p_order_id,item.value->'providerScope'))) then
      return jsonb_build_object('status','delete_absence_payment_inventory_mismatch');
    end if;
    v_missing := true;
  else
    return jsonb_build_object('status','delete_terminal_status_unrecognized');
  end if;
  update public.program_billing_invoice_delete_proofs proof set proof_state = case when v_missing then 'missing' else 'deleted' end,
    terminal_evidence = p_terminal_evidence,terminal_digest = p_terminal_digest,
    revision = proof.revision + 1,updated_at = now()
  where proof.order_id = p_order_id and proof.installment_number = p_installment_number;
  update public.program_billing_operations operation set operation_state = 'succeeded',provider_object_id = p_invoice_id,
    revision = operation.revision + 1,updated_at = now() where operation.id = v_operation.id;
  update public.program_billing_installment_invoices invoice_state set provider_status = 'deleted',
    invoice_item_id = coalesce(invoice_state.invoice_item_id,v_proof.snapshot->'snapshot'->'lines'->0->>'invoiceItemId'),
    revision = invoice_state.revision + 1,updated_at = now()
  where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
  insert into public.program_billing_provider_observations (
    order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,provider_status,
    evidence_digest,is_current_attempt,observed_after_account_fence,manual_review_required
  ) values (p_order_id,v_proof.checkout_attempt_number,p_installment_number,'invoice',p_invoice_id,'deleted',
    p_terminal_digest,v_proof.checkout_attempt_number = v_billing.current_checkout_attempt,true,false);
  update public.program_billing_operations operation set operation_state = 'terminal_failure',
    revision = operation.revision + 1,updated_at = now()
  where operation.order_id = p_order_id and operation.checkout_attempt_number = v_proof.checkout_attempt_number
    and operation.installment_number = p_installment_number and operation.payment_attempt_number = 0
    and operation.operation_kind in ('invoice_finalize','invoice_void') and operation.operation_state in ('intent','unknown');
  update public.program_billing_orders billing set revision = billing.revision + 1,updated_at = now()
  where billing.order_id = p_order_id;
  return jsonb_build_object('status','deleted_no_access_change','invoice_id',p_invoice_id,
    'proof_kind',case when v_missing then 'qualified_resource_missing' else 'exact_deleted_response' end);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then
  return jsonb_build_object('status','delete_terminal_proof_invalid');
end;
$$;
revoke all on function public.reconcile_program_billing_draft_invoice_delete(uuid,smallint,text,text,text,jsonb,text)
from public, anon, authenticated, service_role;
grant execute on function public.reconcile_program_billing_draft_invoice_delete(uuid,smallint,text,text,text,jsonb,text) to service_role;

create function public.complete_program_billing_cancellation(
  p_order_id uuid,p_expected_revision bigint,p_provider_inventory jsonb,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_first_session text;
  v_gate4_session_count integer;
  v_changed integer;
  v_promo public.program_promotion_reservations%rowtype;
  v_release_ok boolean;
  v_attempts_terminalized boolean := false;
  v_inventory_digest text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program cancellation reconciliation is server managed' using errcode = '42501';
  end if;
  if p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$' or p_provider_inventory is null then
    return jsonb_build_object('status','invalid_cancellation_proof');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','not_found'); end if;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id;
  if not found or v_billing.cancellation_request_id is null then return jsonb_build_object('status','cancellation_not_requested'); end if;
  if v_billing.cancellation_reason = 'account_deletion' then
    if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_buyer_id::text,19031003)) then
      return jsonb_build_object('status','account_busy');
    end if;
  elsif not private.stream_media_account_ingress_allowed(v_buyer_id) then
    return jsonb_build_object('status','account_fenced');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id for share;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  if not found then return jsonb_build_object('status','revision_mismatch'); end if;
  if v_billing.revision <> p_expected_revision then
    v_inventory_digest := private.stream_media_identity_digest(p_provider_inventory::text);
    if v_billing.revision = p_expected_revision + 1
       and v_billing.billing_state = 'deletion_pending'
       and v_billing.cancellation_reason = 'account_deletion'
       and v_gate_state.billing_state in ('canceled','closed')
       and private.program_billing_cancel_inventory_is_complete(p_order_id,p_provider_inventory)
       and not exists (select 1 from public.program_billing_operations operation
         where operation.order_id = p_order_id and operation.operation_state in ('unknown','intent'))
       then
      select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
      where tombstone.id = v_billing.account_tombstone_id and tombstone.account_id = v_buyer_id
        and tombstone.tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown')
      for share;
      if found and exists (select 1 from public.platform_membership_deletion_locks fence
          where fence.member_id = v_buyer_id)
         and exists (select 1 from private.program_order_closing_receipts receipt
           where receipt.order_id = p_order_id and receipt.buyer_id = v_buyer_id
             and receipt.request_billing_revision = p_expected_revision
             and receipt.cancellation_request_id = v_billing.cancellation_request_id
             and receipt.tombstone_id = v_billing.account_tombstone_id
             and receipt.tombstone_request_id = v_tombstone.request_id
             and receipt.tombstone_revision = v_tombstone.revision
             and receipt.tombstone_state = v_tombstone.tombstone_state
             and receipt.source_revision = case when receipt.transition_applied
               then receipt.target_revision - 1 else receipt.target_revision end
             and receipt.target_revision = v_gate_state.revision
             and receipt.target_state = v_gate_state.billing_state
             and receipt.checkout_session_id is not distinct from v_gate_state.checkout_session_id
             and receipt.access_started_on is not distinct from v_gate_state.access_started_on
             and receipt.billing_revision in (receipt.request_billing_revision,receipt.request_billing_revision + 1)
             and receipt.terminal_billing_revision = v_billing.revision
             and receipt.billing_state = v_billing.billing_state
             and receipt.inventory_digest = v_inventory_digest
             and receipt.evidence_digest = p_evidence_digest) then
        return jsonb_build_object('status','canceled','billing_state','deletion_pending');
      end if;
    end if;
    return jsonb_build_object('status','revision_mismatch');
  end if;
  if v_billing.cancellation_reason = 'account_deletion'
     and v_gate_state.billing_state in ('canceled','closed')
     and exists (select 1 from private.program_order_closing_receipts receipt
       where receipt.order_id = p_order_id and receipt.terminal_billing_revision = v_billing.revision) then
    return jsonb_build_object('status','revision_mismatch');
  end if;
  if not private.program_billing_cancel_inventory_is_complete(p_order_id,p_provider_inventory) then
    return jsonb_build_object('status','provider_inventory_incomplete');
  end if;
  update public.program_billing_operations operation set operation_state = 'terminal_failure',
    revision = operation.revision + 1,updated_at = now()
  where operation.order_id = p_order_id and operation.operation_state = 'intent'
    and operation.operation_kind in ('checkout_create','checkout_expire','invoice_create','invoice_item_create','invoice_finalize','invoice_void','invoice_pay','invoice_delete');
  update public.program_billing_operations operation set operation_state =
      case when item.value->>'status' = 'expired' and item.value->>'paymentStatus' = 'unpaid'
        then 'succeeded' else 'terminal_failure' end,
    provider_object_id = attempt.checkout_session_id,revision = operation.revision + 1,updated_at = now()
  from public.program_billing_checkout_attempts attempt,
    jsonb_array_elements(p_provider_inventory->'sessions') item(value)
  where operation.order_id = p_order_id and operation.operation_kind = 'checkout_expire'
    and operation.checkout_attempt_number = attempt.attempt_number and attempt.order_id = p_order_id
    and item.value->>'id' = attempt.checkout_session_id and operation.operation_state = 'unknown';
  update public.program_billing_operations operation set operation_state =
      case when item.value->>'status' = 'void' then 'succeeded' else 'terminal_failure' end,
    provider_object_id = invoice_state.invoice_id,revision = operation.revision + 1,updated_at = now()
  from public.program_billing_installment_invoices invoice_state,
    jsonb_array_elements(p_provider_inventory->'invoices') item(value)
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_void'
    and operation.checkout_attempt_number = invoice_state.checkout_attempt_number
    and operation.installment_number = invoice_state.installment_number and invoice_state.order_id = p_order_id
    and item.value->>'id' = invoice_state.invoice_id and operation.operation_state = 'unknown';
  update public.program_billing_operations operation set operation_state =
      case when item.value->>'status' = 'paid' then 'succeeded' else 'terminal_failure' end,
    provider_object_id = invoice_state.payment_intent_id,revision = operation.revision + 1,updated_at = now()
  from public.program_billing_installment_invoices invoice_state,
    jsonb_array_elements(p_provider_inventory->'invoices') item(value)
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_pay'
    and operation.checkout_attempt_number = invoice_state.checkout_attempt_number
    and operation.installment_number = invoice_state.installment_number and invoice_state.order_id = p_order_id
    and operation.payment_attempt_number = invoice_state.current_pay_attempt
    and item.value->>'id' = invoice_state.invoice_id and operation.operation_state = 'unknown'
    and item.value->>'status' in ('paid','void');
  update public.program_billing_operations operation set operation_state =
      case when operation.operation_kind = 'invoice_item_create'
          and jsonb_array_length(proof.snapshot->'lines') = 1 then 'succeeded' else 'terminal_failure' end,
    provider_object_id = case when operation.operation_kind = 'invoice_item_create'
        and jsonb_array_length(proof.snapshot->'lines') = 1
      then proof.snapshot->'lines'->0->>'invoiceItemId' else invoice_state.invoice_id end,
    revision = operation.revision + 1,updated_at = now()
  from public.program_billing_installment_invoices invoice_state,
    public.program_billing_invoice_delete_proofs proof
  where operation.order_id = p_order_id and operation.operation_kind in ('invoice_item_create','invoice_finalize','invoice_void','invoice_pay')
    and operation.checkout_attempt_number = invoice_state.checkout_attempt_number
    and operation.installment_number = invoice_state.installment_number and invoice_state.order_id = p_order_id
    and proof.order_id = invoice_state.order_id and proof.installment_number = invoice_state.installment_number
    and proof.proof_state in ('deleted','missing') and operation.operation_state = 'unknown';
  update public.program_billing_operations operation set operation_state = 'succeeded',
    provider_object_id = invoice_state.invoice_id,revision = operation.revision + 1,updated_at = now()
  from public.program_billing_installment_invoices invoice_state,
    jsonb_array_elements(p_provider_inventory->'invoices') item(value)
  where operation.order_id = p_order_id and operation.operation_kind = 'invoice_finalize'
    and operation.checkout_attempt_number = invoice_state.checkout_attempt_number
    and operation.installment_number = invoice_state.installment_number and invoice_state.order_id = p_order_id
    and item.value->>'id' = invoice_state.invoice_id and item.value->>'status' in ('open','paid','void')
    and operation.operation_state = 'unknown';
  if exists (select 1 from public.program_billing_operations operation
    where operation.order_id = p_order_id and operation.operation_state in ('unknown','intent')) then
    return jsonb_build_object('status','provider_operation_unresolved');
  end if;

  select orders.checkout_session_id into v_first_session from public.program_order_state orders
  where orders.order_id = p_order_id;
  select reservation.* into v_promo from public.program_promotion_reservations reservation
  where reservation.order_id = p_order_id and reservation.state = 'reserved' for update;
  if found then
    if exists (select 1 from public.program_order_installments installment
      where installment.order_id = p_order_id and installment.net_settled_cents > 0) then
      return jsonb_build_object('status','promotion_redemption_pending');
    end if;
    if v_first_session is not null then
      begin
        if v_billing.cancellation_reason = 'account_deletion'
           and private.stream_account_is_tombstoned(v_buyer_id) then
          perform private.prepare_program_order_closing_receipt(
            p_order_id,v_gate_state.revision,'closed',p_expected_revision,v_billing.revision,true,
            p_provider_inventory,p_evidence_digest
          );
        end if;
        -- The complete inventory above is the proof for these terminal facts. Persist them
        -- immediately before the legacy promotion RPC closes Gate 1 so its guard sees terminal attempts.
        for v_attempt in
          select attempt.* from public.program_billing_checkout_attempts attempt
          where attempt.order_id = p_order_id order by attempt.attempt_number for update
        loop
          if v_attempt.attempt_state <> 'paid' then
            update public.program_billing_checkout_attempts attempt set attempt_state = 'canceled',
              revision = attempt.revision + 1,updated_at = now()
            where attempt.order_id = p_order_id and attempt.attempt_number = v_attempt.attempt_number;
          end if;
        end loop;
        for v_invoice in
          select invoice_state.* from public.program_billing_installment_invoices invoice_state
          where invoice_state.order_id = p_order_id order by invoice_state.installment_number for update
        loop
          if v_invoice.provider_status not in ('succeeded','deleted') then
            update public.program_billing_installment_invoices invoice_state set provider_status = 'void',
              revision = invoice_state.revision + 1,updated_at = now()
            where invoice_state.order_id = p_order_id and invoice_state.installment_number = v_invoice.installment_number;
          end if;
        end loop;
        v_release_ok := public.release_program_promotion_reservation(
          p_order_id,v_gate_state.revision,v_first_session,'expired'
        );
        if not v_release_ok then
          raise exception 'Program promotion reservation could not be released' using errcode = 'PBC01';
        end if;
      exception when sqlstate 'PBC01' then
        return jsonb_build_object('status','promotion_release_conflict');
      end;
      v_attempts_terminalized := true;
      select state.* into v_gate_state from public.program_order_state state
      where state.order_id = p_order_id for update;
    else
      select count(*)::integer into v_gate4_session_count
      from public.program_billing_checkout_attempts attempt
      where attempt.order_id = p_order_id and attempt.checkout_session_id is not null;
      if v_gate4_session_count > 0 then
        if v_promo.promotion_id is distinct from v_order.promotion_id
           or v_promo.program_id is distinct from v_order.program_id
           or v_promo.offer_version_id is distinct from v_order.offer_version_id
           or v_promo.member_id is distinct from v_order.buyer_id
           or v_promo.checkout_session_id is not null
           or exists (select 1 from public.program_promotion_redemptions redemption
             where redemption.order_id = p_order_id)
           or jsonb_array_length(p_provider_inventory->'sessions') <> v_gate4_session_count
           or exists (select 1 from public.program_billing_checkout_attempts attempt
             where attempt.order_id = p_order_id and attempt.checkout_session_id is not null
               and not exists (select 1 from jsonb_array_elements(p_provider_inventory->'sessions') item(value)
                 where item.value->>'id' = attempt.checkout_session_id
                   and item.value->>'status' = 'expired' and item.value->>'paymentStatus' = 'unpaid')) then
          return jsonb_build_object('status','promotion_release_conflict');
        end if;
        update public.program_promotion_reservations reservation set state = 'released',
          revision = reservation.revision + 1,updated_at = now()
        where reservation.order_id = p_order_id and reservation.promotion_id = v_promo.promotion_id
          and reservation.program_id = v_order.program_id and reservation.offer_version_id = v_order.offer_version_id
          and reservation.member_id = v_order.buyer_id and reservation.state = 'reserved'
          and reservation.checkout_session_id is null
          and not exists (select 1 from public.program_promotion_redemptions redemption where redemption.order_id = p_order_id);
        get diagnostics v_changed = row_count;
        if v_changed <> 1 then return jsonb_build_object('status','promotion_release_conflict'); end if;
      else
        if exists (select 1 from public.program_billing_operations operation
          where operation.order_id = p_order_id and operation.operation_kind = 'checkout_create'
            and operation.operation_state in ('unknown','succeeded')) then
          return jsonb_build_object('status','promotion_release_conflict');
        end if;
        update public.program_promotion_reservations reservation set state = 'released',
          revision = reservation.revision + 1,updated_at = now()
        where reservation.order_id = p_order_id and reservation.state = 'reserved'
          and reservation.promotion_id = v_promo.promotion_id and reservation.program_id = v_order.program_id
          and reservation.offer_version_id = v_order.offer_version_id and reservation.member_id = v_order.buyer_id
          and reservation.checkout_session_id is null
          and not exists (select 1 from public.program_promotion_redemptions redemption where redemption.order_id = p_order_id);
        get diagnostics v_changed = row_count;
        if v_changed <> 1 then return jsonb_build_object('status','promotion_release_conflict'); end if;
      end if;
    end if;
  end if;
  if not v_attempts_terminalized then
    for v_attempt in
      select attempt.* from public.program_billing_checkout_attempts attempt
      where attempt.order_id = p_order_id order by attempt.attempt_number for update
    loop
      if v_attempt.attempt_state <> 'paid' then
        update public.program_billing_checkout_attempts attempt set attempt_state = 'canceled',
          revision = attempt.revision + 1,updated_at = now()
        where attempt.order_id = p_order_id and attempt.attempt_number = v_attempt.attempt_number;
      end if;
    end loop;
    for v_invoice in
      select invoice_state.* from public.program_billing_installment_invoices invoice_state
      where invoice_state.order_id = p_order_id order by invoice_state.installment_number for update
    loop
      if v_invoice.provider_status not in ('succeeded','deleted') then
        update public.program_billing_installment_invoices invoice_state set provider_status = 'void',
          revision = invoice_state.revision + 1,updated_at = now()
        where invoice_state.order_id = p_order_id and invoice_state.installment_number = v_invoice.installment_number;
      end if;
    end loop;
  end if;
  update public.program_billing_orders billing set billing_state =
    case when billing.cancellation_reason = 'account_deletion' then 'deletion_pending' else 'canceled' end,
    revision = billing.revision + 1,updated_at = now()
  where billing.order_id = p_order_id;
  if v_gate_state.billing_state not in ('canceled','closed') then
    if v_billing.cancellation_reason = 'account_deletion'
       and private.stream_account_is_tombstoned(v_buyer_id) then
      perform private.prepare_program_order_closing_receipt(
        p_order_id,v_gate_state.revision,'canceled',p_expected_revision,v_billing.revision + 1,true,
        p_provider_inventory,p_evidence_digest
      );
    end if;
    update public.program_order_state state set billing_state = 'canceled',
      revision = state.revision + 1,updated_at = now() where state.order_id = p_order_id;
  elsif v_billing.cancellation_reason = 'account_deletion'
     and private.stream_account_is_tombstoned(v_buyer_id)
     and not exists (select 1 from private.program_order_closing_receipts receipt
       where receipt.order_id = p_order_id and receipt.request_billing_revision = p_expected_revision) then
    perform private.prepare_program_order_closing_receipt(
      p_order_id,v_gate_state.revision,v_gate_state.billing_state,p_expected_revision,
      v_billing.revision + 1,false,p_provider_inventory,p_evidence_digest
    );
  end if;
  return jsonb_build_object('status','canceled','billing_state',
    case when v_billing.cancellation_reason = 'account_deletion' then 'deletion_pending' else 'canceled' end);
end;
$$;
revoke all on function public.complete_program_billing_cancellation(uuid,bigint,jsonb,text) from public, anon, authenticated;
grant execute on function public.complete_program_billing_cancellation(uuid,bigint,jsonb,text) to service_role;
create function public.request_program_billing_account_deletion(p_tombstone_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_account_id uuid;
  v_order record;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_order_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program account-deletion preparation is server managed' using errcode = '42501';
  end if;
  select tombstone.account_id into v_account_id from public.stream_media_account_tombstones tombstone
  where tombstone.id = p_tombstone_id;
  if not found then return jsonb_build_object('status','tombstone_not_found'); end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_account_id::text,19031003)) then
    return jsonb_build_object('status','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_account_id::text,0));
  select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
  where tombstone.id = p_tombstone_id and tombstone.account_id = v_account_id
    and tombstone.tombstone_state <> 'completed' for share;
  if not found then return jsonb_build_object('status','tombstone_stale'); end if;
  if exists (select 1 from public.program_orders orders where orders.seller_profile_id = v_account_id
    and not orders.platform_owned) then
    return jsonb_build_object('status','seller_program_sales_require_support_transfer');
  end if;
  if exists (select 1 from public.program_billing_orders billing
    join public.program_orders orders on orders.id = billing.order_id
    where orders.buyer_id = v_account_id and billing.cancellation_request_id is not null
      and billing.account_tombstone_id is not null
      and billing.account_tombstone_id is distinct from p_tombstone_id) then
    return jsonb_build_object('status','tombstone_identity_mismatch');
  end if;
  if exists (
    select 1 from public.program_orders orders
    join public.program_order_state state on state.order_id = orders.id
    where orders.buyer_id = v_account_id and orders.payment_plan <> 'free'
      and not exists (select 1 from public.program_billing_orders billing where billing.order_id = orders.id)
      and state.checkout_session_id is not null
  ) then
    return jsonb_build_object('status','unregistered_checkout_requires_manual_review');
  end if;
  for v_order in
    select orders.id, orders.payment_plan from public.program_orders orders
    where orders.buyer_id = v_account_id and orders.payment_plan <> 'free'
    order by orders.id
  loop
    select state.* into v_gate_state from public.program_order_state state where state.order_id = v_order.id for update;
    select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = v_order.id for update;
    if not found then continue; end if;
    if v_billing.cancellation_request_id is null then
      update public.program_billing_orders billing set cancellation_request_id = v_tombstone.request_id,
        cancellation_reason = 'account_deletion',account_tombstone_id = p_tombstone_id,
        billing_state = 'deletion_pending',revision = billing.revision + 1,updated_at = now()
      where billing.order_id = v_order.id;
    elsif v_billing.cancellation_reason = 'account_deletion'
      and v_billing.account_tombstone_id = p_tombstone_id then
      if v_billing.billing_state <> 'deletion_pending' then
        update public.program_billing_orders billing set billing_state = 'deletion_pending',
          revision = billing.revision + 1,updated_at = now() where billing.order_id = v_order.id;
      end if;
    elsif v_billing.cancellation_reason = 'buyer' and v_billing.account_tombstone_id is null then
      update public.program_billing_orders billing set cancellation_reason = 'account_deletion',
        account_tombstone_id = p_tombstone_id,
        billing_state = 'deletion_pending',revision = billing.revision + 1,updated_at = now()
      where billing.order_id = v_order.id;
    else
      return jsonb_build_object('status','cancellation_identity_mismatch');
    end if;
    update public.program_billing_operations operation set operation_state = 'terminal_failure',
      revision = operation.revision + 1,updated_at = now()
    where operation.order_id = v_order.id and operation.operation_state = 'intent'
      and not (
        (operation.operation_kind = 'checkout_expire' and exists (
          select 1 from public.program_billing_checkout_attempts attempt
          where attempt.order_id = v_order.id and attempt.attempt_number = operation.checkout_attempt_number
            and attempt.checkout_session_id is not null and attempt.attempt_state <> 'paid'
            and operation.installment_number = 0 and operation.payment_attempt_number = 0
            and operation.request_digest = private.stream_media_identity_digest(attempt.checkout_session_id || '|expire')
        ))
        or (operation.operation_kind = 'invoice_void' and exists (
          select 1 from public.program_billing_installment_invoices invoice_state
          where invoice_state.order_id = v_order.id and invoice_state.checkout_attempt_number = operation.checkout_attempt_number
            and invoice_state.installment_number = operation.installment_number and invoice_state.invoice_id is not null
            and invoice_state.provider_status <> 'succeeded' and operation.payment_attempt_number = 0
            and operation.request_digest = private.stream_media_identity_digest(invoice_state.invoice_id || '|void')
        ))
        or (operation.operation_kind = 'invoice_delete' and exists (
          select 1 from public.program_billing_invoice_delete_proofs proof
          join public.program_billing_installment_invoices invoice_state
            on invoice_state.order_id = proof.order_id and invoice_state.installment_number = proof.installment_number
          where proof.operation_id = operation.id and proof.order_id = v_order.id
            and proof.proof_state = 'prepared' and proof.invoice_id = invoice_state.invoice_id
            and proof.checkout_attempt_number = invoice_state.checkout_attempt_number
            and proof.customer_id = v_billing.stripe_customer_id
            and proof.provider_platform_account_id = v_billing.provider_platform_account_id
            and proof.provider_livemode = v_billing.provider_livemode
            and invoice_state.payment_intent_id is null and operation.provider_object_id is null
            and operation.request_digest = private.stream_media_identity_digest(
              v_order.id::text || '|' || proof.invoice_id || '|draft-delete|' || proof.snapshot_digest)
        ))
      );
    for v_attempt in
      select attempt.* from public.program_billing_checkout_attempts attempt
      where attempt.order_id = v_order.id and attempt.checkout_session_id is not null order by attempt.attempt_number
    loop
      perform private.ensure_program_billing_operation(v_order.id,'checkout_expire',v_attempt.attempt_number,0::smallint,0::smallint,
        private.stream_media_identity_digest(v_attempt.checkout_session_id || '|expire'));
    end loop;
    for v_invoice in
      select invoice_state.* from public.program_billing_installment_invoices invoice_state
      where invoice_state.order_id = v_order.id and invoice_state.invoice_id is not null order by invoice_state.installment_number
    loop
      perform private.ensure_program_billing_operation(v_order.id,'invoice_void',v_invoice.checkout_attempt_number,
        v_invoice.installment_number,0::smallint,private.stream_media_identity_digest(v_invoice.invoice_id || '|void'));
    end loop;
    if v_gate_state.billing_state not in ('cancel_requested','canceled','closed') then
      update public.program_order_state state set billing_state = 'cancel_requested',
        revision = state.revision + 1,updated_at = now() where state.order_id = v_order.id;
    end if;
    v_order_count := v_order_count + 1;
  end loop;
  return jsonb_build_object('status','deletion_billing_fenced','order_count',v_order_count,'tombstone_id',p_tombstone_id);
end;
$$;
revoke all on function public.request_program_billing_account_deletion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.request_program_billing_account_deletion(uuid) to service_role;

create function private.program_billing_terminal_completion_is_verified(
  p_order_id uuid,p_tombstone_id uuid,p_tombstone_revision bigint,p_provider_inventory jsonb
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_order public.program_orders%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_receipt private.program_order_closing_receipts%rowtype;
  v_receipt_count integer;
  v_tombstone_rank integer;
  v_receipt_tombstone_rank integer;
  v_tombstone_progression_verified boolean := false;
begin
  if auth.role() is distinct from 'service_role'
     or p_order_id is null or p_tombstone_id is null or p_tombstone_revision is null
     or not private.program_billing_cancel_inventory_is_complete(p_order_id,p_provider_inventory) then
    return false;
  end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  if not found then return false; end if;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id;
  if not found then return false; end if;
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id;
  if not found then return false; end if;
  select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
  where tombstone.id = p_tombstone_id and tombstone.account_id = v_order.buyer_id
    and tombstone.revision = p_tombstone_revision
    and tombstone.tombstone_state in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown');
  if not found then return false; end if;
  select count(*)::integer into v_receipt_count from private.program_order_closing_receipts receipt
  where receipt.order_id = p_order_id;
  if v_receipt_count <> 1 then return false; end if;
  select receipt.* into v_receipt from private.program_order_closing_receipts receipt
  where receipt.order_id = p_order_id;
  if not found then return false; end if;
  v_tombstone_rank := case v_tombstone.tombstone_state
    when 'closing' then 0 when 'provider_cleanup' then 1 when 'auth_deletion_ready' then 2
    when 'auth_call_started' then 3 when 'auth_result_unknown' then 4 else -1 end;
  v_receipt_tombstone_rank := case v_receipt.tombstone_state
    when 'closing' then 0 when 'provider_cleanup' then 1 when 'auth_deletion_ready' then 2
    when 'auth_call_started' then 3 when 'auth_result_unknown' then 4 else -1 end;
  if v_receipt.tombstone_id = v_tombstone.id
     and v_receipt.tombstone_request_id = v_tombstone.request_id
     and v_receipt.tombstone_revision <= v_tombstone.revision
     and v_tombstone_rank >= v_receipt_tombstone_rank then
    if v_receipt.tombstone_revision = v_tombstone.revision
       and v_receipt.tombstone_state = v_tombstone.tombstone_state then
      -- A receipt at the exact current tombstone fence needs no later lifecycle transition proof.
      v_tombstone_progression_verified := true;
    elsif v_tombstone.source_revision_digest is not null
       and v_tombstone.source_revision_digest ~ '^[0-9a-f]{64}$'
       and exists (select 1 from public.stream_media_account_tombstone_events event
         where event.tombstone_id = v_tombstone.id
           and event.event_kind = v_tombstone.tombstone_state
           and event.source_revision_digest = v_tombstone.source_revision_digest)
       and (select count(*)::integer
         from public.stream_media_operations cleanup
         join public.stream_media_operation_states cleanup_state on cleanup_state.operation_id = cleanup.id
         join public.stream_media_finalization_receipts finalized on finalized.operation_id = cleanup.id
         where cleanup.operation_kind = 'account_cleanup'
           and cleanup.owner_id = v_tombstone.account_id
           and cleanup.source_kind = 'account'
           and cleanup.source_identity = v_tombstone.account_id::text
           and cleanup.request_id = v_tombstone.request_id
           and cleanup_state.operation_state in ('completed','retained')
           and finalized.terminal_state = cleanup_state.operation_state
           and finalized.response->>'outcome' = 'account_cleanup_complete'
           and finalized.response->>'state' = cleanup_state.operation_state
           and finalized.response->>'source_revision_digest' = v_tombstone.source_revision_digest
           and exists (select 1 from public.stream_media_account_tombstone_events finalized_event
             where finalized_event.tombstone_id = v_tombstone.id
               and finalized_event.event_kind = 'provider_cleanup'
               and finalized_event.source_revision_digest = v_tombstone.source_revision_digest
               and finalized_event.request_id = private.stream_media_request_uuid(
                 cleanup.id::text || ':account-provider-cleanup-finalized'))) = 1 then
      v_tombstone_progression_verified := true;
    end if;
  end if;
  if not v_tombstone_progression_verified then return false; end if;
  return coalesce(v_billing.cancellation_reason = 'account_deletion'
    and v_billing.cancellation_request_id is not null
    and v_billing.account_tombstone_id = p_tombstone_id
    and v_billing.billing_state = 'deletion_pending'
    and v_billing.financial_conflict is false
    and v_billing.revision = v_receipt.terminal_billing_revision
    and v_gate_state.billing_state in ('canceled','closed')
    and v_tombstone.account_id = v_order.buyer_id
    and exists (select 1 from public.platform_membership_deletion_locks fence
      where fence.member_id = v_order.buyer_id)
    and not exists (select 1 from public.program_billing_financial_conflicts conflict
      where conflict.order_id = p_order_id)
    and not exists (select 1 from public.program_billing_operations operation
      where operation.order_id = p_order_id and operation.operation_state in ('unknown','intent'))
    and v_receipt.buyer_id = v_order.buyer_id
    and v_receipt.cancellation_request_id = v_billing.cancellation_request_id
    and v_receipt.tombstone_id = v_billing.account_tombstone_id
    and v_receipt.source_revision = case when v_receipt.transition_applied
      then v_receipt.target_revision - 1 else v_receipt.target_revision end
    and v_receipt.target_revision = v_gate_state.revision
    and v_receipt.target_state = v_gate_state.billing_state
    and v_receipt.checkout_session_id is not distinct from v_gate_state.checkout_session_id
    and v_receipt.access_started_on is not distinct from v_gate_state.access_started_on
    and v_receipt.billing_revision in (v_receipt.request_billing_revision,v_receipt.request_billing_revision + 1)
    and v_receipt.terminal_billing_revision = v_billing.revision
    and v_receipt.billing_state = v_billing.billing_state,false);
end;
$$;
revoke all on function private.program_billing_terminal_completion_is_verified(uuid,uuid,bigint,jsonb)
from public, anon, authenticated, service_role;

create function public.record_program_billing_auth_cleanup_proof(
  p_tombstone_id uuid,p_tombstone_revision bigint,p_request_id uuid,p_provider_resource_set jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tombstone public.stream_media_account_tombstones%rowtype;
  v_order record;
  v_billing public.program_billing_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_entry jsonb;
  v_state text := 'ready';
  v_source_payload jsonb;
  v_resource_digest text;
  v_source_digest text;
  v_proof_digest text;
  v_expected_count integer := 0;
  v_seen_count integer := 0;
  v_component_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program account-deletion proof is server managed' using errcode = '42501';
  end if;
  if p_request_id is null or p_provider_resource_set is null
     or jsonb_typeof(p_provider_resource_set->'orders') is distinct from 'array'
     or p_provider_resource_set->>'completeInventory' is distinct from 'true' then
    raise exception 'Program account-deletion proof is incomplete' using errcode = '22023';
  end if;
  select tombstone.* into v_tombstone from public.stream_media_account_tombstones tombstone
  where tombstone.id = p_tombstone_id for share;
  if not found or v_tombstone.revision <> p_tombstone_revision
     or v_tombstone.tombstone_state not in ('closing','provider_cleanup','auth_deletion_ready','auth_call_started','auth_result_unknown') then
    return jsonb_build_object('outcome','tombstone_stale');
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:' || v_tombstone.account_id::text,19031003)) then
    return jsonb_build_object('outcome','account_busy');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tombstone.account_id::text,0));
  if exists (select 1 from public.program_orders orders where orders.seller_profile_id = v_tombstone.account_id
    and not orders.platform_owned) then v_state := 'blocked'; end if;
  select count(*)::integer into v_expected_count from public.program_orders orders
  where orders.buyer_id = v_tombstone.account_id and orders.payment_plan <> 'free';
  if jsonb_array_length(p_provider_resource_set->'orders') is distinct from v_expected_count then v_state := 'incomplete'; end if;
  v_source_payload := jsonb_build_object('account',v_tombstone.account_id,'tombstone',p_tombstone_id,
    'order_count',v_expected_count,'orders',coalesce((
      select jsonb_agg(jsonb_build_object('order_id',orders.id,'state',state.billing_state,
        'gate_revision',state.revision,'billing',to_jsonb(billing),'attempts',(
          select jsonb_agg(to_jsonb(attempt) order by attempt.attempt_number)
          from public.program_billing_checkout_attempts attempt where attempt.order_id = orders.id
        ),'invoices',(
          select jsonb_agg(to_jsonb(invoice_state) order by invoice_state.installment_number)
          from public.program_billing_installment_invoices invoice_state where invoice_state.order_id = orders.id
        ),'operations',(
          select jsonb_agg(to_jsonb(operation) order by operation.operation_kind,operation.checkout_attempt_number,
            operation.installment_number,operation.payment_attempt_number)
          from public.program_billing_operations operation where operation.order_id = orders.id
        ))
      order by orders.id)
      from public.program_orders orders
      join public.program_order_state state on state.order_id = orders.id
      left join public.program_billing_orders billing on billing.order_id = orders.id
      where orders.buyer_id = v_tombstone.account_id and orders.payment_plan <> 'free'
    ),'[]'::jsonb));
  for v_order in
    select orders.id,orders.payment_plan,state.checkout_session_id
    from public.program_orders orders
    join public.program_order_state state on state.order_id = orders.id
    where orders.buyer_id = v_tombstone.account_id and orders.payment_plan <> 'free'
    order by orders.id
  loop
    v_seen_count := v_seen_count + 1;
    select item.value into v_entry from jsonb_array_elements(p_provider_resource_set->'orders') item(value)
    where item.value->>'orderId' = v_order.id::text;
    if not found then v_state := 'incomplete'; continue; end if;
    if jsonb_typeof(v_entry->'sessions') is distinct from 'array'
       or jsonb_typeof(v_entry->'paymentIntents') is distinct from 'array'
       or jsonb_typeof(v_entry->'invoices') is distinct from 'array' then
      v_state := 'incomplete';
      continue;
    end if;
    select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = v_order.id;
    if not found then
      if v_order.checkout_session_id is not null or jsonb_array_length(v_entry->'sessions') <> 0
         or jsonb_array_length(v_entry->'paymentIntents') <> 0 or jsonb_array_length(v_entry->'invoices') <> 0 then
        v_state := 'incomplete';
      end if;
      continue;
    end if;
    if v_billing.cancellation_reason <> 'account_deletion'
       or v_billing.account_tombstone_id <> p_tombstone_id then
      v_state := 'incomplete';
      continue;
    end if;
    if not private.program_billing_cancel_inventory_is_complete(v_order.id,v_entry) then
      v_state := 'incomplete';
      continue;
    end if;
    if not private.program_billing_terminal_completion_is_verified(
      v_order.id,p_tombstone_id,p_tombstone_revision,v_entry
    ) then v_state := 'incomplete'; end if;
  end loop;
  if exists (select 1 from public.program_billing_financial_conflicts conflict
    join public.program_billing_orders billing on billing.order_id = conflict.order_id
    join public.program_orders orders on orders.id = billing.order_id
    where orders.buyer_id = v_tombstone.account_id) then v_state := 'blocked'; end if;
  if exists (select 1 from public.program_billing_operations operation
    join public.program_billing_orders billing on billing.order_id = operation.order_id
    join public.program_orders orders on orders.id = billing.order_id
    where orders.buyer_id = v_tombstone.account_id and operation.operation_state in ('unknown','intent')) then
    v_state := 'incomplete';
  end if;
  v_resource_digest := private.stream_media_identity_digest(p_provider_resource_set::text);
  v_source_digest := private.stream_media_identity_digest(v_source_payload::text);
  v_proof_digest := private.stream_media_identity_digest(v_source_digest || '|' || v_resource_digest || '|' || v_state);
  insert into public.program_billing_auth_cleanup_proofs (
    tombstone_id,request_id,resource_set_digest,proof_digest,proof_state
  ) values (p_tombstone_id,p_request_id,v_resource_digest,v_proof_digest,v_state)
  on conflict (tombstone_id,request_id) do nothing;
  v_component_result := public.record_stream_auth_cleanup_component_proof(
    p_tombstone_id,p_tombstone_revision,'program_billing',1,1,v_state,v_source_digest,v_proof_digest,p_request_id
  );
  return v_component_result || jsonb_build_object('proof_state',v_state,'order_count',v_expected_count);
end;
$$;
revoke all on function public.record_program_billing_auth_cleanup_proof(uuid,bigint,uuid,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.record_program_billing_auth_cleanup_proof(uuid,bigint,uuid,jsonb) to service_role;

create function public.get_my_program_billing_history()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',orders.id,'program_id',orders.program_id,'billing_state',coalesce(billing.billing_state,state.billing_state),
    'payment_plan',orders.payment_plan,'currency',orders.currency,'total_cents',orders.effective_total_cents,
    'installment_count',orders.installment_count,'installment_amounts_cents',orders.installment_amounts_cents,
    'first_settled_at',billing.first_settled_at,'next_anchor_date',billing.next_anchor_date,
    'cancellation_requested',billing.cancellation_request_id is not null,
    'updated_at',coalesce(billing.updated_at,state.updated_at)
  ) order by orders.created_at desc),'[]'::jsonb)
  from public.program_orders orders
  join public.program_order_state state on state.order_id = orders.id
  left join public.program_billing_orders billing on billing.order_id = orders.id
  where auth.role() = 'authenticated' and auth.uid() is not null and orders.buyer_id = auth.uid();
$$;
revoke all on function public.get_my_program_billing_history() from public, anon, service_role;
grant execute on function public.get_my_program_billing_history() to authenticated;

-- Gate 1's legacy service entry accepted unsettled PI claims. Gate 4 exposes only the
-- settled current-object wrapper above; no failed/processing Checkout retry consumes the PI claim.
revoke all on function public.record_program_installment_payment(uuid,smallint,bigint,text,text,text,text,text,integer,integer,text)
from public, anon, authenticated, service_role;
revoke all on function public.record_program_refund_marker(uuid,smallint,bigint,text,text,text,text,integer)
from public, anon, authenticated, service_role;






create function public.record_program_billing_settled_payment(
  p_order_id uuid,p_expected_installment_revision bigint,p_event_id text,
  p_checkout_attempt_number smallint,p_installment_number smallint,
  p_checkout_session_id text,p_invoice_id text,p_payment_intent_id text,p_charge_id text,
  p_amount_cents integer,p_refunded_cents integer,p_currency text,p_settled_at timestamptz,
  p_saved_payment_method_id text,p_provider_evidence jsonb,p_evidence_digest text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid;
  v_order public.program_orders%rowtype;
  v_gate_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_installment public.program_order_installments%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_invoice public.program_billing_installment_invoices%rowtype;
  v_operation public.program_billing_operations%rowtype;
  v_prior public.program_billing_provider_observations%rowtype;
  v_amount integer;
  v_fee integer;
  v_is_current boolean := false;
  v_core_ok boolean;
  v_anchor_date date;
  v_anchor_day integer;
  v_is_eom boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program settled payment reconciliation is server managed' using errcode = '42501';
  end if;
  if p_event_id is null or p_event_id !~ '^evt_[A-Za-z0-9_]+$'
     or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[A-Za-z0-9_]+$'
     or p_charge_id is null or p_charge_id !~ '^ch_[A-Za-z0-9_]+$'
     or p_evidence_digest is null or p_evidence_digest !~ '^[0-9a-f]{64}$'
     or p_amount_cents is null or p_refunded_cents is null or p_amount_cents <= 0
     or p_refunded_cents < 0 or p_refunded_cents > p_amount_cents
     or p_currency is distinct from 'usd' or p_settled_at is null
     or p_settled_at > now() + interval '5 minutes' or p_provider_evidence is null then
    return jsonb_build_object('status','invalid_settlement_proof');
  end if;
  select event.* into v_prior from public.program_billing_provider_observations event
  where event.provider_event_id = p_event_id;
  if found then
    if v_prior.provider_object_id = p_payment_intent_id and v_prior.evidence_digest = p_evidence_digest then
      return jsonb_build_object('status','already_recorded');
    end if;
    return jsonb_build_object('status','event_identity_mismatch');
  end if;
  select orders.buyer_id into v_buyer_id from public.program_orders orders where orders.id = p_order_id;
  if not found then return jsonb_build_object('status','order_not_found'); end if;
  select orders.* into v_order from public.program_orders orders where orders.id = p_order_id;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id;
  if not found then return jsonb_build_object('status','billing_state_missing'); end if;
  v_amount := case when p_installment_number between 1 and v_order.installment_count
    then v_order.installment_amounts_cents[p_installment_number] else null end;
  v_fee := case when v_order.platform_owned then 0 else round(v_amount * v_order.application_fee_basis_points / 10000.0)::integer end;

  -- The deletion fence is checked before buyer locks. Preserve the actual event proof,
  -- but never call the canonical ledger or create access after permanent account closure.
  if private.stream_account_is_tombstoned(v_buyer_id)
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id) then
    insert into public.program_billing_provider_observations (
      provider_event_id,order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,observed_after_account_fence,manual_review_required
    ) values (p_event_id,p_order_id,p_checkout_attempt_number,p_installment_number,'payment_intent',p_payment_intent_id,
      'succeeded',p_evidence_digest,false,true,true);
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,'payment_after_account_fence',p_payment_intent_id,p_evidence_digest);
    return jsonb_build_object('status','manual_review_after_account_fence');
  end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id) then return jsonb_build_object('status','account_busy'); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_buyer_id::text,0));
  select state.* into v_gate_state from public.program_order_state state where state.order_id = p_order_id for update;
  select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = p_order_id for update;
  select installment.* into v_installment from public.program_order_installments installment
  where installment.order_id = p_order_id and installment.installment_number = p_installment_number for update;
  if not found or v_installment.revision <> p_expected_installment_revision then
    return jsonb_build_object('status','installment_revision_conflict');
  end if;
  if p_installment_number = 1 then
    select attempt.* into v_attempt from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number for update;
    v_is_current := found and p_checkout_attempt_number = v_billing.current_checkout_attempt
      and (v_attempt.checkout_session_id is null or v_attempt.checkout_session_id = p_checkout_session_id)
      and (v_attempt.payment_intent_id is null or v_attempt.payment_intent_id = p_payment_intent_id)
      and v_attempt.attempt_state not in ('expired_unpaid','canceled','financial_conflict');
  elsif p_installment_number > 1 then
    select invoice_state.* into v_invoice from public.program_billing_installment_invoices invoice_state
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number for update;
    v_is_current := found and v_invoice.checkout_attempt_number = p_checkout_attempt_number
      and v_billing.current_checkout_attempt = p_checkout_attempt_number
      and v_invoice.invoice_id = p_invoice_id and v_invoice.payment_intent_id = p_payment_intent_id
      and v_invoice.provider_status not in ('void','uncollectible','canceled');
  end if;
  if not v_is_current or p_installment_number < 1 or p_installment_number > v_order.installment_count
     or p_amount_cents <> v_amount or p_refunded_cents <> 0
     or p_provider_evidence->'payment_intent'->>'id' is distinct from p_payment_intent_id
     or p_provider_evidence->'payment_intent'->>'customer_id' is distinct from v_billing.stripe_customer_id
     or p_provider_evidence->'payment_intent'->>'status' is distinct from 'succeeded'
     or (p_provider_evidence->'payment_intent'->>'amount')::integer is distinct from v_amount
     or (p_provider_evidence->'payment_intent'->>'amount_received')::integer is distinct from v_amount
     or p_provider_evidence->'payment_intent'->>'currency' is distinct from 'usd'
     or p_provider_evidence->'payment_intent'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'payment_intent'->'providerScope')
     or (p_provider_evidence->'payment_intent'->>'application_fee_amount')::integer is distinct from nullif(v_fee,0)
     or p_provider_evidence->'payment_intent'->>'transfer_destination_id' is distinct from v_order.connected_account_id
     or p_provider_evidence->'payment_intent'->>'payment_method_id' is distinct from p_saved_payment_method_id
     or p_provider_evidence->'payment_intent'->>'latest_charge_id' is distinct from p_charge_id
     then
    insert into public.program_billing_provider_observations (
      provider_event_id,order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,manual_review_required
    ) values (p_event_id,p_order_id,p_checkout_attempt_number,p_installment_number,'payment_intent',p_payment_intent_id,
      'succeeded',p_evidence_digest,false,true);
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,
      case when not v_is_current then 'late_payment_after_terminal_retry' else 'provider_identity_mismatch' end,
      p_payment_intent_id,p_evidence_digest);
    update public.program_billing_orders billing set financial_conflict = true,
      billing_state = 'financial_conflict',revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id and not billing.financial_conflict;
    return jsonb_build_object('status','payment_conflict_manual_review');
  end if;
  if p_installment_number = 1 then
    if p_checkout_session_id is null or p_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
       or p_provider_evidence->'checkout_session'->>'id' is distinct from p_checkout_session_id
       or p_provider_evidence->'checkout_session'->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_provider_evidence->'checkout_session'->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'checkout_session'->'providerScope')
       or p_provider_evidence->'checkout_session'->>'client_reference_id' is distinct from v_attempt.attempt_id::text
       or p_provider_evidence->'checkout_session'->>'mode' is distinct from 'payment'
       or p_provider_evidence->'checkout_session'->>'status' is distinct from 'complete'
       or p_provider_evidence->'checkout_session'->>'payment_status' is distinct from 'paid'
       or (p_provider_evidence->'checkout_session'->>'amount_total')::integer is distinct from v_amount
       or p_provider_evidence->'checkout_session'->>'currency' is distinct from 'usd'
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_checkout_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_installment_number' is distinct from '1'
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_provider_evidence->'checkout_session'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_billing_kind' is distinct from 'program_sale'
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_checkout_attempt_id' is distinct from v_attempt.attempt_id::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_checkout_attempt_number' is distinct from p_checkout_attempt_number::text
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_installment_number' is distinct from '1'
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_provider_evidence->'payment_intent'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
      return jsonb_build_object('status','checkout_proof_mismatch');
    end if;
    if v_attempt.checkout_session_id is null then
      if p_checkout_attempt_number = 1 and v_gate_state.checkout_session_id is null
         and not public.bind_program_checkout_session(p_order_id,v_gate_state.revision,p_checkout_session_id) then
        return jsonb_build_object('status','checkout_session_bind_failed');
      elsif p_checkout_attempt_number = 1 and v_gate_state.checkout_session_id is not null
         and v_gate_state.checkout_session_id <> p_checkout_session_id then
        return jsonb_build_object('status','checkout_session_identity_mismatch');
      end if;
      update public.program_billing_checkout_attempts attempt set checkout_session_id = p_checkout_session_id,
        payment_intent_id = p_payment_intent_id,attempt_state = 'paid',provider_status = 'complete',
        create_outcome = 'created',revision = attempt.revision + 1,updated_at = now()
      where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number;
    end if;
  else
    if p_invoice_id is null or p_invoice_id !~ '^in_[A-Za-z0-9_]+$'
       or p_provider_evidence->'invoice'->>'id' is distinct from p_invoice_id
       or p_provider_evidence->'invoice'->>'customer_id' is distinct from v_billing.stripe_customer_id
       or p_provider_evidence->'invoice'->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'invoice'->'providerScope')
       or p_provider_evidence->'invoice'->>'status' is distinct from 'paid'
       or p_provider_evidence->'invoice'->>'auto_advance' is distinct from 'false'
       or p_provider_evidence->'invoice'->>'currency' is distinct from 'usd'
       or (p_provider_evidence->'invoice'->>'total')::integer is distinct from v_amount
       or (p_provider_evidence->'invoice'->>'amount_paid')::integer is distinct from v_amount
       or (p_provider_evidence->'invoice'->>'amount_remaining')::integer <> 0
       or (p_provider_evidence->'invoice'->>'amount_overpaid')::integer <> 0
       or (p_provider_evidence->'invoice'->>'amount_shipping')::integer <> 0
       or (p_provider_evidence->'invoice'->>'starting_balance')::integer <> 0
       or (p_provider_evidence->'invoice'->>'ending_balance' is not null and (p_provider_evidence->'invoice'->>'ending_balance')::integer <> 0)
       or (p_provider_evidence->'invoice'->>'subtotal')::integer is distinct from v_amount
       or p_provider_evidence->'invoice'->>'automatic_tax_enabled' is distinct from 'false'
       or p_provider_evidence->'invoice'->'discounts' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice'->'total_discount_amounts' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice'->'default_tax_rates' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice'->'total_taxes' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice'->>'billing_reason' is distinct from 'manual'
       or p_provider_evidence->'invoice'->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_provider_evidence->'invoice'->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_provider_evidence->'invoice'->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
       or p_provider_evidence->'invoice'->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment'
       or p_provider_evidence->'invoice'->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
       or p_provider_evidence->'invoice'->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text
     or jsonb_typeof(p_provider_evidence->'invoice_lines') is distinct from 'array'
     or jsonb_array_length(p_provider_evidence->'invoice_lines') is distinct from 1
       or p_provider_evidence->'invoice_lines'->0->>'invoice_item_id' is distinct from v_invoice.invoice_item_id
       or (p_provider_evidence->'invoice_lines'->0->>'amount')::integer is distinct from v_amount
       or p_provider_evidence->'invoice_lines'->0->>'invoice_id' is distinct from p_invoice_id
       or p_provider_evidence->'invoice_lines'->0->>'currency' is distinct from 'usd'
       or p_provider_evidence->'invoice_lines'->0->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'invoice_lines'->0->'providerScope')
       or p_provider_evidence->'invoice_lines'->0->>'discountable' is distinct from 'false'
       or jsonb_typeof(p_provider_evidence->'invoice_payments') is distinct from 'array'
       or jsonb_array_length(p_provider_evidence->'invoice_payments') is distinct from 1
       or p_provider_evidence->'invoice_payments'->0->>'invoice_id' is distinct from p_invoice_id
       or p_provider_evidence->'invoice_payments'->0->>'payment_intent_id' is distinct from p_payment_intent_id
       or p_provider_evidence->'invoice_payments'->0->>'is_default' is distinct from 'true'
       or p_provider_evidence->'invoice_payments'->0->>'type' is distinct from 'payment_intent'
       or p_provider_evidence->'invoice_payments'->0->>'status' is distinct from 'paid'
       or p_provider_evidence->'invoice_payments'->0->>'currency' is distinct from 'usd'
       or p_provider_evidence->'invoice_payments'->0->>'livemode' is distinct from v_billing.provider_livemode::text
       or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'invoice_payments'->0->'providerScope')
       or (p_provider_evidence->'invoice_payments'->0->>'amount_requested')::integer is distinct from v_amount
       or (p_provider_evidence->'invoice_payments'->0->>'amount_paid')::integer is distinct from v_amount
       or (p_provider_evidence->'invoice_lines'->0->>'quantity' is not null and p_provider_evidence->'invoice_lines'->0->>'quantity' is distinct from '1')
       or p_provider_evidence->'invoice_lines'->0->>'proration' is distinct from 'false'
       or p_provider_evidence->'invoice_lines'->0->>'subscription_id' is not null
       or p_provider_evidence->'invoice_lines'->0->'discounts' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice_lines'->0->'tax_rates' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice_lines'->0->'tax_amounts' is distinct from '[]'::jsonb
       or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_order_id' is distinct from p_order_id::text
       or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_installment_number' is distinct from p_installment_number::text
       or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_attempt_number' is distinct from v_invoice.checkout_attempt_number::text
        or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_billing_kind' is distinct from 'standalone_installment_line'
        or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_platform_account_id' is distinct from v_billing.provider_platform_account_id
        or p_provider_evidence->'invoice_lines'->0->'metadata'->>'program_livemode' is distinct from v_billing.provider_livemode::text then
      return jsonb_build_object('status','invoice_proof_mismatch');
    end if;
  end if;
  if p_saved_payment_method_id is null or p_saved_payment_method_id !~ '^pm_[A-Za-z0-9_]+$'
     or p_provider_evidence->'payment_method'->>'id' is distinct from p_saved_payment_method_id
     or p_provider_evidence->'payment_method'->>'type' is distinct from 'card'
     or p_provider_evidence->'payment_method'->>'livemode' is distinct from v_billing.provider_livemode::text
     or not private.program_billing_provider_scope_matches(p_order_id,p_provider_evidence->'payment_method'->'providerScope')
     or (v_order.installment_count > 1 and p_provider_evidence->'payment_method'->>'customer_id' is distinct from v_billing.stripe_customer_id) then
    return jsonb_build_object('status','payment_method_proof_missing');
  end if;
  if p_installment_number > 1 and p_saved_payment_method_id is distinct from v_billing.saved_payment_method_id then
    return jsonb_build_object('status','saved_card_mismatch');
  end if;

  v_core_ok := public.record_program_installment_payment(
    p_order_id,p_installment_number,v_installment.revision,p_event_id,p_payment_intent_id,
    p_invoice_id,p_charge_id,'succeeded',p_amount_cents,p_refunded_cents,p_currency
  );
  if not v_core_ok then
    insert into public.program_billing_provider_observations (
      provider_event_id,order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
      provider_status,evidence_digest,is_current_attempt,manual_review_required
    ) values (p_event_id,p_order_id,p_checkout_attempt_number,p_installment_number,'payment_intent',p_payment_intent_id,
      'succeeded',p_evidence_digest,true,true);
    insert into public.program_billing_financial_conflicts (
      order_id,provider_event_id,reason_code,provider_object_id,evidence_digest
    ) values (p_order_id,p_event_id,'provider_identity_mismatch',p_payment_intent_id,p_evidence_digest);
    update public.program_billing_orders billing set financial_conflict = true,
      billing_state = 'financial_conflict',revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id and not billing.financial_conflict;
    return jsonb_build_object('status','ledger_claim_conflict');
  end if;
  insert into public.program_billing_provider_observations (
    provider_event_id,order_id,checkout_attempt_number,installment_number,provider_object_type,provider_object_id,
    provider_status,evidence_digest,is_current_attempt
  ) values (p_event_id,p_order_id,p_checkout_attempt_number,p_installment_number,'payment_intent',p_payment_intent_id,
    'succeeded',p_evidence_digest,true);
  if p_installment_number = 1 then
    if v_order.installment_count > 1 then
      v_anchor_date := v_billing.disclosed_charge_dates[1];
      v_anchor_day := extract(day from v_anchor_date)::integer;
      v_is_eom := v_anchor_date = (date_trunc('month',v_anchor_date::timestamp) + interval '1 month - 1 day')::date;
    else
      v_anchor_date := null;
      v_anchor_day := null;
      v_is_eom := null;
    end if;
    update public.program_billing_orders billing set first_settled_at = p_settled_at,
      saved_payment_method_id = case when v_order.installment_count > 1 then p_saved_payment_method_id else null end,
      anchor_day = v_anchor_day,anchor_is_end_of_month = v_is_eom,
      next_installment_number = case when v_order.installment_count > 1 then 2 else null end,
      next_anchor_date = case when v_order.installment_count > 1 then v_anchor_date else null end,
      billing_state = case when billing.cancellation_request_id is not null then 'cancel_requested'
        when v_order.installment_count > 1 then 'active' else 'paid' end,
      revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
  elsif p_installment_number = v_order.installment_count then
    update public.program_billing_orders billing set billing_state = 'paid',
      revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id and billing.billing_state <> 'cancel_requested';
  else
    update public.program_billing_orders billing set next_installment_number = p_installment_number + 1,
      next_anchor_date = billing.disclosed_charge_dates[p_installment_number],
      revision = billing.revision + 1,updated_at = now()
    where billing.order_id = p_order_id;
  end if;
  if p_installment_number > 1 then
    update public.program_billing_installment_invoices invoice_state set provider_status = 'succeeded',
      current_pay_outcome = 'succeeded',revision = invoice_state.revision + 1,updated_at = now()
    where invoice_state.order_id = p_order_id and invoice_state.installment_number = p_installment_number;
    select operation.* into v_operation from public.program_billing_operations operation
    where operation.order_id = p_order_id and operation.operation_kind = 'invoice_pay'
      and operation.checkout_attempt_number = p_checkout_attempt_number
      and operation.installment_number = p_installment_number
      and operation.payment_attempt_number = v_invoice.current_pay_attempt for update;
    if found and v_operation.operation_state in ('intent','unknown') then
      update public.program_billing_operations operation set operation_state = 'succeeded',
        provider_object_id = p_payment_intent_id,revision = operation.revision + 1,updated_at = now()
      where operation.id = v_operation.id;
    end if;
    update public.program_billing_checkout_attempts attempt set provider_status = 'invoice_paid',
      revision = attempt.revision + 1,updated_at = now()
    where attempt.order_id = p_order_id and attempt.attempt_number = p_checkout_attempt_number;
  end if;
  return jsonb_build_object('status','settled','installment_number',p_installment_number);
exception when invalid_text_representation or numeric_value_out_of_range or unique_violation or invalid_parameter_value then
  return jsonb_build_object('status','settlement_proof_invalid');
end;
$$;
revoke all on function public.record_program_billing_settled_payment(uuid,bigint,text,smallint,smallint,text,text,text,text,integer,integer,text,timestamptz,text,jsonb,text)
from public, anon, authenticated, service_role;
grant execute on function public.record_program_billing_settled_payment(uuid,bigint,text,smallint,smallint,text,text,text,text,integer,integer,text,timestamptz,text,jsonb,text)
to service_role;
