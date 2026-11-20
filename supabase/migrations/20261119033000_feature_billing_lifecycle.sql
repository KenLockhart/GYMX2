-- Form Coach subscription-trial registration, invoice snapshots, durable conflicts,
-- and account-deletion billing inventory proofs. All provider evidence is supplied
-- only by service-role code after a current Stripe retrieve; no browser grants access.

-- New cross-component mutations must use the same nonblocking account fence as
-- media deletion before taking the legacy payer lock. READ COMMITTED is required
-- so every fresh statement sees a revision after acquiring those fences.
create function private.form_coach_try_account_lock(target_payer_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if target_payer_id is null then raise exception 'Payer identity is required' using errcode='22023'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('account:'||target_payer_id::text,19031003)) then return false; end if;
  return true;
end;
$$;
revoke all on function private.form_coach_try_account_lock(uuid) from public,anon,authenticated,service_role;

create function private.form_coach_try_payer_lock(target_payer_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if target_payer_id is null then raise exception 'Payer identity is required' using errcode='22023'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001';
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended(target_payer_id::text,0)) then return false; end if;
  return true;
end;
$$;
revoke all on function private.form_coach_try_payer_lock(uuid) from public,anon,authenticated,service_role;

create function private.form_coach_try_account_payer_locks(target_payer_id uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  if not private.form_coach_try_account_lock(target_payer_id) then return false; end if;
  return private.form_coach_try_payer_lock(target_payer_id);
end;
$$;
revoke all on function private.form_coach_try_account_payer_locks(uuid) from public,anon,authenticated,service_role;

-- The trial proof tables and the pre-existing terminal table deliberately have no
-- direct service-role SELECT grant. These narrowly scoped projections expose only
-- the exact binding needed by webhook reconciliation.
create function public.service_read_form_coach_trial_registration(p_subscription_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_subscription_id),'') is null then raise exception 'Subscription identity is required' using errcode='22023'; end if;
  select jsonb_build_object('request_id',t.request_id,'reservation_id',t.reservation_id,
      'stripe_checkout_session_id',t.stripe_checkout_session_id,'stripe_customer_id',t.stripe_customer_id,
      'stripe_invoice_id',t.stripe_invoice_id,'trial_days',t.trial_days,'trial_start',t.trial_start,'trial_end',t.trial_end)
    into result from public.feature_checkout_trial_registrations t
    where t.feature_key='form_coach' and t.stripe_subscription_id=p_subscription_id;
  return result;
end;
$$;
revoke all on function public.service_read_form_coach_trial_registration(text) from public,anon,authenticated;
grant execute on function public.service_read_form_coach_trial_registration(text) to service_role;

create function public.service_has_form_coach_trial_terminal_binding(p_session_id text,p_subscription_id text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_session_id),'') is null and nullif(trim(p_subscription_id),'') is null then
    raise exception 'Terminal lookup identity is required' using errcode='22023'; end if;
  return exists(select 1 from public.feature_checkout_terminal_attestations c
      where p_session_id is not null and c.stripe_checkout_session_id=p_session_id)
    or exists(select 1 from public.feature_checkout_trial_terminal_attestations t
      where (p_session_id is not null and t.stripe_checkout_session_id=p_session_id)
         or (p_subscription_id is not null and t.stripe_subscription_id=p_subscription_id));
end;
$$;
revoke all on function public.service_has_form_coach_trial_terminal_binding(text,text) from public,anon,authenticated;
grant execute on function public.service_has_form_coach_trial_terminal_binding(text,text) to service_role;

alter table public.feature_checkout_reservations
  add column trial_days integer not null default 0
    check (trial_days between 0 and 365);
alter table public.feature_checkout_reservations
  add constraint feature_checkout_trial_subscription_only
    check (trial_days = 0 or credits_per_pack is null);

create function private.snapshot_feature_checkout_trial_offer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare revision_row public.feature_pricing_revisions%rowtype;
begin
  select * into revision_row from public.feature_pricing_revisions r
   where r.feature_key=new.feature_key and r.revision=new.config_revision;
  if not found then
    raise exception 'Checkout pricing revision is missing' using errcode='23503';
  end if;
  if new.credits_per_pack is null then
    if revision_row.billing_model is distinct from 'subscription' then
      raise exception 'Time trial requires a subscription quote' using errcode='23514';
    end if;
    new.trial_days := revision_row.trial_days;
  else
    new.trial_days := 0;
  end if;
  return new;
end;
$$;
revoke all on function private.snapshot_feature_checkout_trial_offer() from public,anon,authenticated;
create trigger feature_checkout_trial_offer_snapshot
  before insert on public.feature_checkout_reservations
  for each row execute function private.snapshot_feature_checkout_trial_offer();

create or replace function private.protect_feature_checkout_quote()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.request_id,new.idempotency_key,new.feature_key,new.config_revision,new.payer_role,new.payer_id,new.price_key,
      new.stripe_product_id,new.stripe_price_id,new.unit_amount_cents,new.currency,new.pack_quantity,new.credits_per_pack,
      new.quoted_credits,new.total_amount_cents,new.trial_days,new.expires_at,new.created_at)
     is distinct from
     (old.request_id,old.idempotency_key,old.feature_key,old.config_revision,old.payer_role,old.payer_id,old.price_key,
      old.stripe_product_id,old.stripe_price_id,old.unit_amount_cents,old.currency,old.pack_quantity,old.credits_per_pack,
      old.quoted_credits,old.total_amount_cents,old.trial_days,old.expires_at,old.created_at) then
    raise exception 'Feature checkout quote is immutable' using errcode = '42501';
  end if;
  if old.stripe_checkout_session_id is not null and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id then
    raise exception 'Checkout session binding is immutable' using errcode = '42501';
  end if;
  if nullif(trim(old.stripe_customer_id),'') is not null and new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Checkout customer binding is immutable' using errcode = '42501';
  end if;
  if nullif(trim(old.stripe_subscription_id),'') is not null and new.stripe_subscription_id is distinct from old.stripe_subscription_id then
    raise exception 'Checkout subscription binding is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_feature_checkout_quote() from public,anon,authenticated;

create table public.feature_checkout_trial_registrations (
  request_id uuid primary key,
  reservation_id uuid not null unique references public.feature_checkout_reservations(id) on delete restrict,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_invoice_id text not null unique,
  trial_days integer not null check (trial_days between 1 and 365),
  trial_start timestamptz not null,
  trial_end timestamptz not null check (trial_end>trial_start),
  session_evidence_digest text not null check (session_evidence_digest ~ '^[a-f0-9]{64}$'),
  invoice_evidence_digest text not null check (invoice_evidence_digest ~ '^[a-f0-9]{64}$'),
  registered_at timestamptz not null default now()
);
alter table public.feature_checkout_trial_registrations enable row level security;
revoke all on public.feature_checkout_trial_registrations from public,anon,authenticated,service_role;
create trigger feature_checkout_trial_registrations_immutable
  before update or delete on public.feature_checkout_trial_registrations
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_checkout_trial_terminal_attestations (
  request_id uuid primary key,
  reservation_id uuid not null unique references public.feature_checkout_reservations(id) on delete restrict,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  session_status text not null check (session_status='complete'),
  payment_status text not null check (payment_status='no_payment_required'),
  subscription_status text not null check (subscription_status in ('canceled','incomplete_expired')),
  outstanding_invoice_count integer not null check (outstanding_invoice_count=0),
  active_payment_intent_count integer not null check (active_payment_intent_count=0),
  terminal_evidence_digest text not null check (terminal_evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now()
);
alter table public.feature_checkout_trial_terminal_attestations enable row level security;
revoke all on public.feature_checkout_trial_terminal_attestations from public,anon,authenticated,service_role;
create trigger feature_checkout_trial_terminal_attestations_immutable
  before update or delete on public.feature_checkout_trial_terminal_attestations
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_billing_conflict_events (
  event_id text primary key,
  event_type text not null,
  feature_key text not null check (feature_key='form_coach'),
  object_id text not null,
  reservation_id uuid references public.feature_checkout_reservations(id) on delete restrict,
  payer_id uuid,
  conflict_kind text not null check (conflict_kind in ('payment_after_terminal','subscription_after_terminal','terminal_identity_mismatch','provider_state_conflict')),
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now()
);
alter table public.feature_billing_conflict_events enable row level security;
revoke all on public.feature_billing_conflict_events from public,anon,authenticated,service_role;
create trigger feature_billing_conflict_events_immutable
  before update or delete on public.feature_billing_conflict_events
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_billing_conflict_resolutions (
  conflict_event_id text primary key references public.feature_billing_conflict_events(event_id) on delete restrict,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  resource_kind text not null check (resource_kind in ('checkout_session','subscription','invoice')),
  resource_id text not null,
  conflict_identity_digest text not null check (conflict_identity_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  evidence jsonb not null check (jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=8192),
  request_id uuid not null,
  recorded_at timestamptz not null default now()
);
alter table public.feature_billing_conflict_resolutions enable row level security;
revoke all on public.feature_billing_conflict_resolutions from public,anon,authenticated,service_role;
create trigger feature_billing_conflict_resolutions_immutable
  before update or delete on public.feature_billing_conflict_resolutions
  for each row execute function private.reject_feature_billing_history_mutation();

-- Customer retirement is a durable two-step proof: reserve an exact intent before
-- provider DELETE, then attest only a matching successful deleted-customer response.
-- The immutable payer/customer mapping is retained for audit and never rewritten.
create table public.feature_form_coach_customer_retirement_intents (
  request_id uuid primary key,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  customer_id text not null check (char_length(customer_id) between 1 and 255),
  create_attempt_id uuid not null references public.feature_customer_create_attempts(id) on delete restrict,
  tombstone_id uuid not null references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_revision bigint not null check (tombstone_revision > 0),
  stripe_account_id text not null check (char_length(stripe_account_id) between 1 and 255),
  livemode boolean not null,
  customer_identity_digest text not null check (customer_identity_digest ~ '^[a-f0-9]{64}$'),
  inventory_digest text not null check (inventory_digest ~ '^[a-f0-9]{64}$'),
  inventory_summary jsonb not null check (jsonb_typeof(inventory_summary)='object' and octet_length(inventory_summary::text)<=8192),
  local_resource_digest text not null check (local_resource_digest ~ '^[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(feature_key,payer_id,customer_id),
  unique(feature_key,create_attempt_id)
);
alter table public.feature_form_coach_customer_retirement_intents enable row level security;
revoke all on public.feature_form_coach_customer_retirement_intents from public,anon,authenticated,service_role;
create trigger feature_form_coach_customer_retirement_intents_immutable
  before update or delete on public.feature_form_coach_customer_retirement_intents
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_form_coach_customer_retirement_proofs (
  request_id uuid primary key references public.feature_form_coach_customer_retirement_intents(request_id) on delete restrict,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  customer_id text not null check (char_length(customer_id) between 1 and 255),
  create_attempt_id uuid not null references public.feature_customer_create_attempts(id) on delete restrict,
  tombstone_id uuid not null references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_revision bigint not null check (tombstone_revision > 0),
  stripe_account_id text not null check (char_length(stripe_account_id) between 1 and 255),
  livemode boolean not null,
  inventory_digest text not null check (inventory_digest ~ '^[a-f0-9]{64}$'),
  http_status integer not null check (http_status=200),
  provider_deleted boolean not null check (provider_deleted),
  observed_at timestamptz not null,
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now()
);
alter table public.feature_form_coach_customer_retirement_proofs enable row level security;
revoke all on public.feature_form_coach_customer_retirement_proofs from public,anon,authenticated,service_role;
create trigger feature_form_coach_customer_retirement_proofs_immutable
  before update or delete on public.feature_form_coach_customer_retirement_proofs
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_form_coach_customer_retirement_revalidations (
  request_id uuid primary key,
  source_request_id uuid not null references public.feature_form_coach_customer_retirement_intents(request_id) on delete restrict,
  feature_key text not null check (feature_key='form_coach'),
  payer_id uuid not null,
  customer_id text not null check (char_length(customer_id) between 1 and 255),
  create_attempt_id uuid not null references public.feature_customer_create_attempts(id) on delete restrict,
  tombstone_id uuid not null references public.stream_media_account_tombstones(id) on delete restrict,
  tombstone_revision bigint not null check (tombstone_revision > 0),
  stripe_account_id text not null check (char_length(stripe_account_id) between 1 and 255),
  livemode boolean not null,
  inventory_digest text not null check (inventory_digest ~ '^[a-f0-9]{64}$'),
  http_status integer not null check (http_status=200),
  customer_response_id text not null check (char_length(customer_response_id) between 1 and 255),
  provider_deleted boolean not null check (provider_deleted),
  observed_at timestamptz not null,
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now(),
  unique(source_request_id,tombstone_id,tombstone_revision)
);
alter table public.feature_form_coach_customer_retirement_revalidations enable row level security;
revoke all on public.feature_form_coach_customer_retirement_revalidations from public,anon,authenticated,service_role;
create trigger feature_form_coach_customer_retirement_revalidations_immutable
  before update or delete on public.feature_form_coach_customer_retirement_revalidations
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_form_coach_pack_refund_provider_events (
  event_id text not null check (char_length(event_id) between 1 and 255),
  event_type text not null check (event_type in ('charge.refunded','refund.updated')),
  refund_id text not null check (char_length(refund_id) between 1 and 255),
  receipt_id uuid not null references public.feature_payment_receipts(id) on delete restrict,
  payer_id uuid not null,
  stripe_customer_id text not null,
  payment_intent_id text not null,
  charge_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  refunded_pack_quantity integer not null check (refunded_pack_quantity > 0),
  outcome text not null check (outcome in ('applied','manual_review')),
  review_reason text,
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check ((outcome='manual_review' and review_reason in ('partial_or_ambiguous_amount','provider_inventory_incomplete'))
      or (outcome='applied' and review_reason is null)),
  primary key(event_id,refund_id)
);
alter table public.feature_form_coach_pack_refund_provider_events enable row level security;
revoke all on public.feature_form_coach_pack_refund_provider_events from public,anon,authenticated,service_role;
create trigger feature_form_coach_pack_refund_provider_events_immutable
  before update or delete on public.feature_form_coach_pack_refund_provider_events
  for each row execute function private.reject_feature_billing_history_mutation();

create table public.feature_form_coach_pack_refund_observations (
  event_id text not null,
  refund_id text not null,
  observation_digest text not null check (observation_digest ~ '^[a-f0-9]{64}$'),
  cumulative_refunded_cents bigint not null check (cumulative_refunded_cents >= 0),
  observed_at timestamptz not null,
  primary key(event_id,refund_id,observation_digest),
  foreign key(event_id,refund_id) references public.feature_form_coach_pack_refund_provider_events(event_id,refund_id) on delete restrict
);
alter table public.feature_form_coach_pack_refund_observations enable row level security;
revoke all on public.feature_form_coach_pack_refund_observations from public,anon,authenticated,service_role;
create trigger feature_form_coach_pack_refund_observations_immutable
  before update or delete on public.feature_form_coach_pack_refund_observations
  for each row execute function private.reject_feature_billing_history_mutation();

create function public.service_record_form_coach_pack_refund_event(
  p_event_id text,p_event_type text,p_refund_id text,p_receipt_id uuid,p_payer_id uuid,p_customer_id text,
  p_payment_intent_id text,p_charge_id text,p_amount_cents bigint,p_currency text,p_refunded_pack_quantity integer,
  p_outcome text,p_review_reason text,p_identity_digest text,p_observed_refund_total_cents bigint,
  p_observation_digest text,p_observed_at timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare receipt public.feature_payment_receipts%rowtype; reservation public.feature_checkout_reservations%rowtype;
  existing public.feature_form_coach_pack_refund_provider_events%rowtype;
  existing_observation public.feature_form_coach_pack_refund_observations%rowtype; primitive_result text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_event_id),'') is null or char_length(p_event_id)>255
    or p_event_type not in ('charge.refunded','refund.updated') or nullif(trim(p_refund_id),'') is null
    or p_receipt_id is null or p_payer_id is null or nullif(trim(p_customer_id),'') is null
    or nullif(trim(p_payment_intent_id),'') is null or nullif(trim(p_charge_id),'') is null
    or p_amount_cents is null or p_amount_cents<1 or coalesce(p_currency,'') !~ '^[A-Z]{3}$'
    or p_refunded_pack_quantity is null or p_refunded_pack_quantity<1
    or p_outcome not in ('applied','manual_review')
    or (p_outcome='manual_review' and p_review_reason not in ('partial_or_ambiguous_amount','provider_inventory_incomplete'))
    or (p_outcome='applied' and p_review_reason is not null)
    or p_identity_digest is null or p_identity_digest !~ '^[a-f0-9]{64}$'
    or p_observed_refund_total_cents is null or p_observed_refund_total_cents<p_amount_cents
    or p_observation_digest is null or p_observation_digest !~ '^[a-f0-9]{64}$' or p_observed_at is null then
    raise exception 'Invalid Form Coach pack refund evidence' using errcode='22023'; end if;
  if not private.form_coach_try_account_payer_locks(p_payer_id) then return 'retryable_account_serialization'; end if;
  select * into existing from public.feature_form_coach_pack_refund_provider_events e
    where e.event_id=p_event_id and e.refund_id=p_refund_id for share;
  if found then
    if (existing.event_type,existing.receipt_id,existing.payer_id,existing.stripe_customer_id,existing.payment_intent_id,
        existing.charge_id,existing.amount_cents,existing.currency,existing.refunded_pack_quantity,existing.outcome,
        existing.review_reason,existing.identity_digest)
      is distinct from (p_event_type,p_receipt_id,p_payer_id,p_customer_id,p_payment_intent_id,p_charge_id,p_amount_cents,
        p_currency,p_refunded_pack_quantity,p_outcome,p_review_reason,p_identity_digest) then return 'conflict'; end if;
    select * into existing_observation from public.feature_form_coach_pack_refund_observations o
      where o.event_id=p_event_id and o.refund_id=p_refund_id and o.observation_digest=p_observation_digest for share;
    if found then
      if existing_observation.cumulative_refunded_cents<>p_observed_refund_total_cents then return 'conflict'; end if;
    else
      insert into public.feature_form_coach_pack_refund_observations(
        event_id,refund_id,observation_digest,cumulative_refunded_cents,observed_at
      ) values(p_event_id,p_refund_id,p_observation_digest,p_observed_refund_total_cents,p_observed_at);
    end if;
    return case when existing.outcome='applied' then 'already_applied' else 'already_manual_review' end;
  end if;
  select * into receipt from public.feature_payment_receipts r where r.id=p_receipt_id for share;
  select * into reservation from public.feature_checkout_reservations c where c.id=receipt.reservation_id for share;
  if not found or receipt.feature_key<>'form_coach' or receipt.payer_id<>p_payer_id or receipt.disposition<>'applied'
    or receipt.credits_per_pack is null or receipt.payment_intent_id is distinct from p_payment_intent_id
    or receipt.currency<>p_currency or reservation.payer_id<>p_payer_id or reservation.feature_key<>'form_coach'
    or reservation.stripe_customer_id is distinct from p_customer_id
    or p_refunded_pack_quantity>receipt.pack_quantity or p_amount_cents>receipt.amount_cents
    or p_observed_refund_total_cents>receipt.amount_cents then return 'identity_mismatch'; end if;
  if p_outcome='applied' then
    if receipt.amount_cents % receipt.pack_quantity<>0 or p_refunded_pack_quantity<>receipt.pack_quantity
      or p_amount_cents<>receipt.amount_cents then
      return 'identity_mismatch'; end if;
    select outcome into primitive_result from public.apply_feature_pack_refund(p_receipt_id,p_refund_id,p_refunded_pack_quantity);
    if primitive_result not in ('applied','duplicate_refund') then return 'identity_mismatch'; end if;
  end if;
  insert into public.feature_form_coach_pack_refund_provider_events(
    event_id,event_type,refund_id,receipt_id,payer_id,stripe_customer_id,payment_intent_id,charge_id,amount_cents,currency,
    refunded_pack_quantity,outcome,review_reason,identity_digest,observed_at)
  values(p_event_id,p_event_type,p_refund_id,p_receipt_id,p_payer_id,p_customer_id,p_payment_intent_id,p_charge_id,
    p_amount_cents,p_currency,p_refunded_pack_quantity,p_outcome,p_review_reason,p_identity_digest,p_observed_at);
  insert into public.feature_form_coach_pack_refund_observations(
    event_id,refund_id,observation_digest,cumulative_refunded_cents,observed_at
  ) values(p_event_id,p_refund_id,p_observation_digest,p_observed_refund_total_cents,p_observed_at);
  return p_outcome;
end;
$$;
revoke all on function public.service_record_form_coach_pack_refund_event(text,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,text,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_pack_refund_event(text,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,text,text,bigint,text,timestamptz) to service_role;

alter table public.feature_subscription_invoice_events
  add column source_kind text not null default 'stripe_event'
    check (source_kind in ('stripe_event','snapshot_reconciliation'));
alter table public.feature_billing_event_identity
  add column source_kind text not null default 'stripe_event'
    check (source_kind in ('stripe_event','snapshot_reconciliation'));

create function private.protect_invoice_event_source_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_kind is distinct from old.source_kind then
    raise exception 'Invoice event source kind is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_invoice_event_source_kind() from public,anon,authenticated;
create trigger feature_invoice_event_source_kind_guard before update on public.feature_subscription_invoice_events
  for each row execute function private.protect_invoice_event_source_kind();
create trigger feature_billing_event_source_kind_guard before update on public.feature_billing_event_identity
  for each row execute function private.protect_invoice_event_source_kind();

create table public.feature_invoice_snapshot_attempts (
  request_id uuid primary key,
  actual_event_id text not null,
  actual_event_type text not null check (actual_event_type in ('invoice.paid','invoice.payment_failed','invoice.finalized','invoice.voided')),
  actual_event_digest text not null check (actual_event_digest ~ '^[a-f0-9]{64}$'),
  internal_event_id text not null unique,
  invoice_id text not null,
  subscription_id text not null,
  payer_id uuid not null,
  contract_version integer not null check (contract_version > 0),
  snapshot_status text not null check (snapshot_status in ('draft','open','paid','void','uncollectible')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  amount_paid_cents bigint not null check (amount_paid_cents >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  payment_intent_id text,
  charge_id text,
  trial_claim_id uuid references public.feature_trial_claims(id) on delete restrict,
  expected_invoice_revision bigint not null check (expected_invoice_revision >= 0),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{64}$'),
  resulting_invoice_revision bigint,
  outcome text not null check (outcome in ('received','retryable','applied','stale','mismatch','blocked_deletion','manual_review')),
  state_revision bigint not null default 0 check (state_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.feature_invoice_snapshot_attempts enable row level security;
revoke all on public.feature_invoice_snapshot_attempts from public,anon,authenticated,service_role;
create function private.protect_feature_invoice_snapshot_attempt()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Invoice reconciliation attempt cannot be deleted' using errcode='42501'; end if;
  if (new.request_id,new.actual_event_id,new.actual_event_type,new.actual_event_digest,new.internal_event_id,
      new.invoice_id,new.subscription_id,new.payer_id,new.contract_version,new.snapshot_status,new.currency,
      new.amount_due_cents,new.amount_paid_cents,new.period_start,new.period_end,new.payment_intent_id,new.charge_id,
      new.trial_claim_id,new.expected_invoice_revision,new.snapshot_digest,new.created_at)
     is distinct from
     (old.request_id,old.actual_event_id,old.actual_event_type,old.actual_event_digest,old.internal_event_id,
      old.invoice_id,old.subscription_id,old.payer_id,old.contract_version,old.snapshot_status,old.currency,
      old.amount_due_cents,old.amount_paid_cents,old.period_start,old.period_end,old.payment_intent_id,old.charge_id,
      old.trial_claim_id,old.expected_invoice_revision,old.snapshot_digest,old.created_at) then
    raise exception 'Invoice reconciliation evidence is immutable' using errcode='42501';
  end if;
  if new.state_revision<>old.state_revision+1 then raise exception 'Invoice reconciliation outcome must advance by CAS' using errcode='40001'; end if;
  if not ((old.outcome='received' and new.outcome in ('retryable','applied','stale','mismatch','blocked_deletion','manual_review'))
      or (old.outcome in ('retryable','stale') and new.outcome in ('retryable','applied','stale','mismatch','blocked_deletion','manual_review'))) then
    raise exception 'Invalid invoice reconciliation transition' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_feature_invoice_snapshot_attempt() from public,anon,authenticated;
create trigger feature_invoice_snapshot_attempts_guard
  before update or delete on public.feature_invoice_snapshot_attempts
  for each row execute function private.protect_feature_invoice_snapshot_attempt();

-- The service registration accepts only a retrieved zero-due Checkout Session,
-- its exact trialing Subscription, and the corresponding zero-value first Invoice.
create function public.service_register_form_coach_trial_checkout(
  p_request_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,p_invoice_id text,
  p_session_status text,p_payment_status text,p_mode text,p_currency text,
  p_session_subtotal bigint,p_session_total bigint,p_session_metadata jsonb,
  p_price_id text,p_product_id text,p_quantity integer,
  p_subscription_status text,p_trial_start timestamptz,p_trial_end timestamptz,p_period_end timestamptz,
  p_invoice_status text,p_invoice_currency text,p_invoice_amount_due bigint,p_invoice_amount_paid bigint,
  p_invoice_period_start timestamptz,p_invoice_period_end timestamptz,
  p_session_evidence_digest text,p_invoice_evidence_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare reservation public.feature_checkout_reservations%rowtype; payer_id_value uuid;
  expected_metadata jsonb; existing public.feature_checkout_trial_registrations%rowtype;
  existing_claim public.feature_trial_claims%rowtype; claim_result record; role_value text; deletion boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or nullif(trim(p_session_id),'') is null or nullif(trim(p_customer_id),'') is null
    or nullif(trim(p_subscription_id),'') is null or nullif(trim(p_invoice_id),'') is null
    or p_session_status is null or p_payment_status is null or p_mode is null or p_currency is null
    or p_session_subtotal is null or p_session_total is null or p_session_metadata is null
    or jsonb_typeof(p_session_metadata)<>'object' or nullif(trim(p_price_id),'') is null
    or nullif(trim(p_product_id),'') is null or p_quantity is null or p_trial_start is null
    or p_trial_end is null or p_period_end is null or p_invoice_status is null or p_invoice_currency is null
    or p_invoice_amount_due is null or p_invoice_amount_paid is null
    or p_invoice_period_start is null or p_invoice_period_end is null
    or p_session_evidence_digest is null or p_session_evidence_digest !~ '^[a-f0-9]{64}$'
    or p_invoice_evidence_digest is null or p_invoice_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid verified trial Checkout evidence' using errcode='22023';
  end if;
  select r.payer_id into payer_id_value from public.feature_checkout_reservations r
   where r.request_id=p_request_id and r.feature_key='form_coach';
  if not found then return 'reservation_missing'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001'; end if;
  if not private.form_coach_try_account_payer_locks(payer_id_value) then
    return 'retryable_account_serialization';
  end if;
  select r.* into reservation from public.feature_checkout_reservations r
   where r.request_id=p_request_id and r.feature_key='form_coach' for update;
  if not found or reservation.payer_id is distinct from payer_id_value then return 'reservation_missing'; end if;
  deletion:=exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id_value)
    or private.stream_account_is_tombstoned(payer_id_value);
  expected_metadata:=jsonb_build_object(
    'feature_namespace','form_coach','feature_key','form_coach','payer_id',reservation.payer_id::text,
    'reservation_id',reservation.id::text,'request_id',reservation.request_id::text,
    'config_revision',reservation.config_revision::text,'price_key',reservation.price_key,
    'pack_quantity',reservation.pack_quantity::text);
  if reservation.state not in ('bound','paid','cancel_required')
    or (reservation.state='cancel_required' and not deletion) or reservation.payer_role not in ('coach','member')
    or reservation.credits_per_pack is not null or reservation.trial_days < 1
    or reservation.stripe_checkout_session_id is distinct from p_session_id
    or reservation.stripe_customer_id is distinct from p_customer_id
    or reservation.stripe_subscription_id is distinct from p_subscription_id
    or p_session_status<>'complete' or p_payment_status<>'no_payment_required' or p_mode<>'subscription'
    or lower(p_currency)<>lower(reservation.currency) or p_session_subtotal<>0 or p_session_total<>0
    or p_session_metadata<>expected_metadata or p_price_id<>reservation.stripe_price_id
    or p_product_id<>reservation.stripe_product_id or p_quantity<>reservation.pack_quantity
    or p_subscription_status<>'trialing' or p_trial_end<=p_trial_start
    or p_trial_end<>p_trial_start+make_interval(days=>reservation.trial_days)
    or p_period_end<>p_trial_end
    or p_invoice_status<>'paid' or lower(p_invoice_currency)<>lower(reservation.currency)
    or p_invoice_amount_due<>0 or p_invoice_amount_paid<>0
    or p_invoice_period_start>p_trial_start or p_invoice_period_end<p_trial_end then
    return 'evidence_mismatch';
  end if;
  if not exists(select 1 from public.feature_pricing_options o
      join public.feature_pricing_revisions r on r.feature_key=o.feature_key and r.revision=o.revision
      where o.feature_key='form_coach' and o.revision=reservation.config_revision and o.price_key=reservation.price_key
        and o.stripe_price_id=reservation.stripe_price_id and o.stripe_product_id=reservation.stripe_product_id
        and o.amount_cents=reservation.unit_amount_cents and o.currency=reservation.currency
        and o.interval is not null and r.billing_model='subscription' and r.trial_days=reservation.trial_days)
    or not exists(select 1 from public.feature_provider_objects o where o.feature_key='form_coach'
        and o.object_type='checkout_session' and o.object_id=p_session_id and o.payer_id=reservation.payer_id
        and o.config_revision=reservation.config_revision and o.price_key=reservation.price_key)
    or not exists(select 1 from public.feature_provider_objects o where o.feature_key='form_coach'
        and o.object_type='subscription' and o.object_id=p_subscription_id and o.payer_id=reservation.payer_id
        and o.config_revision=reservation.config_revision and o.price_key=reservation.price_key)
    or not exists(select 1 from public.feature_payer_customer_mappings m
        join public.feature_customer_create_attempts a on a.id=m.create_attempt_id
        where m.feature_key='form_coach' and m.payer_id=reservation.payer_id and m.stripe_customer_id=p_customer_id
          and a.state='verified' and a.payer_id=reservation.payer_id and a.stripe_customer_id=p_customer_id) then
    return 'binding_mismatch';
  end if;
  select * into existing from public.feature_checkout_trial_registrations x where x.request_id=p_request_id for update;
  if found then
    if (existing.reservation_id,existing.stripe_checkout_session_id,existing.stripe_customer_id,
        existing.stripe_subscription_id,existing.stripe_invoice_id,existing.trial_days,
        existing.trial_start,existing.trial_end,existing.session_evidence_digest,existing.invoice_evidence_digest)
       is distinct from
       (reservation.id,p_session_id,p_customer_id,p_subscription_id,p_invoice_id,reservation.trial_days,
        p_trial_start,p_trial_end,p_session_evidence_digest,p_invoice_evidence_digest) then
      return 'conflict';
    end if;
    return 'already_registered';
  end if;
  select p.role::text into role_value from public.profiles p where p.id=reservation.payer_id for share;
  if not deletion and role_value is distinct from reservation.payer_role then return 'payer_mismatch'; end if;
  if exists(select 1 from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id) then
    return 'subscription_conflict';
  end if;
  insert into public.feature_subscriptions(
    stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,stripe_customer_id,status,current_period_end,cancel_at_period_end,state_revision
  ) values(p_subscription_id,'form_coach',reservation.payer_role,reservation.payer_id,
    reservation.config_revision,reservation.price_key,p_customer_id,case when deletion then 'blocked_deletion' else 'trialing' end,p_period_end,false,0);
  insert into public.feature_checkout_trial_registrations(
    request_id,reservation_id,feature_key,payer_id,stripe_checkout_session_id,stripe_customer_id,
    stripe_subscription_id,stripe_invoice_id,trial_days,trial_start,trial_end,session_evidence_digest,invoice_evidence_digest
  ) values(p_request_id,reservation.id,'form_coach',reservation.payer_id,p_session_id,p_customer_id,
    p_subscription_id,p_invoice_id,reservation.trial_days,p_trial_start,p_trial_end,
    p_session_evidence_digest,p_invoice_evidence_digest);
  -- A tombstoned payer still needs the verified provider identities recorded so cleanup
  -- can cancel and prove terminality, but must never receive a trial claim or access grant.
  if deletion then return 'blocked_deletion'; end if;
  select * into claim_result from public.record_feature_trial_claim(
    reservation.request_id,reservation.payer_id,reservation.config_revision,'trial_days','subscription',
    p_subscription_id,p_subscription_id,p_trial_start,p_trial_end,0,
    encode(sha256(convert_to(p_request_id::text||':'||p_session_evidence_digest||':'||p_invoice_evidence_digest,'UTF8')),'hex'));
  if claim_result.outcome not in ('claimed','already_claimed') then
    raise exception 'Verified subscription trial claim could not be recorded' using errcode='55000';
  end if;
  return 'registered';
end;
$$;
revoke all on function public.service_register_form_coach_trial_checkout(uuid,text,text,text,text,text,text,text,text,bigint,bigint,jsonb,text,text,integer,text,timestamptz,timestamptz,timestamptz,text,text,bigint,bigint,timestamptz,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.service_register_form_coach_trial_checkout(uuid,text,text,text,text,text,text,text,text,bigint,bigint,jsonb,text,text,integer,text,timestamptz,timestamptz,timestamptz,text,text,bigint,bigint,timestamptz,timestamptz,text,text) to service_role;

create function public.service_claim_form_coach_assessment_trial(
  p_request_id uuid,p_payer_id uuid
)
returns table(outcome text,claim_id uuid,config_revision bigint,starts_at timestamptz,granted_assessments integer)
language plpgsql security definer set search_path = '' as $$
declare claim public.feature_trial_claims%rowtype; revision_value bigint; config public.feature_pricing_revisions%rowtype;
  role_value text; now_value timestamptz; digest_value text; rpc_result record; source_id_value text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_payer_id is null then raise exception 'Trial request identity is required' using errcode='22023'; end if;
  if not private.form_coach_try_account_payer_locks(p_payer_id) then
    return query select 'retryable_account_serialization',null::uuid,null::bigint,null::timestamptz,0; return;
  end if;
  if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id)
    or private.stream_account_is_tombstoned(p_payer_id) then
    return query select 'blocked_deletion',null::uuid,null::bigint,null::timestamptz,0; return;
  end if;
  select * into claim from public.feature_trial_claims c where c.request_id=p_request_id for update;
  if found then
    if claim.feature_key<>'form_coach' or claim.payer_id<>p_payer_id or claim.trial_kind<>'trial_assessments'
      or claim.source_kind<>'assessment_trial' then
      return query select 'request_conflict',null::uuid,null::bigint,null::timestamptz,0; return;
    end if;
    return query select 'already_claimed',claim.id,claim.config_revision,claim.starts_at,claim.granted_assessments; return;
  end if;
  select c.revision into revision_value from public.feature_pricing_current c where c.feature_key='form_coach' for share;
  select * into config from public.feature_pricing_revisions r where r.feature_key='form_coach' and r.revision=revision_value;
  if not found or config.status<>'live' or config.trial_assessments<1 then
    return query select 'unavailable',null::uuid,null::bigint,null::timestamptz,0; return;
  end if;
  select p.role::text into role_value from public.profiles p where p.id=p_payer_id for share;
  if role_value is distinct from config.payer then
    return query select 'payer_mismatch',null::uuid,null::bigint,null::timestamptz,0; return;
  end if;
  if exists(select 1 from public.feature_trial_claims c where c.feature_key='form_coach' and c.payer_id=p_payer_id)
    or exists(select 1 from public.feature_trial_access_grants g where g.feature_key='form_coach' and g.user_id=p_payer_id)
    or exists(select 1 from public.feature_credit_lots l where l.feature_key='form_coach' and l.user_id=p_payer_id and l.lot_kind='assessment_trial') then
    return query select 'already_claimed',null::uuid,revision_value,null::timestamptz,0; return;
  end if;
  now_value:=clock_timestamp();
  source_id_value:='assessment_trial:'||p_request_id::text;
  digest_value:=encode(sha256(convert_to(jsonb_build_object('feature','form_coach','payer',p_payer_id,
    'request',p_request_id,'revision',revision_value,'trial_assessments',config.trial_assessments)::text,'UTF8')),'hex');
  select * into rpc_result from public.record_feature_trial_claim(
    p_request_id,p_payer_id,revision_value,'trial_assessments','assessment_trial',source_id_value,
    null,now_value,null,config.trial_assessments,digest_value);
  if rpc_result.outcome not in ('claimed','already_claimed') then
    return query select rpc_result.outcome,null::uuid,revision_value,null::timestamptz,0; return;
  end if;
  select * into claim from public.feature_trial_claims c where c.request_id=p_request_id;
  if not found then raise exception 'Trial claim was not persisted' using errcode='55000'; end if;
  return query select rpc_result.outcome,claim.id,claim.config_revision,claim.starts_at,claim.granted_assessments;
end;
$$;
revoke all on function public.service_claim_form_coach_assessment_trial(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_claim_form_coach_assessment_trial(uuid,uuid) to service_role;

create function public.service_record_form_coach_billing_conflict(
  p_event_id text,p_event_type text,p_object_id text,p_reservation_id uuid,p_payer_id uuid,
  p_conflict_kind text,p_identity_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare existing public.feature_billing_conflict_events%rowtype; reservation public.feature_checkout_reservations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001'; end if;
  if nullif(trim(p_event_id),'') is null or char_length(p_event_id)>255 or nullif(trim(p_event_type),'') is null
    or nullif(trim(p_object_id),'') is null or p_conflict_kind not in ('payment_after_terminal','subscription_after_terminal','terminal_identity_mismatch','provider_state_conflict')
    or p_identity_digest is null or p_identity_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid billing contradiction identity' using errcode='22023';
  end if;
  if p_payer_id is not null and not private.form_coach_try_account_payer_locks(p_payer_id) then
    return 'retryable_account_serialization';
  end if;
  if p_reservation_id is not null then
    select * into reservation from public.feature_checkout_reservations r where r.id=p_reservation_id;
    if not found or reservation.feature_key<>'form_coach'
      or (p_payer_id is not null and reservation.payer_id is distinct from p_payer_id) then return 'identity_mismatch'; end if;
    if p_payer_id is null and not private.form_coach_try_account_payer_locks(reservation.payer_id) then
      return 'retryable_account_serialization'; end if;
    select * into reservation from public.feature_checkout_reservations r where r.id=p_reservation_id for share;
    if not found or reservation.feature_key<>'form_coach'
      or (p_payer_id is not null and reservation.payer_id is distinct from p_payer_id) then return 'identity_mismatch'; end if;
  elsif p_payer_id is not null then
    null;
  end if;
  select * into existing from public.feature_billing_conflict_events e where e.event_id=p_event_id for update;
  if found then
    if (existing.event_type,existing.object_id,existing.reservation_id,existing.payer_id,existing.conflict_kind,existing.identity_digest)
      is distinct from (p_event_type,p_object_id,p_reservation_id,p_payer_id,p_conflict_kind,p_identity_digest) then return 'conflict'; end if;
    return 'already_recorded';
  end if;
  insert into public.feature_billing_conflict_events(event_id,event_type,feature_key,object_id,reservation_id,payer_id,conflict_kind,identity_digest)
  values(p_event_id,p_event_type,'form_coach',p_object_id,p_reservation_id,p_payer_id,p_conflict_kind,p_identity_digest);
  return 'recorded';
end;
$$;
revoke all on function public.service_record_form_coach_billing_conflict(text,text,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_billing_conflict(text,text,text,uuid,uuid,text,text) to service_role;

-- Current provider snapshots are recorded under a distinct internal identity. The
-- immutable raw Stripe event ID/type remain in the Stripe-event rows and attempt.
create function public.service_record_form_coach_invoice_snapshot(
  p_request_id uuid,p_actual_event_id text,p_actual_event_type text,p_invoice_id text,p_subscription_id text,
  p_payer_id uuid,p_contract_version integer,p_status text,p_currency text,p_amount_due_cents bigint,
  p_amount_paid_cents bigint,p_period_start timestamptz,p_period_end timestamptz,
  p_payment_intent_id text,p_charge_id text,p_trial_claim_id uuid,p_expected_invoice_revision bigint,
  p_actual_event_digest text,p_snapshot_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare actual_event_digest text; actual_event public.feature_billing_event_identity%rowtype;
  actual_state public.feature_subscription_invoice_event_state%rowtype; internal_event_id text;
  payer_id_value uuid; mapped_payer uuid; subscription public.feature_subscriptions%rowtype;
  contract public.feature_subscription_contract_versions%rowtype; invoice_row public.feature_subscription_invoice_current%rowtype;
  existing_attempt public.feature_invoice_snapshot_attempts%rowtype; actual_event_preexisting boolean:=false;
  expected_refunds bigint; refund_state_value text;
  alias_row public.feature_billing_provider_aliases%rowtype; deletion boolean; tombstone boolean;
  source_revision bigint; attempt_outcome text; resulting_revision bigint; snapshot_applied boolean:=false;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or nullif(trim(p_actual_event_id),'') is null
    or coalesce(p_actual_event_type,'') not in ('invoice.paid','invoice.payment_failed','invoice.finalized','invoice.voided')
    or nullif(trim(p_invoice_id),'') is null or nullif(trim(p_subscription_id),'') is null or p_payer_id is null
    or p_contract_version is null or p_contract_version<1
    or coalesce(p_status,'') not in ('draft','open','paid','void','uncollectible')
    or coalesce(p_currency,'') !~ '^[A-Z]{3}$' or p_amount_due_cents is null or p_amount_due_cents<0
    or p_amount_paid_cents is null or p_amount_paid_cents<0
    or p_period_start is null or p_period_end is null or p_period_end<=p_period_start
    or p_expected_invoice_revision is null or p_expected_invoice_revision<0
    or p_actual_event_digest is null or p_actual_event_digest !~ '^[a-f0-9]{64}$'
    or p_snapshot_digest is null or p_snapshot_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Form Coach current invoice snapshot' using errcode='22023';
  end if;
  actual_event_digest:=p_actual_event_digest;
  if not private.form_coach_try_account_lock(p_payer_id) then return 'retryable_account_serialization'; end if;
  internal_event_id:='fc_invoice_snapshot:'||p_request_id::text;
  select * into existing_attempt from public.feature_invoice_snapshot_attempts a where a.request_id=p_request_id for update;
  if found then
    if (existing_attempt.actual_event_id,existing_attempt.actual_event_type,existing_attempt.actual_event_digest,
        existing_attempt.invoice_id,existing_attempt.subscription_id,existing_attempt.payer_id,existing_attempt.contract_version,
        existing_attempt.snapshot_status,existing_attempt.currency,existing_attempt.amount_due_cents,existing_attempt.amount_paid_cents,
        existing_attempt.period_start,existing_attempt.period_end,existing_attempt.payment_intent_id,existing_attempt.charge_id,
        existing_attempt.trial_claim_id,existing_attempt.expected_invoice_revision,existing_attempt.snapshot_digest)
       is distinct from
       (p_actual_event_id,p_actual_event_type,actual_event_digest,p_invoice_id,p_subscription_id,p_payer_id,p_contract_version,
        p_status,p_currency,p_amount_due_cents,p_amount_paid_cents,p_period_start,p_period_end,p_payment_intent_id,p_charge_id,
        p_trial_claim_id,p_expected_invoice_revision,p_snapshot_digest) then
      raise exception 'Invoice snapshot request ID was reused with changed evidence' using errcode='23505';
    end if;
    if existing_attempt.outcome in ('applied','mismatch','blocked_deletion','manual_review') then return existing_attempt.outcome; end if;
  end if;
  -- Preserve alias lock order after the nonblocking shared account/payer fence.
  perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:invoice:'||p_invoice_id,0));
  if p_payment_intent_id is not null then perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:payment_intent:'||p_payment_intent_id,0)); end if;
  if p_charge_id is not null then perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:charge:'||p_charge_id,0)); end if;
  select s.payer_id into mapped_payer from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach';
  if not found then return 'retryable_unmatched_subscription'; end if;
  if mapped_payer is distinct from p_payer_id then return 'mismatch_invoice_owner'; end if;
  payer_id_value:=mapped_payer;
  if payer_id_value is distinct from p_payer_id then return 'mismatch_invoice_owner'; end if;
  -- The accepted refund RPC locks invoice/PI/charge aliases before payer0.
  -- Keep that shared ordering after the nonblocking account deletion fence.
  if not private.form_coach_try_payer_lock(payer_id_value) then return 'retryable_account_serialization'; end if;
  select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id_value)
    or exists(select 1 from public.stream_media_account_tombstones t where t.account_id=payer_id_value
      and t.tombstone_state<>'completed') into deletion;
  select * into subscription from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach' for share;
  select * into contract from public.feature_subscription_contract_versions v
    where v.stripe_subscription_id=p_subscription_id and v.contract_version=p_contract_version
      and v.feature_key='form_coach' and v.payer_id=payer_id_value;
  if not found or subscription.payer_id is distinct from payer_id_value or contract.currency<>p_currency then
    attempt_outcome:='mismatch';
  elsif deletion and not (p_status in ('paid','void') and exists(
      select 1 from public.feature_subscription_invoice_current current_invoice
      where current_invoice.invoice_id=p_invoice_id and current_invoice.subscription_id=p_subscription_id
        and current_invoice.payer_id=payer_id_value and current_invoice.feature_key='form_coach')) then
    attempt_outcome:='blocked_deletion';
  else
    select * into invoice_row from public.feature_subscription_invoice_current i where i.invoice_id=p_invoice_id for update;
    source_revision:=case when found then invoice_row.state_revision else 0 end;
    if source_revision<>p_expected_invoice_revision then
      attempt_outcome:='stale';
    elsif p_trial_claim_id is not null and not exists(select 1 from public.feature_trial_claims c
      where c.id=p_trial_claim_id and c.feature_key='form_coach' and c.payer_id=payer_id_value
        and c.trial_kind='trial_days' and c.stripe_subscription_id=p_subscription_id
        and c.source_kind in ('subscription','subscription_invoice')
        and c.starts_at<=p_period_start and c.expires_at>=p_period_end) then
      attempt_outcome:='mismatch';
    elsif p_trial_claim_id is not null and (p_status<>'paid' or p_amount_due_cents<>0 or p_amount_paid_cents<>0) then
      attempt_outcome:='mismatch';
    else
      attempt_outcome:='applied';
    end if;
  end if;
  -- Persist the immutable actual Stripe identity independently from the internal snapshot event.
  select * into actual_event from public.feature_billing_event_identity e where e.event_id=p_actual_event_id for update;
  if found then
    actual_event_preexisting:=true;
    if (actual_event.event_type,actual_event.object_kind,actual_event.object_id,actual_event.identity_digest,actual_event.source_kind)
      is distinct from (p_actual_event_type,'invoice',p_invoice_id,actual_event_digest,'stripe_event') then
      attempt_outcome:='mismatch';
    end if;
  else
    insert into public.feature_billing_event_identity(event_id,event_type,object_kind,object_id,identity_digest,source_kind)
      values(p_actual_event_id,p_actual_event_type,'invoice',p_invoice_id,actual_event_digest,'stripe_event');
    insert into public.feature_subscription_invoice_events(event_id,event_type,invoice_id,subscription_id,payer_id,identity_digest,source_kind)
      values(p_actual_event_id,p_actual_event_type,p_invoice_id,p_subscription_id,payer_id_value,actual_event_digest,'stripe_event');
    insert into public.feature_subscription_invoice_event_state(event_id,state)
      values(p_actual_event_id,case when attempt_outcome='applied' then 'received' else attempt_outcome end);
  end if;
  select * into actual_state from public.feature_subscription_invoice_event_state s where s.event_id=p_actual_event_id for update;
  if actual_state.state='applied' and exists(select 1
      from public.feature_subscription_invoice_current current_invoice
      join public.feature_invoice_snapshot_attempts applied
        on applied.internal_event_id=current_invoice.last_event_id
       and applied.actual_event_id=p_actual_event_id
       and applied.snapshot_digest=p_snapshot_digest
       and applied.outcome='applied'
       and applied.resulting_invoice_revision=current_invoice.state_revision
      where current_invoice.invoice_id=p_invoice_id and current_invoice.feature_key='form_coach'
        and current_invoice.subscription_id=p_subscription_id and current_invoice.payer_id=p_payer_id
        and current_invoice.contract_version=p_contract_version and current_invoice.status=p_status
        and current_invoice.currency=p_currency and current_invoice.amount_due_cents=p_amount_due_cents
        and current_invoice.amount_paid_cents=p_amount_paid_cents and current_invoice.period_start=p_period_start
        and current_invoice.period_end=p_period_end and current_invoice.payment_intent_id is not distinct from p_payment_intent_id
        and current_invoice.charge_id is not distinct from p_charge_id
        and current_invoice.trial_claim_id is not distinct from p_trial_claim_id) then
    return 'duplicate_event';
  end if;
  if actual_event_preexisting and actual_state.state in ('blocked_deletion','mismatch','manual_review')
    and existing_attempt.request_id is null then
    attempt_outcome:='manual_review';
  end if;
  if attempt_outcome='applied' then
    for alias_row in select * from public.feature_billing_provider_aliases a
      where (a.object_kind='invoice' and a.object_id=p_invoice_id)
        or (p_payment_intent_id is not null and a.object_kind='payment_intent' and a.object_id=p_payment_intent_id)
        or (p_charge_id is not null and a.object_kind='charge' and a.object_id=p_charge_id)
      for update
    loop
      if alias_row.payer_id<>payer_id_value or alias_row.subscription_id<>p_subscription_id or alias_row.invoice_id<>p_invoice_id then
        attempt_outcome:='mismatch'; exit;
      end if;
    end loop;
  end if;
  if attempt_outcome='applied' then
    update public.feature_subscription_refund_events r set invoice_id=coalesce(r.invoice_id,p_invoice_id),payer_id=coalesce(r.payer_id,payer_id_value)
      where r.currency=p_currency and (r.invoice_id=p_invoice_id or (p_payment_intent_id is not null and r.payment_intent_id=p_payment_intent_id)
        or (p_charge_id is not null and r.charge_id=p_charge_id));
    select coalesce(sum(r.amount_cents),0)::bigint into expected_refunds from public.feature_subscription_refund_events r
      where r.invoice_id=p_invoice_id and r.payer_id=payer_id_value and r.currency=p_currency;
    if expected_refunds>p_amount_paid_cents then attempt_outcome:='mismatch'; end if;
  end if;
  if attempt_outcome='applied' then
    refund_state_value:=case when expected_refunds=0 then 'none'
      when expected_refunds=p_amount_paid_cents and p_amount_paid_cents>0 then 'fully_refunded' else 'partial_review' end;
    insert into public.feature_billing_event_identity(event_id,event_type,object_kind,object_id,identity_digest,source_kind)
      values(internal_event_id,'form_coach.invoice_snapshot_reconciled','invoice',p_invoice_id,p_snapshot_digest,'snapshot_reconciliation');
    insert into public.feature_subscription_invoice_events(event_id,event_type,invoice_id,subscription_id,payer_id,identity_digest,source_kind)
      values(internal_event_id,'form_coach.invoice_snapshot_reconciled',p_invoice_id,p_subscription_id,payer_id_value,p_snapshot_digest,'snapshot_reconciliation');
    insert into public.feature_subscription_invoice_event_state(event_id,state)
      values(internal_event_id,'received');
    if source_revision=0 then
      insert into public.feature_subscription_invoice_current(invoice_id,feature_key,subscription_id,payer_id,contract_version,status,
        currency,amount_due_cents,amount_paid_cents,period_start,period_end,payment_intent_id,charge_id,trial_claim_id,
        refund_total_cents,refund_state,last_event_id,state_revision)
      values(p_invoice_id,'form_coach',p_subscription_id,payer_id_value,p_contract_version,p_status,p_currency,p_amount_due_cents,
        p_amount_paid_cents,p_period_start,p_period_end,p_payment_intent_id,p_charge_id,p_trial_claim_id,expected_refunds,
        refund_state_value,internal_event_id,1);
      resulting_revision:=1;
      insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
        values('invoice',p_invoice_id,'form_coach',payer_id_value,p_subscription_id,p_invoice_id);
    else
      update public.feature_subscription_invoice_current set status=p_status,amount_due_cents=p_amount_due_cents,
        amount_paid_cents=p_amount_paid_cents,payment_intent_id=p_payment_intent_id,charge_id=p_charge_id,
        trial_claim_id=p_trial_claim_id,refund_total_cents=expected_refunds,refund_state=refund_state_value,
        last_event_id=internal_event_id,state_revision=state_revision+1,updated_at=now()
      where invoice_id=p_invoice_id and state_revision=p_expected_invoice_revision returning state_revision into resulting_revision;
      if not found then attempt_outcome:='stale'; end if;
    end if;
    if attempt_outcome='applied' and p_payment_intent_id is not null then
      insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
        values('payment_intent',p_payment_intent_id,'form_coach',payer_id_value,p_subscription_id,p_invoice_id) on conflict do nothing;
      if not exists(select 1 from public.feature_billing_provider_aliases a where a.object_kind='payment_intent'
        and a.object_id=p_payment_intent_id and a.payer_id=payer_id_value and a.invoice_id=p_invoice_id) then attempt_outcome:='mismatch'; end if;
    end if;
    if attempt_outcome='applied' and p_charge_id is not null then
      insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
        values('charge',p_charge_id,'form_coach',payer_id_value,p_subscription_id,p_invoice_id) on conflict do nothing;
      if not exists(select 1 from public.feature_billing_provider_aliases a where a.object_kind='charge'
        and a.object_id=p_charge_id and a.payer_id=payer_id_value and a.invoice_id=p_invoice_id) then attempt_outcome:='mismatch'; end if;
    end if;
    if attempt_outcome='applied' then
      snapshot_applied:=true;
      if refund_state_value='partial_review' then attempt_outcome:='manual_review'; end if;
      update public.feature_subscription_invoice_event_state set state='applied',state_revision=state_revision+1,processed_at=now(),updated_at=now()
        where event_id=internal_event_id;
      update public.feature_subscription_invoice_event_state set state='applied',state_revision=state_revision+1,processed_at=now(),updated_at=now()
        where event_id=p_actual_event_id and state in ('received','retryable','stale');
    end if;
  end if;
  if actual_state.event_id is not null and actual_state.state in ('received','retryable','stale')
    and attempt_outcome<>'applied' and not snapshot_applied then
    update public.feature_subscription_invoice_event_state set state=case when attempt_outcome='stale' then 'stale'
      when attempt_outcome='blocked_deletion' then 'blocked_deletion' when attempt_outcome='mismatch' then 'mismatch'
      when attempt_outcome='manual_review' then 'manual_review' else 'retryable' end,
      state_revision=state_revision+1,processed_at=case when attempt_outcome in ('blocked_deletion','mismatch','manual_review') then now() else null end,
      updated_at=now() where event_id=p_actual_event_id;
  end if;
  if existing_attempt.request_id is null then
    insert into public.feature_invoice_snapshot_attempts(request_id,actual_event_id,actual_event_type,actual_event_digest,
      internal_event_id,invoice_id,subscription_id,payer_id,contract_version,snapshot_status,currency,amount_due_cents,
      amount_paid_cents,period_start,period_end,payment_intent_id,charge_id,trial_claim_id,expected_invoice_revision,
      snapshot_digest,resulting_invoice_revision,outcome,state_revision)
    values(p_request_id,p_actual_event_id,p_actual_event_type,actual_event_digest,internal_event_id,p_invoice_id,p_subscription_id,
      payer_id_value,p_contract_version,p_status,p_currency,p_amount_due_cents,p_amount_paid_cents,p_period_start,p_period_end,
      p_payment_intent_id,p_charge_id,p_trial_claim_id,p_expected_invoice_revision,p_snapshot_digest,resulting_revision,attempt_outcome,1);
  else
    update public.feature_invoice_snapshot_attempts set outcome=attempt_outcome,resulting_invoice_revision=resulting_revision,
      state_revision=state_revision+1,updated_at=now() where request_id=p_request_id;
  end if;
  return attempt_outcome;
end;
$$;
revoke all on function public.service_record_form_coach_invoice_snapshot(uuid,text,text,text,text,uuid,integer,text,text,bigint,bigint,timestamptz,timestamptz,text,text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_invoice_snapshot(uuid,text,text,text,text,uuid,integer,text,text,bigint,bigint,timestamptz,timestamptz,text,text,uuid,bigint,text,text) to service_role;

-- Return only the exact current projection head needed for conflict resolution.
-- Replayed Stripe events may use a new snapshot-attempt UUID, while the invoice
-- projection intentionally retains the already-applied head. Callers must not
-- reconstruct that head from their latest request ID.
create function public.service_read_form_coach_invoice_current_head(
  p_invoice_id text,p_subscription_id text,p_payer_id uuid,p_contract_version integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare invoice_row public.feature_subscription_invoice_current%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_invoice_id),'') is null or nullif(trim(p_subscription_id),'') is null
    or p_payer_id is null or p_contract_version is null or p_contract_version<1 then
    raise exception 'Invalid invoice projection identity' using errcode='22023';
  end if;
  select * into invoice_row from public.feature_subscription_invoice_current i
    where i.invoice_id=p_invoice_id and i.feature_key='form_coach'
      and i.subscription_id=p_subscription_id and i.payer_id=p_payer_id
      and i.contract_version=p_contract_version
      and exists(select 1 from public.feature_invoice_snapshot_attempts a
        where a.invoice_id=i.invoice_id and a.payer_id=i.payer_id
          and a.internal_event_id=i.last_event_id and a.outcome='applied'
          and a.resulting_invoice_revision=i.state_revision);
  if not found then return null; end if;
  return jsonb_build_object(
    'invoice_id',invoice_row.invoice_id,
    'subscription_id',invoice_row.subscription_id,
    'payer_id',invoice_row.payer_id,
    'contract_version',invoice_row.contract_version,
    'status',invoice_row.status,
    'currency',invoice_row.currency,
    'amount_due_cents',invoice_row.amount_due_cents,
    'amount_paid_cents',invoice_row.amount_paid_cents,
    'period_start_epoch',floor(extract(epoch from invoice_row.period_start))::bigint,
    'period_end_epoch',floor(extract(epoch from invoice_row.period_end))::bigint,
    'payment_intent_id',invoice_row.payment_intent_id,
    'charge_id',invoice_row.charge_id,
    'trial_claim_id',invoice_row.trial_claim_id,
    'last_event_id',invoice_row.last_event_id,
    'state_revision',invoice_row.state_revision
  );
end;
$$;
revoke all on function public.service_read_form_coach_invoice_current_head(text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.service_read_form_coach_invoice_current_head(text,text,uuid,integer) to service_role;

create function public.service_resolve_form_coach_billing_conflicts(
  p_request_id uuid,p_payer_id uuid,p_resource_kind text,p_resource_id text,
  p_expected_revision bigint,p_observed_at timestamptz,p_evidence jsonb,p_evidence_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare conflict_row public.feature_billing_conflict_events%rowtype;
  existing public.feature_billing_conflict_resolutions%rowtype;
  reservation public.feature_checkout_reservations%rowtype;
  checkout_attestation public.feature_checkout_terminal_attestations%rowtype;
  subscription public.feature_subscriptions%rowtype;
  invoice_row public.feature_subscription_invoice_current%rowtype;
  unresolved boolean:=false; found_conflict boolean:=false; inserted_count integer:=0;
  observed_status text; payment_status_value text; current_revision bigint;
  provider_invoice_count bigint; provider_pi_count bigint; database_invoice_count bigint; database_pi_count bigint; database_charge_count bigint;
  database_invoice_ids_digest text; database_pi_ids_digest text; database_charge_ids_digest text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_payer_id is null or p_resource_kind is null
    or p_resource_kind not in ('checkout_session','subscription','invoice')
    or nullif(trim(p_resource_id),'') is null or p_observed_at is null
    or p_observed_at>clock_timestamp()+interval '1 minute'
    or p_evidence is null or jsonb_typeof(p_evidence)<>'object'
    or octet_length(p_evidence::text)>8192 or p_evidence_digest is null or p_evidence_digest !~ '^[a-f0-9]{64}$'
    or p_expected_revision is not null and p_expected_revision<0 then
    raise exception 'Invalid current billing conflict evidence' using errcode='22023';
  end if;
  -- Match account-deletion ingress before any mutable-row reads or legacy locks.
  if not private.form_coach_try_account_payer_locks(p_payer_id) then
    return 'retryable_account_serialization';
  end if;
  if not exists(select 1 from public.feature_billing_conflict_events c
    where c.feature_key='form_coach' and c.payer_id=p_payer_id and c.object_id=p_resource_id) then
    return 'not_found';
  end if;

  observed_status:=p_evidence->>'status';
  payment_status_value:=p_evidence->>'paymentStatus';
  if p_resource_kind='checkout_session' then
    if not (p_evidence ?& array['reservationId','customerId','mode','status','paymentStatus','amountTotal','currency',
      'paymentIntentId','paymentIntentStatus','paymentIntentAmountReceived','paymentIntentCurrency','subscriptionId',
      'outstandingInvoiceCount','activePaymentIntentCount'])
      or p_evidence - array['reservationId','customerId','mode','status','paymentStatus','amountTotal','currency',
        'paymentIntentId','paymentIntentStatus','paymentIntentAmountReceived','paymentIntentCurrency','subscriptionId',
        'outstandingInvoiceCount','activePaymentIntentCount']<>'{}'::jsonb
      or nullif(trim(p_evidence->>'reservationId'),'') is null or nullif(trim(p_evidence->>'customerId'),'') is null
      or coalesce(p_evidence->>'mode','') not in ('payment','subscription')
      or coalesce(observed_status,'') not in ('expired','complete') or coalesce(payment_status_value,'') not in ('unpaid','paid')
      or coalesce(p_evidence->>'amountTotal','') !~ '^[0-9]{1,12}$'
      or coalesce(p_evidence->>'currency','') !~ '^[A-Z]{3}$'
      or coalesce(p_evidence->>'outstandingInvoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or (p_evidence->>'outstandingInvoiceCount')::integer<>0
      or coalesce(p_evidence->>'activePaymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or (p_evidence->>'activePaymentIntentCount')::integer<>0 then return 'incomplete'; end if;
    select * into reservation from public.feature_checkout_reservations r
      where r.id=(p_evidence->>'reservationId')::uuid and r.feature_key='form_coach'
        and r.payer_id=p_payer_id and r.stripe_checkout_session_id=p_resource_id
        and r.state='expired';
    if not found then return 'identity_mismatch'; end if;
    select * into checkout_attestation from public.feature_checkout_terminal_attestations a
      where a.reservation_id=reservation.id and a.request_id=reservation.request_id;
    if not found or checkout_attestation.stripe_checkout_session_id<>p_resource_id
      or checkout_attestation.stripe_customer_id<>reservation.stripe_customer_id
      or checkout_attestation.payer_id<>p_payer_id or checkout_attestation.session_status<>'expired'
      or checkout_attestation.payment_status<>'unpaid'
      or p_evidence->>'customerId'<>reservation.stripe_customer_id
      or p_evidence->>'mode'<>checkout_attestation.session_mode
      or (p_evidence->>'amountTotal')::bigint<>reservation.total_amount_cents
      or p_evidence->>'currency'<>reservation.currency then return 'identity_mismatch'; end if;
    if not ((observed_status='expired' and payment_status_value='unpaid'
        and coalesce(p_evidence->>'paymentIntentId','')=''
        and coalesce(p_evidence->>'paymentIntentStatus','')='')
      or (observed_status='complete' and payment_status_value='paid' and p_evidence->>'mode'='payment'
        and reservation.credits_per_pack is not null
        and nullif(trim(p_evidence->>'paymentIntentId'),'') is not null
        and coalesce(p_evidence->>'paymentIntentStatus','')='succeeded'
        and coalesce(p_evidence->>'paymentIntentAmountReceived','') ~ '^[0-9]{1,12}$'
        and (p_evidence->>'paymentIntentAmountReceived')::bigint=reservation.total_amount_cents
        and coalesce(p_evidence->>'paymentIntentCurrency','')=reservation.currency
        and coalesce(p_evidence->>'subscriptionId','')='')) then return 'incomplete'; end if;
  elsif p_resource_kind='subscription' then
    if not (p_evidence ?& array['customerId','status','expectedRevision','invoiceCount','outstandingInvoiceCount',
      'paymentIntentCount','activePaymentIntentCount','chargeCount','invoicePaymentCount','invoicePaymentInventoryDigest',
      'invoiceIdsDigest','paymentIntentIdsDigest','chargeIdsDigest',
      'invoiceInventoryDigest','paymentIntentInventoryDigest','chargeInventoryDigest'])
      or p_evidence - array['customerId','status','expectedRevision','invoiceCount','outstandingInvoiceCount',
        'paymentIntentCount','activePaymentIntentCount','chargeCount','invoicePaymentCount','invoicePaymentInventoryDigest',
        'invoiceIdsDigest','paymentIntentIdsDigest','chargeIdsDigest',
        'invoiceInventoryDigest','paymentIntentInventoryDigest','chargeInventoryDigest']<>'{}'::jsonb
      or coalesce(observed_status,'') not in ('canceled','incomplete_expired') or p_expected_revision is null
      or coalesce(p_evidence->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,17})$'
      or (p_evidence->>'expectedRevision')::bigint<>p_expected_revision
      or coalesce(p_evidence->>'outstandingInvoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'activePaymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'invoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'paymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'chargeCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'invoicePaymentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'invoicePaymentInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'invoiceIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'paymentIntentIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'chargeIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'invoiceInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'paymentIntentInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'chargeInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or (p_evidence->>'outstandingInvoiceCount')::integer<>0
      or (p_evidence->>'activePaymentIntentCount')::integer<>0 then return 'incomplete'; end if;
    select * into subscription from public.feature_subscriptions s
      where s.stripe_subscription_id=p_resource_id and s.feature_key='form_coach' and s.payer_id=p_payer_id for update;
    if not found or subscription.stripe_customer_id is distinct from p_evidence->>'customerId'
      or subscription.state_revision<>p_expected_revision then return 'stale'; end if;
    select count(*),encode(sha256(convert_to(coalesce(string_agg(i.invoice_id,chr(10) order by i.invoice_id),''),'UTF8')),'hex')
      into database_invoice_count,database_invoice_ids_digest
      from public.feature_subscription_invoice_current i
      where i.subscription_id=p_resource_id and i.payer_id=p_payer_id and i.feature_key='form_coach';
    select count(*),encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      into database_pi_count,database_pi_ids_digest
      from public.feature_billing_provider_aliases a
      where a.subscription_id=p_resource_id and a.payer_id=p_payer_id and a.object_kind='payment_intent';
    select count(*),encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      into database_charge_count,database_charge_ids_digest
      from public.feature_billing_provider_aliases a
      where a.subscription_id=p_resource_id and a.payer_id=p_payer_id and a.object_kind='charge';
    if database_invoice_count<>(p_evidence->>'invoiceCount')::bigint
      or database_pi_count<>(p_evidence->>'paymentIntentCount')::bigint
      or database_charge_count<>(p_evidence->>'chargeCount')::bigint
      or database_invoice_ids_digest is distinct from p_evidence->>'invoiceIdsDigest'
      or database_pi_ids_digest is distinct from p_evidence->>'paymentIntentIdsDigest'
      or database_charge_ids_digest is distinct from p_evidence->>'chargeIdsDigest'
      or exists(select 1 from public.feature_subscription_invoice_current i
        where i.subscription_id=p_resource_id and i.payer_id=p_payer_id and i.feature_key='form_coach'
          and (i.status not in ('paid','void') or not exists(select 1 from public.feature_invoice_snapshot_attempts a
            where a.invoice_id=i.invoice_id and a.payer_id=p_payer_id and a.internal_event_id=i.last_event_id
              and a.outcome='applied' and a.resulting_invoice_revision=i.state_revision))) then return 'incomplete'; end if;
    if subscription.status is distinct from observed_status then
      update public.feature_subscriptions set status=observed_status,cancel_at_period_end=false,
        state_revision=state_revision+1,updated_at=now()
        where stripe_subscription_id=p_resource_id and payer_id=p_payer_id and state_revision=p_expected_revision;
      if not found then return 'stale'; end if;
    end if;
  elsif p_resource_kind='invoice' then
    if not (p_evidence ?& array['subscriptionId','customerId','status','currency','amountDueCents','amountPaidCents',
      'expectedRevision','currentEventId','invoiceCount','outstandingInvoiceCount','paymentIntentCount','activePaymentIntentCount','chargeCount',
      'invoicePaymentCount','invoicePaymentInventoryDigest',
      'invoiceIdsDigest','paymentIntentIdsDigest','chargeIdsDigest','invoiceInventoryDigest','paymentIntentInventoryDigest','chargeInventoryDigest'])
      or p_evidence - array['subscriptionId','customerId','status','currency','amountDueCents','amountPaidCents',
        'expectedRevision','currentEventId','invoiceCount','outstandingInvoiceCount','paymentIntentCount','activePaymentIntentCount','chargeCount',
        'invoicePaymentCount','invoicePaymentInventoryDigest',
        'invoiceIdsDigest','paymentIntentIdsDigest','chargeIdsDigest','invoiceInventoryDigest','paymentIntentInventoryDigest','chargeInventoryDigest']<>'{}'::jsonb
      or coalesce(observed_status,'') not in ('paid','void') or p_expected_revision is null
      or coalesce(p_evidence->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,17})$'
      or (p_evidence->>'expectedRevision')::bigint<>p_expected_revision
      or coalesce(p_evidence->>'currency','') !~ '^[A-Z]{3}$'
      or coalesce(p_evidence->>'amountDueCents','') !~ '^(0|[1-9][0-9]{0,17})$'
      or coalesce(p_evidence->>'amountPaidCents','') !~ '^(0|[1-9][0-9]{0,17})$'
      or coalesce(p_evidence->>'invoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'paymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'chargeCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'invoicePaymentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'outstandingInvoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'activePaymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
      or coalesce(p_evidence->>'invoiceIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'paymentIntentIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'chargeIdsDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'invoiceInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'paymentIntentInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'chargeInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or coalesce(p_evidence->>'invoicePaymentInventoryDigest','') !~ '^[a-f0-9]{64}$'
      or (p_evidence->>'outstandingInvoiceCount')::integer<>0
      or (p_evidence->>'activePaymentIntentCount')::integer<>0 then return 'incomplete'; end if;
    select * into invoice_row from public.feature_subscription_invoice_current i
      where i.invoice_id=p_resource_id and i.payer_id=p_payer_id and i.feature_key='form_coach' for update;
    if not found or invoice_row.subscription_id is distinct from p_evidence->>'subscriptionId'
      or invoice_row.state_revision<>p_expected_revision or invoice_row.status<>observed_status
      or invoice_row.currency<>p_evidence->>'currency'
      or invoice_row.amount_due_cents<>(p_evidence->>'amountDueCents')::bigint
      or invoice_row.amount_paid_cents<>(p_evidence->>'amountPaidCents')::bigint
      or invoice_row.last_event_id is distinct from p_evidence->>'currentEventId'
      or (observed_status='paid' and invoice_row.amount_paid_cents<>invoice_row.amount_due_cents)
      or (observed_status='void' and invoice_row.amount_paid_cents<>0)
      or not exists(select 1 from public.feature_invoice_snapshot_attempts a
        where a.invoice_id=p_resource_id and a.payer_id=p_payer_id and a.internal_event_id=invoice_row.last_event_id
          and a.outcome='applied' and a.resulting_invoice_revision=invoice_row.state_revision) then return 'stale'; end if;
    if not exists(select 1 from public.feature_subscriptions s
        where s.stripe_subscription_id=invoice_row.subscription_id and s.feature_key='form_coach'
          and s.payer_id=p_payer_id and s.stripe_customer_id=p_evidence->>'customerId') then
      return 'identity_mismatch';
    end if;
    select count(*),encode(sha256(convert_to(coalesce(string_agg(i.invoice_id,chr(10) order by i.invoice_id),''),'UTF8')),'hex')
      into database_invoice_count,database_invoice_ids_digest
      from public.feature_subscription_invoice_current i
      join public.feature_subscriptions s on s.stripe_subscription_id=i.subscription_id
        and s.payer_id=i.payer_id and s.feature_key=i.feature_key
      where i.subscription_id=p_evidence->>'subscriptionId' and i.payer_id=p_payer_id and i.feature_key='form_coach'
        and s.stripe_customer_id=p_evidence->>'customerId';
    select count(*),encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      into database_pi_count,database_pi_ids_digest
      from public.feature_billing_provider_aliases a
      join public.feature_subscriptions s on s.stripe_subscription_id=a.subscription_id
        and s.payer_id=a.payer_id and s.feature_key=a.feature_key
      where a.subscription_id=p_evidence->>'subscriptionId' and a.payer_id=p_payer_id
        and a.feature_key='form_coach' and a.object_kind='payment_intent'
        and s.stripe_customer_id=p_evidence->>'customerId';
    select count(*),encode(sha256(convert_to(coalesce(string_agg(a.object_id,chr(10) order by a.object_id),''),'UTF8')),'hex')
      into database_charge_count,database_charge_ids_digest
      from public.feature_billing_provider_aliases a
      join public.feature_subscriptions s on s.stripe_subscription_id=a.subscription_id
        and s.payer_id=a.payer_id and s.feature_key=a.feature_key
      where a.subscription_id=p_evidence->>'subscriptionId' and a.payer_id=p_payer_id
        and a.feature_key='form_coach' and a.object_kind='charge' and s.stripe_customer_id=p_evidence->>'customerId';
    if database_invoice_count<>(p_evidence->>'invoiceCount')::bigint
      or database_pi_count<>(p_evidence->>'paymentIntentCount')::bigint
      or database_charge_count<>(p_evidence->>'chargeCount')::bigint
      or database_invoice_ids_digest is distinct from p_evidence->>'invoiceIdsDigest'
      or database_pi_ids_digest is distinct from p_evidence->>'paymentIntentIdsDigest'
      or database_charge_ids_digest is distinct from p_evidence->>'chargeIdsDigest'
      or exists(select 1 from public.feature_subscription_invoice_current i
        where i.subscription_id=p_evidence->>'subscriptionId' and i.payer_id=p_payer_id and i.feature_key='form_coach'
          and (i.status not in ('paid','void') or not exists(select 1 from public.feature_invoice_snapshot_attempts a
            where a.invoice_id=i.invoice_id and a.payer_id=p_payer_id and a.internal_event_id=i.last_event_id
              and a.outcome='applied' and a.resulting_invoice_revision=i.state_revision))) then return 'incomplete'; end if;
  end if;

  for conflict_row in select c.* from public.feature_billing_conflict_events c
    where c.feature_key='form_coach' and c.payer_id=p_payer_id and c.object_id=p_resource_id
    order by c.event_id for update
  loop
    found_conflict:=true;
    if p_observed_at<=conflict_row.recorded_at then unresolved:=true; continue; end if;
    if conflict_row.conflict_kind<>(
      case when p_resource_kind='checkout_session' then 'payment_after_terminal'
           when p_resource_kind='subscription' then 'subscription_after_terminal'
           else 'payment_after_terminal' end)
      or (p_resource_kind='checkout_session' and conflict_row.reservation_id is distinct from (p_evidence->>'reservationId')::uuid) then
      unresolved:=true; continue;
    end if;
    select * into existing from public.feature_billing_conflict_resolutions r
      where r.conflict_event_id=conflict_row.event_id;
    if found then
      if (existing.payer_id,existing.resource_kind,existing.resource_id,existing.conflict_identity_digest,existing.evidence_digest,existing.evidence)
        is distinct from (p_payer_id,p_resource_kind,p_resource_id,conflict_row.identity_digest,p_evidence_digest,p_evidence) then
        return 'conflict';
      end if;
      continue;
    end if;
    insert into public.feature_billing_conflict_resolutions(
      conflict_event_id,feature_key,payer_id,resource_kind,resource_id,conflict_identity_digest,evidence_digest,observed_at,evidence,request_id
    ) values(conflict_row.event_id,'form_coach',p_payer_id,p_resource_kind,p_resource_id,
      conflict_row.identity_digest,p_evidence_digest,p_observed_at,p_evidence,p_request_id);
    inserted_count:=inserted_count+1;
  end loop;
  if not found_conflict then return 'not_found'; end if;
  if unresolved then return 'incomplete'; end if;
  return case when inserted_count>0 then 'recorded' else 'already_resolved' end;
end;
$$;
revoke all on function public.service_resolve_form_coach_billing_conflicts(uuid,uuid,text,text,bigint,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.service_resolve_form_coach_billing_conflicts(uuid,uuid,text,text,bigint,timestamptz,jsonb,text) to service_role;

create function private.form_coach_customer_local_resource_digest(target_payer_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'checkouts',coalesce((select jsonb_agg(jsonb_build_array(r.id,r.request_id,r.state,r.stripe_checkout_session_id,
      r.stripe_customer_id,r.stripe_subscription_id) order by r.id)
      from public.feature_checkout_reservations r where r.feature_key='form_coach' and r.payer_id=target_payer_id),'[]'::jsonb),
    'subscriptions',coalesce((select jsonb_agg(jsonb_build_array(s.stripe_subscription_id,s.status,s.state_revision,
      s.stripe_customer_id,s.current_period_end) order by s.stripe_subscription_id)
      from public.feature_subscriptions s where s.feature_key='form_coach' and s.payer_id=target_payer_id),'[]'::jsonb),
    'invoices',coalesce((select jsonb_agg(jsonb_build_array(i.invoice_id,i.status,i.state_revision,i.last_event_id,
      i.amount_due_cents,i.amount_paid_cents) order by i.invoice_id)
      from public.feature_subscription_invoice_current i where i.feature_key='form_coach' and i.payer_id=target_payer_id),'[]'::jsonb),
    'invoiceAttempts',coalesce((select jsonb_agg(jsonb_build_array(a.request_id,a.outcome,a.state_revision,
      a.resulting_invoice_revision,a.internal_event_id) order by a.request_id)
      from public.feature_invoice_snapshot_attempts a where a.payer_id=target_payer_id),'[]'::jsonb),
    'refunds',coalesce((select jsonb_agg(jsonb_build_array(s.event_id,s.state,s.state_revision) order by s.event_id)
      from public.feature_subscription_refund_event_state s
      join public.feature_subscription_refund_events e on e.event_id=s.event_id
      where e.payer_id=target_payer_id),'[]'::jsonb),
    'conflicts',coalesce((select jsonb_agg(jsonb_build_array(c.event_id,c.object_id,c.identity_digest,
      r.evidence_digest) order by c.event_id)
      from public.feature_billing_conflict_events c left join public.feature_billing_conflict_resolutions r
        on r.conflict_event_id=c.event_id
      where c.feature_key='form_coach' and c.payer_id=target_payer_id),'[]'::jsonb),
    'customerAttempts',coalesce((select jsonb_agg(jsonb_build_array(a.id,a.state,a.state_revision,a.stripe_customer_id)
      order by a.id) from public.feature_customer_create_attempts a
      where a.feature_key='form_coach' and a.payer_id=target_payer_id),'[]'::jsonb),
    'customerMappings',coalesce((select jsonb_agg(jsonb_build_array(m.stripe_customer_id,m.create_attempt_id,m.verified_at)
      order by m.stripe_customer_id) from public.feature_payer_customer_mappings m
      where m.feature_key='form_coach' and m.payer_id=target_payer_id),'[]'::jsonb),
    'receipts',coalesce((select jsonb_agg(jsonb_build_array(p.id,p.reservation_id,p.payment_object_id,p.disposition)
      order by p.id) from public.feature_payment_receipts p
      where p.feature_key='form_coach' and p.payer_id=target_payer_id),'[]'::jsonb),
    'trialRegistrations',coalesce((select jsonb_agg(jsonb_build_array(t.request_id,t.stripe_checkout_session_id,
      t.stripe_subscription_id,t.stripe_invoice_id) order by t.request_id)
      from public.feature_checkout_trial_registrations t where t.payer_id=target_payer_id),'[]'::jsonb),
    'trialTerminals',coalesce((select jsonb_agg(jsonb_build_array(t.request_id,t.stripe_checkout_session_id,
      t.stripe_subscription_id,t.terminal_evidence_digest) order by t.request_id)
      from public.feature_checkout_trial_terminal_attestations t where t.payer_id=target_payer_id),'[]'::jsonb),
    'checkoutTerminals',coalesce((select jsonb_agg(jsonb_build_array(t.request_id,t.stripe_checkout_session_id,
      t.evidence_digest) order by t.request_id)
      from public.feature_checkout_terminal_attestations t where t.payer_id=target_payer_id),'[]'::jsonb)
  )::text,'UTF8')),'hex');
$$;
revoke all on function private.form_coach_customer_local_resource_digest(uuid) from public,anon,authenticated,service_role;

create function private.form_coach_customer_resources_clear(target_payer_id uuid,target_customer_id text,target_attempt_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.feature_payer_customer_mappings m
      join public.feature_customer_create_attempts c on c.id=m.create_attempt_id
      join public.feature_provider_objects o on o.feature_key=m.feature_key and o.object_type='customer'
        and o.object_id=m.stripe_customer_id
      where m.feature_key='form_coach' and m.payer_id=target_payer_id and m.stripe_customer_id=target_customer_id
        and m.create_attempt_id=target_attempt_id and c.feature_key='form_coach' and c.payer_id=target_payer_id
        and c.stripe_customer_id=target_customer_id and c.state='verified' and o.payer_id=target_payer_id)
    and (select count(*) from public.feature_payer_customer_mappings m
      where m.feature_key='form_coach' and m.payer_id=target_payer_id)=1
    and not exists(select 1 from public.feature_checkout_reservations r
      where r.feature_key='form_coach' and r.payer_id=target_payer_id
        and r.state in ('reserved','unknown','bound','cancel_required'))
    and not exists(select 1 from public.feature_subscriptions s
      where s.feature_key='form_coach' and s.payer_id=target_payer_id
        and s.status not in ('canceled','incomplete_expired'))
    and not exists(select 1 from public.feature_subscription_invoice_current i
      where i.feature_key='form_coach' and i.payer_id=target_payer_id
        and (i.status not in ('paid','void') or not exists(select 1 from public.feature_invoice_snapshot_attempts a
          where a.invoice_id=i.invoice_id and a.payer_id=target_payer_id and a.internal_event_id=i.last_event_id
            and a.outcome='applied' and a.resulting_invoice_revision=i.state_revision)))
    and not exists(select 1 from public.feature_invoice_snapshot_attempts a
      where a.payer_id=target_payer_id and (
        a.outcome in ('mismatch','manual_review')
        or (a.outcome in ('received','retryable','stale','blocked_deletion') and not (
          exists(select 1 from public.feature_subscription_invoice_current i
            where i.invoice_id=a.invoice_id and i.payer_id=target_payer_id and exists(
              select 1 from public.feature_invoice_snapshot_attempts applied
              where applied.invoice_id=i.invoice_id and applied.payer_id=target_payer_id
                and applied.internal_event_id=i.last_event_id and applied.outcome='applied'
                and applied.resulting_invoice_revision=i.state_revision))
          or (a.outcome='blocked_deletion' and a.snapshot_status='paid'
            and a.amount_due_cents=0 and a.amount_paid_cents=0
            and exists(select 1 from public.feature_checkout_trial_registrations tr
              join public.feature_checkout_trial_terminal_attestations terminal on terminal.request_id=tr.request_id
              where tr.payer_id=target_payer_id and tr.stripe_invoice_id=a.invoice_id
                and tr.stripe_subscription_id=a.subscription_id and terminal.payer_id=target_payer_id
                and terminal.stripe_subscription_id=a.subscription_id))))))
    and not exists(select 1 from public.feature_subscription_refund_event_state s
      join public.feature_subscription_refund_events e on e.event_id=s.event_id
      where e.payer_id=target_payer_id and s.state<>'applied')
    and not exists(select 1 from public.feature_billing_conflict_events c
      where c.feature_key='form_coach' and c.payer_id=target_payer_id
        and not exists(select 1 from public.feature_billing_conflict_resolutions r
          where r.conflict_event_id=c.event_id and r.feature_key=c.feature_key and r.payer_id=c.payer_id
            and r.resource_id=c.object_id and r.conflict_identity_digest=c.identity_digest))
    and not exists(select 1 from public.feature_customer_create_attempts a
      where a.feature_key='form_coach' and a.payer_id=target_payer_id
        and a.id<>target_attempt_id and a.state in ('reserved','unknown','bound','cancel_required'));
$$;
revoke all on function private.form_coach_customer_resources_clear(uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.service_reserve_form_coach_customer_retirement(
  p_request_id uuid,p_payer_id uuid,p_customer_id text,p_create_attempt_id uuid,p_tombstone_id uuid,
  p_tombstone_revision bigint,p_stripe_account_id text,p_livemode boolean,p_customer_metadata jsonb,
  p_inventory_summary jsonb,p_customer_identity_digest text,p_inventory_digest text,p_request_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare existing public.feature_form_coach_customer_retirement_intents%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype; attempt public.feature_customer_create_attempts%rowtype;
  mapped public.feature_payer_customer_mappings%rowtype; expected_metadata jsonb; expected_identity text;
  expected_request text; local_digest text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_payer_id is null or p_create_attempt_id is null or p_tombstone_id is null
    or p_tombstone_revision is null or p_tombstone_revision<1
    or nullif(trim(p_customer_id),'') is null or char_length(p_customer_id)>255
    or nullif(trim(p_stripe_account_id),'') is null or char_length(p_stripe_account_id)>255
    or p_livemode is null or p_customer_metadata is null or jsonb_typeof(p_customer_metadata)<>'object'
    or p_inventory_summary is null or jsonb_typeof(p_inventory_summary)<>'object'
    or octet_length(p_inventory_summary::text)>8192
    or p_customer_identity_digest is null or p_customer_identity_digest !~ '^[a-f0-9]{64}$'
    or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$'
    or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Customer retirement intent is invalid' using errcode='22023'; end if;
  expected_metadata:=jsonb_build_object('feature_namespace','form_coach','feature_key','form_coach',
    'payer_id',p_payer_id::text,'customer_create_attempt_id',p_create_attempt_id::text);
  expected_identity:=encode(sha256(convert_to('form_coach:'||p_payer_id::text||':'||p_customer_id||':'||
    p_create_attempt_id::text||':'||p_stripe_account_id||':'||p_livemode::text,'UTF8')),'hex');
  expected_request:=encode(sha256(convert_to(p_request_id::text||':'||p_customer_identity_digest||':'||
    p_inventory_digest||':'||p_tombstone_id::text||':'||p_tombstone_revision::text,'UTF8')),'hex');
  if p_customer_metadata<>expected_metadata or p_customer_identity_digest<>expected_identity
    or p_request_digest<>expected_request then return 'identity_mismatch'; end if;
  if not (p_inventory_summary ?& array['complete','hasMore','customerId','stripeAccountId','livemode',
      'checkoutSessionCount','subscriptionCount','invoiceCount','invoicePaymentCount','paymentIntentCount','chargeCount','refundCount',
      'activeCheckoutSessionCount','activeSubscriptionCount','collectibleInvoiceCount','activePaymentIntentCount',
      'unresolvedRefundCount','unresolvedCreateCount','resourceIdsDigest'])
    or p_inventory_summary-array['complete','hasMore','customerId','stripeAccountId','livemode',
      'checkoutSessionCount','subscriptionCount','invoiceCount','invoicePaymentCount','paymentIntentCount','chargeCount','refundCount',
      'activeCheckoutSessionCount','activeSubscriptionCount','collectibleInvoiceCount','activePaymentIntentCount',
      'unresolvedRefundCount','unresolvedCreateCount','resourceIdsDigest']<>'{}'::jsonb
    or p_inventory_summary->>'complete' is distinct from 'true'
    or p_inventory_summary->>'hasMore' is distinct from 'false'
    or p_inventory_summary->>'customerId' is distinct from p_customer_id
    or p_inventory_summary->>'stripeAccountId' is distinct from p_stripe_account_id
    or p_inventory_summary->>'livemode' is distinct from p_livemode::text
    or coalesce(p_inventory_summary->>'resourceIdsDigest','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_inventory_summary->>'checkoutSessionCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'subscriptionCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'invoiceCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'invoicePaymentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'paymentIntentCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'chargeCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'refundCount','') !~ '^(0|[1-9][0-9]{0,5})$'
    or coalesce(p_inventory_summary->>'activeCheckoutSessionCount','') !~ '^0$'
    or coalesce(p_inventory_summary->>'activeSubscriptionCount','') !~ '^0$'
    or coalesce(p_inventory_summary->>'collectibleInvoiceCount','') !~ '^0$'
    or coalesce(p_inventory_summary->>'activePaymentIntentCount','') !~ '^0$'
    or coalesce(p_inventory_summary->>'unresolvedRefundCount','') !~ '^0$'
    or coalesce(p_inventory_summary->>'unresolvedCreateCount','') !~ '^0$' then return 'inventory_incomplete'; end if;

  if not private.form_coach_try_account_payer_locks(p_payer_id) then
    return 'retryable_account_serialization'; end if;
  select * into existing from public.feature_form_coach_customer_retirement_intents i
    where i.request_id=p_request_id for share;
  if found then
    if (existing.payer_id,existing.customer_id,existing.create_attempt_id,existing.tombstone_id,existing.tombstone_revision,
        existing.stripe_account_id,existing.livemode,existing.customer_identity_digest,existing.inventory_digest,existing.inventory_summary,existing.request_digest)
      is distinct from (p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,p_tombstone_revision,
        p_stripe_account_id,p_livemode,p_customer_identity_digest,p_inventory_digest,p_inventory_summary,p_request_digest) then
      return 'conflict'; end if;
    return 'already_reserved';
  end if;
  if exists(select 1 from public.feature_form_coach_customer_retirement_intents i
      where i.feature_key='form_coach' and i.payer_id=p_payer_id
        and (i.customer_id=p_customer_id or i.create_attempt_id=p_create_attempt_id)) then return 'retirement_pending'; end if;
  select * into tombstone from public.stream_media_account_tombstones t
    where t.id=p_tombstone_id and t.account_id=p_payer_id for share;
  if not found or tombstone.revision<>p_tombstone_revision or tombstone.tombstone_state not in ('closing','provider_cleanup') then
    return 'tombstone_stale'; end if;
  select * into mapped from public.feature_payer_customer_mappings m
    where m.feature_key='form_coach' and m.payer_id=p_payer_id for share;
  select * into attempt from public.feature_customer_create_attempts a where a.id=p_create_attempt_id for share;
  if not found or mapped.stripe_customer_id is distinct from p_customer_id or mapped.create_attempt_id is distinct from p_create_attempt_id
    or attempt.feature_key<>'form_coach' or attempt.payer_id<>p_payer_id or attempt.stripe_customer_id<>p_customer_id
    or attempt.state<>'verified' then return 'identity_mismatch'; end if;
  if not private.form_coach_customer_resources_clear(p_payer_id,p_customer_id,p_create_attempt_id) then
    return 'inventory_incomplete'; end if;
  local_digest:=private.form_coach_customer_local_resource_digest(p_payer_id);
  insert into public.feature_form_coach_customer_retirement_intents(
    request_id,feature_key,payer_id,customer_id,create_attempt_id,tombstone_id,tombstone_revision,stripe_account_id,
    livemode,customer_identity_digest,inventory_digest,inventory_summary,local_resource_digest,request_digest
  ) values(p_request_id,'form_coach',p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,p_tombstone_revision,
    p_stripe_account_id,p_livemode,p_customer_identity_digest,p_inventory_digest,p_inventory_summary,local_digest,p_request_digest);
  return 'reserved';
end;
$$;
revoke all on function public.service_reserve_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.service_reserve_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,jsonb,jsonb,text,text,text) to service_role;

create function public.service_record_form_coach_customer_retirement(
  p_request_id uuid,p_payer_id uuid,p_customer_id text,p_create_attempt_id uuid,p_tombstone_id uuid,
  p_tombstone_revision bigint,p_stripe_account_id text,p_livemode boolean,p_inventory_digest text,
  p_http_status integer,p_provider_deleted boolean,p_observed_at timestamptz,p_evidence_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare intent public.feature_form_coach_customer_retirement_intents%rowtype;
  existing public.feature_form_coach_customer_retirement_proofs%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype; mapped public.feature_payer_customer_mappings%rowtype;
  attempt public.feature_customer_create_attempts%rowtype; local_digest text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_payer_id is null or p_create_attempt_id is null or p_tombstone_id is null
    or p_tombstone_revision is null or p_tombstone_revision<1
    or nullif(trim(p_customer_id),'') is null or nullif(trim(p_stripe_account_id),'') is null
    or p_livemode is null or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$'
    or p_http_status is null or p_provider_deleted is null or p_observed_at is null
    or p_evidence_digest is null or p_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Customer retirement proof is invalid' using errcode='22023'; end if;
  if p_http_status<>200 or not p_provider_deleted then return 'not_deleted'; end if;
  if not private.form_coach_try_account_payer_locks(p_payer_id) then
    return 'retryable_account_serialization'; end if;
  select * into intent from public.feature_form_coach_customer_retirement_intents i
    where i.request_id=p_request_id for share;
  if not found or (intent.payer_id,intent.customer_id,intent.create_attempt_id,intent.tombstone_id,intent.tombstone_revision,
      intent.stripe_account_id,intent.livemode,intent.inventory_digest)
    is distinct from (p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,p_tombstone_revision,
      p_stripe_account_id,p_livemode,p_inventory_digest) then return 'identity_mismatch'; end if;
  select * into existing from public.feature_form_coach_customer_retirement_proofs p
    where p.request_id=p_request_id for share;
  if found then
    if (existing.payer_id,existing.customer_id,existing.create_attempt_id,existing.tombstone_id,existing.tombstone_revision,
        existing.stripe_account_id,existing.livemode,existing.inventory_digest,existing.http_status,existing.provider_deleted,
        existing.observed_at,existing.evidence_digest)
      is distinct from (p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,p_tombstone_revision,
        p_stripe_account_id,p_livemode,p_inventory_digest,p_http_status,p_provider_deleted,p_observed_at,p_evidence_digest) then
      return 'conflict'; end if;
    return 'already_recorded';
  end if;
  select * into tombstone from public.stream_media_account_tombstones t
    where t.id=p_tombstone_id and t.account_id=p_payer_id for share;
  if not found or tombstone.revision<>p_tombstone_revision or tombstone.tombstone_state not in ('closing','provider_cleanup') then
    return 'tombstone_stale'; end if;
  if p_observed_at<intent.created_at or p_observed_at>clock_timestamp()+interval '1 minute' then return 'stale'; end if;
  select * into mapped from public.feature_payer_customer_mappings m
    where m.feature_key='form_coach' and m.payer_id=p_payer_id for share;
  select * into attempt from public.feature_customer_create_attempts a where a.id=p_create_attempt_id for share;
  if not found or mapped.stripe_customer_id is distinct from p_customer_id or mapped.create_attempt_id is distinct from p_create_attempt_id
    or attempt.feature_key<>'form_coach' or attempt.payer_id<>p_payer_id or attempt.stripe_customer_id<>p_customer_id
    or attempt.state<>'verified' then return 'identity_mismatch'; end if;
  local_digest:=private.form_coach_customer_local_resource_digest(p_payer_id);
  if local_digest is distinct from intent.local_resource_digest
    or not private.form_coach_customer_resources_clear(p_payer_id,p_customer_id,p_create_attempt_id) then
    return 'resource_set_changed'; end if;
  insert into public.feature_form_coach_customer_retirement_proofs(
    request_id,feature_key,payer_id,customer_id,create_attempt_id,tombstone_id,tombstone_revision,stripe_account_id,
    livemode,inventory_digest,http_status,provider_deleted,observed_at,evidence_digest
  ) values(p_request_id,'form_coach',p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,p_tombstone_revision,
    p_stripe_account_id,p_livemode,p_inventory_digest,p_http_status,p_provider_deleted,p_observed_at,p_evidence_digest);
  return 'recorded';
end;
$$;
revoke all on function public.service_record_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_customer_retirement(uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,boolean,timestamptz,text) to service_role;

-- A later account-deletion revision can revalidate that the same provider
-- customer remains deleted without issuing another DELETE. This is a separate
-- append-only observation; the original retirement fact is never rewritten.
create function public.service_record_form_coach_customer_retirement_revalidation(
  p_request_id uuid,p_source_request_id uuid,p_payer_id uuid,p_customer_id text,p_create_attempt_id uuid,
  p_tombstone_id uuid,p_tombstone_revision bigint,p_stripe_account_id text,p_livemode boolean,
  p_inventory_digest text,p_http_status integer,p_customer_response_id text,p_provider_deleted boolean,
  p_observed_at timestamptz,p_evidence_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare intent public.feature_form_coach_customer_retirement_intents%rowtype;
  original public.feature_form_coach_customer_retirement_proofs%rowtype;
  existing public.feature_form_coach_customer_retirement_revalidations%rowtype;
  tombstone public.stream_media_account_tombstones%rowtype; mapped public.feature_payer_customer_mappings%rowtype;
  attempt public.feature_customer_create_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_source_request_id is null or p_payer_id is null or p_create_attempt_id is null
    or p_tombstone_id is null or p_tombstone_revision is null or p_tombstone_revision<1
    or nullif(trim(p_customer_id),'') is null or nullif(trim(p_stripe_account_id),'') is null
    or p_livemode is null or p_inventory_digest is null or p_inventory_digest !~ '^[a-f0-9]{64}$'
    or p_http_status is distinct from 200 or p_customer_response_id is distinct from p_customer_id
    or p_provider_deleted is distinct from true or p_observed_at is null
    or p_evidence_digest is null or p_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Customer retirement revalidation is invalid' using errcode='22023'; end if;
  if not private.form_coach_try_account_payer_locks(p_payer_id) then return 'retryable_account_serialization'; end if;
  select * into intent from public.feature_form_coach_customer_retirement_intents i
    where i.request_id=p_source_request_id for share;
  select * into original from public.feature_form_coach_customer_retirement_proofs p
    where p.request_id=p_source_request_id for share;
  if not found or intent.request_id is null or original.request_id is null
    or (intent.payer_id,intent.customer_id,intent.create_attempt_id,intent.tombstone_id,intent.tombstone_revision,
        intent.stripe_account_id,intent.livemode,intent.inventory_digest)
       is distinct from (p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,original.tombstone_revision,
         p_stripe_account_id,p_livemode,p_inventory_digest)
    or (original.payer_id,original.customer_id,original.create_attempt_id,original.tombstone_id,
        original.tombstone_revision,original.stripe_account_id,original.livemode,original.http_status,original.provider_deleted)
       is distinct from (p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,intent.tombstone_revision,
         p_stripe_account_id,p_livemode,200,true) then
    return 'identity_mismatch'; end if;
  if p_tombstone_revision<=original.tombstone_revision then return 'stale'; end if;
  select * into tombstone from public.stream_media_account_tombstones t
    where t.id=p_tombstone_id and t.account_id=p_payer_id for share;
  if not found or tombstone.revision<>p_tombstone_revision or tombstone.tombstone_state not in ('closing','provider_cleanup') then
    return 'tombstone_stale'; end if;
  if p_observed_at<=original.observed_at or p_observed_at>clock_timestamp()+interval '1 minute' then return 'stale'; end if;
  select * into mapped from public.feature_payer_customer_mappings m
    where m.feature_key='form_coach' and m.payer_id=p_payer_id for share;
  select * into attempt from public.feature_customer_create_attempts a where a.id=p_create_attempt_id for share;
  if not found or mapped.stripe_customer_id is distinct from p_customer_id or mapped.create_attempt_id is distinct from p_create_attempt_id
    or attempt.feature_key<>'form_coach' or attempt.payer_id<>p_payer_id or attempt.stripe_customer_id<>p_customer_id
    or attempt.state<>'verified' then return 'identity_mismatch'; end if;
  select * into existing from public.feature_form_coach_customer_retirement_revalidations r
    where r.source_request_id=p_source_request_id and r.tombstone_id=p_tombstone_id
      and r.tombstone_revision=p_tombstone_revision for share;
  if found then
    if (existing.request_id,existing.payer_id,existing.customer_id,existing.create_attempt_id,existing.stripe_account_id,
        existing.livemode,existing.inventory_digest,existing.http_status,existing.customer_response_id,
        existing.provider_deleted,existing.observed_at,existing.evidence_digest)
      is distinct from (p_request_id,p_payer_id,p_customer_id,p_create_attempt_id,p_stripe_account_id,p_livemode,
        p_inventory_digest,p_http_status,p_customer_response_id,p_provider_deleted,p_observed_at,p_evidence_digest) then
      return 'conflict'; end if;
    return 'already_recorded';
  end if;
  insert into public.feature_form_coach_customer_retirement_revalidations(
    request_id,source_request_id,feature_key,payer_id,customer_id,create_attempt_id,tombstone_id,tombstone_revision,
    stripe_account_id,livemode,inventory_digest,http_status,customer_response_id,provider_deleted,observed_at,evidence_digest
  ) values(p_request_id,p_source_request_id,'form_coach',p_payer_id,p_customer_id,p_create_attempt_id,p_tombstone_id,
    p_tombstone_revision,p_stripe_account_id,p_livemode,p_inventory_digest,p_http_status,p_customer_response_id,
    p_provider_deleted,p_observed_at,p_evidence_digest);
  return 'recorded';
end;
$$;
revoke all on function public.service_record_form_coach_customer_retirement_revalidation(uuid,uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,text,boolean,timestamptz,text) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_customer_retirement_revalidation(uuid,uuid,uuid,text,uuid,uuid,bigint,text,boolean,text,integer,text,boolean,timestamptz,text) to service_role;

create function public.service_record_form_coach_billing_cleanup(
  target_tombstone_id uuid,target_revision bigint,target_request_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare account_id uuid; tombstone_state text; current_revision bigint; unresolved_count bigint;
  active_subscription_count bigint; unresolved_customer_count bigint; mapped_customer_count bigint;
  unresolved_invoice_count bigint; unresolved_invoice_attempt_count bigint; unresolved_refund_count bigint; unresolved_conflict_count bigint;
  source_digest text; proof_digest text; proof_result jsonb; proof_state text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if target_tombstone_id is null or target_revision is null or target_revision<1 or target_request_id is null then
    raise exception 'Cleanup proof identity is invalid' using errcode='22023'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001'; end if;
  select t.account_id,t.tombstone_state,t.revision into account_id,tombstone_state,current_revision
    from public.stream_media_account_tombstones t where t.id=target_tombstone_id;
  if not found or current_revision is distinct from target_revision or tombstone_state not in ('closing','provider_cleanup') then
    return 'tombstone_stale'; end if;
  if not private.form_coach_try_account_payer_locks(account_id) then
    proof_state:='unknown';
  else
    select t.tombstone_state,t.revision into tombstone_state,current_revision
      from public.stream_media_account_tombstones t where t.id=target_tombstone_id for share;
    if current_revision is distinct from target_revision or tombstone_state not in ('closing','provider_cleanup') then return 'tombstone_stale'; end if;
    select count(*) into unresolved_count from public.feature_checkout_reservations r
      where r.feature_key='form_coach' and r.payer_id=account_id and r.state in ('reserved','unknown','bound','cancel_required');
    select count(*) into active_subscription_count from public.feature_subscriptions s
      where s.feature_key='form_coach' and s.payer_id=account_id
        and s.status not in ('canceled','incomplete_expired');
    select count(*) into unresolved_invoice_count from public.feature_subscription_invoice_current i
      where i.feature_key='form_coach' and i.payer_id=account_id
        and (i.status not in ('paid','void') or not exists(
          select 1 from public.feature_invoice_snapshot_attempts a
          where a.invoice_id=i.invoice_id and a.payer_id=account_id and a.internal_event_id=i.last_event_id
            and a.outcome='applied' and a.resulting_invoice_revision=i.state_revision));
    select count(*) into unresolved_invoice_attempt_count from public.feature_invoice_snapshot_attempts a
      where a.payer_id=account_id and (
        a.outcome in ('mismatch','manual_review')
        or (a.outcome in ('received','retryable','stale','blocked_deletion') and not (
          exists(select 1 from public.feature_subscription_invoice_current i
            where i.invoice_id=a.invoice_id and i.payer_id=account_id and exists(
              select 1 from public.feature_invoice_snapshot_attempts applied
              where applied.invoice_id=i.invoice_id and applied.payer_id=account_id
                and applied.internal_event_id=i.last_event_id and applied.outcome='applied'
                and applied.resulting_invoice_revision=i.state_revision))
          or (a.outcome='blocked_deletion' and a.snapshot_status='paid'
            and a.amount_due_cents=0 and a.amount_paid_cents=0
            and exists(select 1 from public.feature_checkout_trial_registrations tr
              join public.feature_checkout_trial_terminal_attestations terminal on terminal.request_id=tr.request_id
              where tr.payer_id=account_id and tr.stripe_invoice_id=a.invoice_id
                and tr.stripe_subscription_id=a.subscription_id and terminal.payer_id=account_id
                and terminal.stripe_subscription_id=a.subscription_id)))));
    select
      (select count(*) from public.feature_subscription_refund_event_state s
        join public.feature_subscription_refund_events e on e.event_id=s.event_id
        where e.payer_id=account_id and s.state<>'applied')
      + (select count(*) from public.feature_form_coach_pack_refund_provider_events e
        where e.payer_id=account_id and e.outcome='manual_review')
      into unresolved_refund_count;
    select count(*) into unresolved_conflict_count from public.feature_billing_conflict_events c
      where c.feature_key='form_coach' and c.payer_id=account_id
        and not exists(select 1 from public.feature_billing_conflict_resolutions r
          where r.conflict_event_id=c.event_id and r.feature_key=c.feature_key and r.payer_id=c.payer_id
            and r.resource_id=c.object_id and r.conflict_identity_digest=c.identity_digest);
    select count(*) into unresolved_customer_count from public.feature_customer_create_attempts a
      where a.feature_key='form_coach' and a.payer_id=account_id and a.state in ('reserved','unknown','bound');
    select count(*) into mapped_customer_count from public.feature_payer_customer_mappings m
      where m.feature_key='form_coach' and m.payer_id=account_id
        and not exists(select 1 from public.feature_form_coach_customer_retirement_intents i
          join public.feature_form_coach_customer_retirement_proofs p on p.request_id=i.request_id
          where i.feature_key=m.feature_key and i.payer_id=m.payer_id and i.customer_id=m.stripe_customer_id
            and i.create_attempt_id=m.create_attempt_id and p.feature_key=m.feature_key and p.payer_id=m.payer_id
            and p.customer_id=m.stripe_customer_id and p.create_attempt_id=m.create_attempt_id
            and p.http_status=200 and p.provider_deleted
            and ((p.tombstone_id=target_tombstone_id and p.tombstone_revision=target_revision)
              or exists(select 1 from public.feature_form_coach_customer_retirement_revalidations rv
                where rv.source_request_id=i.request_id and rv.feature_key=i.feature_key and rv.payer_id=i.payer_id
                  and rv.customer_id=i.customer_id and rv.create_attempt_id=i.create_attempt_id
                  and rv.tombstone_id=target_tombstone_id and rv.tombstone_revision=target_revision
                  and rv.stripe_account_id=i.stripe_account_id and rv.livemode=i.livemode
                  and rv.http_status=200 and rv.customer_response_id=i.customer_id and rv.provider_deleted
                  and rv.observed_at>p.observed_at)));
    proof_state:=case when unresolved_count=0 and active_subscription_count=0
      and unresolved_invoice_count=0 and unresolved_invoice_attempt_count=0
      and unresolved_refund_count=0
      and unresolved_conflict_count=0 and unresolved_customer_count=0 and mapped_customer_count=0 then 'ready' else 'incomplete' end;
  end if;
  source_digest:=encode(sha256(convert_to(jsonb_build_object('account',account_id,'tombstone',target_tombstone_id,
    'revision',target_revision,'proof_state',proof_state,'unresolved_checkout',coalesce(unresolved_count,-1),
    'active_subscriptions',coalesce(active_subscription_count,-1),
    'unresolved_invoices',coalesce(unresolved_invoice_count,-1),
    'unresolved_invoice_attempts',coalesce(unresolved_invoice_attempt_count,-1),
    'unresolved_refunds',coalesce(unresolved_refund_count,-1),
    'unresolved_conflicts',coalesce(unresolved_conflict_count,-1),
    'unresolved_customer_attempts',coalesce(unresolved_customer_count,-1),
    'customer_mappings',coalesce(mapped_customer_count,-1))::text,'UTF8')),'hex');
  proof_digest:=encode(sha256(convert_to('form_coach_billing:'||source_digest,'UTF8')),'hex');
  proof_result:=public.record_stream_auth_cleanup_component_proof(
    target_tombstone_id,target_revision,'form_coach_billing',1,1,proof_state,source_digest,proof_digest,target_request_id);
  return proof_result->>'outcome';
end;
$$;
revoke all on function public.service_record_form_coach_billing_cleanup(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_billing_cleanup(uuid,bigint,uuid) to service_role;

insert into public.stream_auth_cleanup_components(component_key,component_version,resource_set_revision,required_for_auth)
values('form_coach_billing',1,1,true)
on conflict(component_key) do nothing;
do $$ begin
  if not exists(select 1 from public.stream_auth_cleanup_components c where c.component_key='form_coach_billing'
    and c.component_version=1 and c.resource_set_revision=1 and c.required_for_auth) then
    raise exception 'Form Coach billing cleanup component registration is incompatible';
  end if;
end $$;

create or replace function private.protect_feature_checkout_terminal_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare has_expired_attestation boolean; has_trial_attestation boolean; has_matching_expired boolean;
  has_matching_trial boolean; has_receipt boolean;
begin
  select exists(select 1 from public.feature_checkout_terminal_attestations a where a.reservation_id=old.id)
    into has_expired_attestation;
  select exists(select 1 from public.feature_checkout_trial_terminal_attestations a where a.reservation_id=old.id)
    into has_trial_attestation;
  if (has_expired_attestation or has_trial_attestation)
    and (new.stripe_checkout_session_id,new.stripe_customer_id,new.stripe_subscription_id)
      is distinct from (old.stripe_checkout_session_id,old.stripe_customer_id,old.stripe_subscription_id) then
    raise exception 'An attested Checkout provider binding is immutable' using errcode='42501';
  end if;
  if new.state is not distinct from old.state then return new; end if;
  if has_expired_attestation and new.state<>'expired' then
    raise exception 'An attested expired Checkout reservation is immutable' using errcode='42501';
  end if;
  if has_trial_attestation and new.state<>'canceled' then
    raise exception 'An attested completed trial reservation is immutable' using errcode='42501';
  end if;
  if new.state='expired' then
    select exists(select 1 from public.feature_checkout_terminal_attestations a
      where a.reservation_id=old.id and a.request_id=old.request_id and a.feature_key=old.feature_key
        and a.payer_id=old.payer_id and a.stripe_checkout_session_id=old.stripe_checkout_session_id
        and a.stripe_customer_id=old.stripe_customer_id and a.session_status='expired'
        and a.payment_status='unpaid'
        and a.session_mode=case when old.credits_per_pack is null then 'subscription' else 'payment' end
        and a.session_metadata=jsonb_build_object('feature_namespace',old.feature_key,'feature_key',old.feature_key,
          'payer_id',old.payer_id::text,'reservation_id',old.id::text,'request_id',old.request_id::text,
          'config_revision',old.config_revision::text,'price_key',old.price_key,'pack_quantity',old.pack_quantity::text)
        and a.line_item_price_id=old.stripe_price_id and a.line_item_quantity=old.pack_quantity)
      into has_matching_expired;
    if not has_matching_expired or old.state<>'bound' then
      raise exception 'A bound Checkout reservation needs exact terminal evidence before expiry' using errcode='42501';
    end if;
    return new;
  end if;
  if new.state='canceled' then
    select exists(select 1 from public.feature_checkout_trial_terminal_attestations a
      join public.feature_checkout_trial_registrations t on t.request_id=a.request_id
      where a.reservation_id=old.id and a.request_id=old.request_id and a.feature_key=old.feature_key
        and a.payer_id=old.payer_id and a.stripe_checkout_session_id=old.stripe_checkout_session_id
        and a.stripe_customer_id=old.stripe_customer_id and a.stripe_subscription_id=old.stripe_subscription_id
        and a.session_status='complete' and a.payment_status='no_payment_required'
        and a.subscription_status in ('canceled','incomplete_expired')
        and a.outstanding_invoice_count=0 and a.active_payment_intent_count=0
        and t.stripe_subscription_id=a.stripe_subscription_id and t.stripe_invoice_id is not null)
      into has_matching_trial;
    if old.state<>'cancel_required' or not has_matching_trial
      or exists(select 1 from public.feature_payment_receipts r where r.reservation_id=old.id) then
      raise exception 'A completed trial needs exact noncollectible provider evidence before cancellation' using errcode='42501';
    end if;
    return new;
  end if;
  if new.state='paid' then
    select exists(select 1 from public.feature_payment_receipts r where r.reservation_id=old.id
      and r.feature_key=old.feature_key and r.request_id=old.request_id and r.payer_id=old.payer_id
      and r.config_revision=old.config_revision and r.price_key=old.price_key
      and r.stripe_product_id=old.stripe_product_id and r.stripe_price_id=old.stripe_price_id
      and r.stripe_checkout_session_id=old.stripe_checkout_session_id and r.pack_quantity=old.pack_quantity
      and r.amount_cents=old.total_amount_cents and r.currency=old.currency and r.disposition='applied')
      into has_receipt;
    if old.state<>'bound' or not has_receipt then
      raise exception 'A paid Checkout reservation needs its exact payment receipt' using errcode='42501';
    end if;
    return new;
  end if;
  if (old.state='reserved' and new.state in ('unknown','bound','cancel_required'))
    or (old.state='unknown' and new.state in ('bound','cancel_required'))
    or (old.state='bound' and new.state='cancel_required') then return new; end if;
  raise exception 'Unsupported Checkout reservation state transition' using errcode='42501';
end;
$$;
revoke all on function private.protect_feature_checkout_terminal_state() from public,anon,authenticated;

create function public.service_record_form_coach_trial_terminal(
  p_request_id uuid,p_reservation_id uuid,p_session_id text,p_customer_id text,p_subscription_id text,
  p_expected_subscription_revision bigint,
  p_session_status text,p_payment_status text,p_subscription_status text,
  p_outstanding_invoice_count integer,p_active_payment_intent_count integer,p_evidence_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare payer_id_value uuid; reservation public.feature_checkout_reservations%rowtype;
  registration public.feature_checkout_trial_registrations%rowtype; existing public.feature_checkout_trial_terminal_attestations%rowtype;
  subscription_row public.feature_subscriptions%rowtype; deletion boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_reservation_id is null or nullif(trim(p_session_id),'') is null
    or nullif(trim(p_customer_id),'') is null or nullif(trim(p_subscription_id),'') is null
    or p_session_status is null or p_payment_status is null or p_subscription_status is null
    or p_expected_subscription_revision is null or p_expected_subscription_revision<0
    or p_outstanding_invoice_count is null or p_active_payment_intent_count is null
    or p_evidence_digest is null or p_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Trial terminal evidence identity is invalid' using errcode='22023'; end if;
  if p_session_status<>'complete' or p_payment_status<>'no_payment_required'
    or p_subscription_status not in ('canceled','incomplete_expired')
    or p_outstanding_invoice_count<>0 or p_active_payment_intent_count<>0 then return 'not_terminal'; end if;
  if current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception 'Form Coach billing mutation requires READ COMMITTED' using errcode='40001'; end if;
  select r.payer_id into payer_id_value from public.feature_checkout_reservations r
    where r.id=p_reservation_id and r.request_id=p_request_id and r.feature_key='form_coach';
  if not found then return 'not_found'; end if;
  if not private.form_coach_try_account_payer_locks(payer_id_value) then
    return 'retryable_account_serialization';
  end if;
  select * into reservation from public.feature_checkout_reservations r
    where r.id=p_reservation_id and r.request_id=p_request_id and r.feature_key='form_coach' for update;
  if not found or reservation.payer_id is distinct from payer_id_value then return 'identity_mismatch'; end if;
  select * into registration from public.feature_checkout_trial_registrations t where t.request_id=p_request_id;
  if not found or reservation.state not in ('cancel_required','canceled')
    or registration.reservation_id<>reservation.id or registration.stripe_checkout_session_id<>p_session_id
    or registration.stripe_customer_id<>p_customer_id or registration.stripe_subscription_id<>p_subscription_id
    or reservation.stripe_checkout_session_id<>p_session_id or reservation.stripe_customer_id<>p_customer_id
    or reservation.stripe_subscription_id<>p_subscription_id
    or exists(select 1 from public.feature_payment_receipts r where r.reservation_id=reservation.id) then
    return 'binding_mismatch'; end if;
  deletion:=exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id_value)
    or private.stream_account_is_tombstoned(payer_id_value);
  select * into subscription_row from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id for update;
  if not found or subscription_row.feature_key<>'form_coach' or subscription_row.payer_id<>payer_id_value
    or subscription_row.stripe_customer_id<>p_customer_id
    or subscription_row.state_revision<>p_expected_subscription_revision then return 'stale'; end if;
  if subscription_row.status='blocked_deletion' then
    if not deletion then return 'identity_mismatch'; end if;
  elsif subscription_row.status not in ('canceled','incomplete_expired')
    or subscription_row.status<>p_subscription_status then return 'subscription_conflict'; end if;
  select * into existing from public.feature_checkout_trial_terminal_attestations a
    where a.request_id=p_request_id for update;
  if found then
    if (existing.reservation_id,existing.stripe_checkout_session_id,existing.stripe_customer_id,
        existing.stripe_subscription_id,existing.subscription_status,existing.outstanding_invoice_count,
        existing.active_payment_intent_count,existing.terminal_evidence_digest)
      is distinct from (p_reservation_id,p_session_id,p_customer_id,p_subscription_id,p_subscription_status,0,0,p_evidence_digest)
      or reservation.state<>'canceled' then return 'conflict'; end if;
    return 'already_canceled';
  end if;
  if reservation.state<>'cancel_required' then return 'binding_mismatch'; end if;
  insert into public.feature_checkout_trial_terminal_attestations(
    request_id,reservation_id,feature_key,payer_id,stripe_checkout_session_id,stripe_customer_id,
    stripe_subscription_id,session_status,payment_status,subscription_status,
    outstanding_invoice_count,active_payment_intent_count,terminal_evidence_digest
  ) values(p_request_id,reservation.id,'form_coach',payer_id_value,p_session_id,p_customer_id,p_subscription_id,
    'complete','no_payment_required',p_subscription_status,0,0,p_evidence_digest);
  if subscription_row.status='blocked_deletion' then
    update public.feature_subscriptions set status=p_subscription_status,state_revision=state_revision+1,updated_at=now()
      where stripe_subscription_id=p_subscription_id and payer_id=payer_id_value
        and state_revision=p_expected_subscription_revision and status='blocked_deletion';
    if not found then raise exception 'Trial subscription changed during terminalization' using errcode='40001'; end if;
  end if;
  update public.feature_checkout_reservations r set state='canceled'
    where r.id=reservation.id and r.state='cancel_required'
      and r.stripe_checkout_session_id=p_session_id and r.stripe_customer_id=p_customer_id
      and r.stripe_subscription_id=p_subscription_id;
  if not found then raise exception 'Trial reservation changed during terminalization' using errcode='40001'; end if;
  return 'canceled';
end;
$$;
revoke all on function public.service_record_form_coach_trial_terminal(uuid,uuid,text,text,text,bigint,text,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.service_record_form_coach_trial_terminal(uuid,uuid,text,text,text,bigint,text,text,text,integer,integer,text) to service_role;

comment on table public.feature_checkout_trial_registrations is
  'Immutable exact evidence for a zero-payment Form Coach subscription trial; it is not a payment receipt.';
comment on table public.feature_billing_conflict_events is
  'Durable audit of verified provider contradictions arriving after a terminal Form Coach billing decision.';
comment on table public.feature_invoice_snapshot_attempts is
  'Reconciliation attempts keep the original Stripe invoice event identity separate from current retrieved invoice state.';
