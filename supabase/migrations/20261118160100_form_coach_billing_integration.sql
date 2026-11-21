-- Form Coach billing integration contracts. This migration adds only local database records and
-- service/admin RPCs; it creates no Stripe objects and grants no account pricing, credits or comps.

create table public.feature_customer_create_attempts (
  id uuid primary key default gen_random_uuid(),
  feature_key text not null references public.feature_pricing_current(feature_key) on delete restrict,
  payer_id uuid not null,
  request_id uuid not null unique,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null unique,
  state text not null default 'reserved' check (state in ('reserved','unknown','bound','verified','cancel_required','blocked_deletion','failed')),
  stripe_customer_id text unique,
  state_revision bigint not null default 0 check (state_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state in ('bound','verified','cancel_required') and stripe_customer_id is not null)
    or (state in ('reserved','unknown','blocked_deletion','failed') and stripe_customer_id is null))
);
create unique index feature_customer_one_unresolved_attempt_per_payer_idx
  on public.feature_customer_create_attempts(feature_key,payer_id)
  where state in ('reserved','unknown','bound','cancel_required');

create table public.feature_payer_customer_mappings (
  feature_key text not null references public.feature_pricing_current(feature_key) on delete restrict,
  payer_id uuid not null,
  stripe_customer_id text not null unique,
  create_attempt_id uuid not null unique references public.feature_customer_create_attempts(id) on delete restrict,
  verified_at timestamptz not null default now(),
  primary key(feature_key,payer_id)
);

create table public.feature_pricing_sync_requests (
  request_id uuid primary key,
  feature_key text not null references public.feature_pricing_current(feature_key) on delete restrict,
  expected_revision bigint not null check (expected_revision > 0),
  requested_by uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  candidate_payload jsonb not null check (jsonb_typeof(candidate_payload)='object'),
  state text not null default 'reserved' check (state in ('reserved','unknown','verified','cas_applied','cas_stale','failed')),
  state_revision bigint not null default 0 check (state_revision >= 0),
  published_revision bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(feature_key,expected_revision) references public.feature_pricing_revisions(feature_key,revision) on delete restrict,
  foreign key(feature_key,published_revision) references public.feature_pricing_revisions(feature_key,revision) on delete restrict,
  check ((state='cas_applied') = (published_revision is not null))
);
create table public.feature_pricing_sync_objects (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.feature_pricing_sync_requests(request_id) on delete restrict,
  object_kind text not null check (object_kind in ('product','price')),
  price_key text,
  idempotency_key text not null unique,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'reserved' check (state in ('reserved','unknown','bound','verified','failed')),
  provider_object_id text,
  verified_payload_digest text,
  state_revision bigint not null default 0 check (state_revision >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((object_kind='product' and price_key is null) or (object_kind='price' and price_key ~ '^[a-z][a-z0-9_]{0,39}$')),
  check ((state in ('bound','verified') and provider_object_id is not null)
    or (state in ('reserved','unknown','failed') and provider_object_id is null)),
  check (verified_payload_digest is null or verified_payload_digest ~ '^[a-f0-9]{64}$'),
  unique(request_id,object_kind,price_key)
);
create unique index feature_pricing_sync_one_product_per_request_idx
  on public.feature_pricing_sync_objects(request_id) where object_kind='product';
create index feature_pricing_sync_objects_provider_identity_idx
  on public.feature_pricing_sync_objects(object_kind,provider_object_id) where provider_object_id is not null;

create table public.feature_subscription_contract_versions (
  stripe_subscription_id text not null references public.feature_subscriptions(stripe_subscription_id) on delete restrict,
  contract_version integer not null check (contract_version > 0),
  feature_key text not null,
  payer_role text not null check (payer_role in ('coach','member')),
  payer_id uuid not null,
  config_revision bigint not null,
  price_key text not null,
  stripe_product_id text not null,
  stripe_price_id text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null check (billing_interval in ('month','year')),
  migration_request_id uuid,
  effective_at timestamptz not null default now(),
  primary key(stripe_subscription_id,contract_version),
  foreign key(feature_key,config_revision,price_key) references public.feature_pricing_options(feature_key,revision,price_key) on delete restrict
);

create table public.feature_subscription_contract_current (
  stripe_subscription_id text primary key references public.feature_subscriptions(stripe_subscription_id) on delete restrict,
  feature_key text not null,
  contract_version integer not null,
  state_revision bigint not null default 1 check (state_revision > 0),
  updated_at timestamptz not null default now(),
  foreign key(stripe_subscription_id,contract_version)
    references public.feature_subscription_contract_versions(stripe_subscription_id,contract_version) on delete restrict
);

create table public.feature_subscription_checkout_access_proofs (
  subscription_id text primary key references public.feature_subscriptions(stripe_subscription_id) on delete restrict,
  payer_id uuid not null,
  receipt_id uuid not null unique references public.feature_payment_receipts(id) on delete restrict,
  contract_version integer not null,
  paid_through timestamptz not null,
  recorded_at timestamptz not null default now(),
  foreign key(subscription_id,contract_version)
    references public.feature_subscription_contract_versions(stripe_subscription_id,contract_version) on delete restrict
);

create table public.feature_subscription_contract_move_intents (
  request_id uuid primary key,
  feature_key text not null,
  stripe_subscription_id text not null,
  payer_id uuid not null,
  from_contract_version integer not null check (from_contract_version > 0),
  from_config_revision bigint not null check (from_config_revision > 0),
  expected_contract_state_revision bigint not null check (expected_contract_state_revision > 0),
  expected_subscription_state_revision bigint not null check (expected_subscription_state_revision >= 0),
  to_config_revision bigint not null check (to_config_revision > 0),
  to_price_key text not null check (to_price_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  to_stripe_product_id text not null,
  to_stripe_price_id text not null,
  to_amount_cents integer not null check (to_amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null check (billing_interval in ('month','year')),
  proration_behavior text not null check (proration_behavior in ('none','create_prorations','always_invoice')),
  confirmed_by_admin uuid not null,
  confirmed_at timestamptz not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  foreign key(stripe_subscription_id,from_contract_version)
    references public.feature_subscription_contract_versions(stripe_subscription_id,contract_version) on delete restrict,
  foreign key(feature_key,to_config_revision,to_price_key)
    references public.feature_pricing_options(feature_key,revision,price_key) on delete restrict
);

create table public.feature_subscription_contract_move_state (
  request_id uuid primary key references public.feature_subscription_contract_move_intents(request_id) on delete restrict,
  state text not null default 'reserved' check (state in ('reserved','unknown','provider_verified','applied','cas_stale','blocked_deletion','mismatch','failed')),
  state_revision bigint not null default 0 check (state_revision >= 0),
  applied_contract_version integer,
  updated_at timestamptz not null default now(),
  check ((state='applied') = (applied_contract_version is not null))
);
alter table public.feature_subscription_contract_versions
  add constraint feature_contract_version_migration_request_fk
  foreign key(migration_request_id) references public.feature_subscription_contract_move_intents(request_id) on delete restrict;
create unique index feature_contract_move_one_version_idx
  on public.feature_subscription_contract_versions(migration_request_id)
  where migration_request_id is not null;

create table public.feature_trial_claims (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  feature_key text not null references public.feature_pricing_current(feature_key) on delete restrict,
  payer_id uuid not null,
  config_revision bigint not null,
  trial_kind text not null check (trial_kind in ('trial_days','trial_assessments')),
  source_kind text not null check (source_kind in ('subscription','subscription_invoice','assessment_trial')),
  source_id text not null,
  stripe_subscription_id text,
  starts_at timestamptz not null,
  expires_at timestamptz,
  granted_assessments integer not null default 0 check (granted_assessments >= 0),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(feature_key,payer_id),
  foreign key(feature_key,config_revision) references public.feature_pricing_revisions(feature_key,revision) on delete restrict,
  foreign key(stripe_subscription_id) references public.feature_subscriptions(stripe_subscription_id) on delete restrict,
  check ((trial_kind='trial_days' and expires_at is not null and expires_at>starts_at
      and granted_assessments=0 and source_kind in ('subscription','subscription_invoice') and stripe_subscription_id is not null)
    or (trial_kind='trial_assessments' and expires_at is null and granted_assessments between 1 and 1000
      and source_kind='assessment_trial'))
);
alter table public.feature_credit_lots
  add column trial_claim_id uuid references public.feature_trial_claims(id) on delete restrict;
alter table public.feature_credit_lots
  add constraint feature_assessment_trial_claim_link check (trial_claim_id is null or lot_kind='assessment_trial');

create table public.feature_subscription_invoice_events (
  event_id text primary key,
  event_type text not null,
  invoice_id text not null,
  subscription_id text not null,
  payer_id uuid,
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now()
);
create table public.feature_subscription_invoice_event_state (
  event_id text primary key references public.feature_subscription_invoice_events(event_id) on delete restrict,
  state text not null check (state in ('received','retryable','applied','stale','mismatch','blocked_deletion','manual_review')),
  state_revision bigint not null default 0 check (state_revision >= 0),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.feature_subscription_refund_events (
  refund_id text primary key,
  event_id text not null unique,
  invoice_id text,
  payment_intent_id text,
  charge_id text,
  payer_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now(),
  check (invoice_id is not null or payment_intent_id is not null or charge_id is not null)
);

create table public.feature_subscription_invoice_current (
  invoice_id text primary key,
  feature_key text not null,
  subscription_id text not null,
  payer_id uuid not null,
  contract_version integer not null,
  status text not null check (status in ('draft','open','paid','void','uncollectible','unknown')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_due_cents bigint not null check (amount_due_cents >= 0),
  amount_paid_cents bigint not null check (amount_paid_cents >= 0),
  period_start timestamptz not null,
  period_end timestamptz not null,
  payment_intent_id text,
  charge_id text,
  trial_claim_id uuid references public.feature_trial_claims(id) on delete restrict,
  refund_total_cents bigint not null default 0 check (refund_total_cents >= 0),
  refund_state text not null default 'none' check (refund_state in ('none','partial_review','fully_refunded')),
  net_settled_cents bigint generated always as (greatest(amount_paid_cents-refund_total_cents,0)) stored,
  last_event_id text not null references public.feature_subscription_invoice_events(event_id) on delete restrict,
  state_revision bigint not null default 1 check (state_revision > 0),
  updated_at timestamptz not null default now(),
  foreign key(subscription_id,contract_version)
    references public.feature_subscription_contract_versions(stripe_subscription_id,contract_version) on delete restrict,
  check (period_end > period_start),
  check (refund_total_cents <= amount_paid_cents),
  check ((refund_state='none' and refund_total_cents=0)
    or (refund_state='fully_refunded' and amount_paid_cents>0 and refund_total_cents=amount_paid_cents)
    or (refund_state='partial_review' and refund_total_cents>0 and refund_total_cents<amount_paid_cents)),
  check (trial_claim_id is null or (status='paid' and amount_due_cents=0 and amount_paid_cents=0))
);
create index feature_subscription_invoice_owner_period_idx
  on public.feature_subscription_invoice_current(feature_key,payer_id,period_end desc);

create table public.feature_billing_provider_aliases (
  object_kind text not null check (object_kind in ('invoice','payment_intent','charge')),
  object_id text not null,
  feature_key text not null,
  payer_id uuid not null,
  subscription_id text not null,
  invoice_id text not null,
  created_at timestamptz not null default now(),
  primary key(object_kind,object_id),
  foreign key(invoice_id) references public.feature_subscription_invoice_current(invoice_id) on delete restrict,
  foreign key(subscription_id) references public.feature_subscriptions(stripe_subscription_id) on delete restrict
);

create table public.feature_subscription_access_current (
  subscription_id text primary key references public.feature_subscriptions(stripe_subscription_id) on delete restrict,
  feature_key text not null,
  payer_id uuid not null,
  provider_period_end timestamptz not null,
  verified_paid_through timestamptz,
  verified_trial_through timestamptz,
  access_through timestamptz,
  proof_revision bigint not null default 1 check (proof_revision > 0),
  updated_at timestamptz not null default now()
);

create table public.feature_billing_event_identity (
  event_id text primary key,
  event_type text not null,
  object_kind text not null check (object_kind in ('invoice','refund')),
  object_id text not null,
  identity_digest text not null check (identity_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz not null default now()
);
alter table public.feature_subscription_invoice_events
  add constraint feature_invoice_event_global_identity_fk
  foreign key(event_id) references public.feature_billing_event_identity(event_id) on delete restrict;
alter table public.feature_subscription_refund_events
  add constraint feature_refund_event_global_identity_fk
  foreign key(event_id) references public.feature_billing_event_identity(event_id) on delete restrict;
create table public.feature_subscription_refund_event_state (
  event_id text primary key references public.feature_billing_event_identity(event_id) on delete restrict,
  state text not null check (state in ('received','retryable','stale','applied','manual_review','mismatch','blocked_deletion')),
  state_revision bigint not null default 0 check (state_revision >= 0),
  updated_at timestamptz not null default now()
);

create function private.protect_form_coach_billing_state()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then
    raise exception 'Form Coach billing identity history cannot be deleted' using errcode='42501';
  end if;
  if tg_table_name='feature_customer_create_attempts' then
    if (new.id,new.feature_key,new.payer_id,new.request_id,new.request_digest,new.idempotency_key,new.created_at)
       is distinct from (old.id,old.feature_key,old.payer_id,old.request_id,old.request_digest,old.idempotency_key,old.created_at) then
      raise exception 'Customer-create request identity is immutable' using errcode='42501';
    end if;
    if old.stripe_customer_id is not null and new.stripe_customer_id is distinct from old.stripe_customer_id then
      raise exception 'Customer binding cannot be replaced' using errcode='42501';
    end if;
    if new.state_revision<>old.state_revision+1 then
      raise exception 'Customer-create state must advance by compare-and-swap revision' using errcode='40001';
    end if;
    if not ((old.state='reserved' and new.state in ('unknown','bound','cancel_required','blocked_deletion','failed'))
      or (old.state='unknown' and new.state in ('bound','cancel_required','blocked_deletion','failed'))
      or (old.state='bound' and new.state in ('verified','cancel_required'))) then
      raise exception 'Invalid customer-create state transition' using errcode='22023';
    end if;
  elsif tg_table_name='feature_payer_customer_mappings' then
    raise exception 'Payer customer ownership is immutable' using errcode='42501';
  elsif tg_table_name='feature_pricing_sync_requests' then
    if (new.request_id,new.feature_key,new.expected_revision,new.requested_by,new.request_digest,new.candidate_payload,new.created_at)
       is distinct from (old.request_id,old.feature_key,old.expected_revision,old.requested_by,old.request_digest,old.candidate_payload,old.created_at) then
      raise exception 'Pricing-sync candidate identity is immutable' using errcode='42501';
    end if;
    if new.state_revision<>old.state_revision+1 then
      raise exception 'Pricing-sync state must advance by compare-and-swap revision' using errcode='40001';
    end if;
    if not ((old.state='reserved' and new.state in ('unknown','verified','cas_stale','failed'))
      or (old.state='unknown' and new.state in ('verified','cas_stale','failed'))
      or (old.state='verified' and new.state in ('cas_applied','cas_stale','failed'))) then
      raise exception 'Invalid pricing-sync state transition' using errcode='22023';
    end if;
    if old.published_revision is not null and new.published_revision is distinct from old.published_revision then
      raise exception 'Published pricing revision cannot be replaced' using errcode='42501';
    end if;
  elsif tg_table_name='feature_pricing_sync_objects' then
    if (new.id,new.request_id,new.object_kind,new.price_key,new.idempotency_key,new.payload_digest,new.created_at)
       is distinct from (old.id,old.request_id,old.object_kind,old.price_key,old.idempotency_key,old.payload_digest,old.created_at) then
      raise exception 'Provider-sync object request is immutable' using errcode='42501';
    end if;
    if old.provider_object_id is not null and new.provider_object_id is distinct from old.provider_object_id then
      raise exception 'Provider object binding cannot be replaced' using errcode='42501';
    end if;
    if new.provider_object_id is not null and exists(
      select 1 from public.feature_pricing_sync_objects other_object
      where other_object.provider_object_id=new.provider_object_id and other_object.id<>new.id
        and (other_object.object_kind<>new.object_kind or other_object.price_key is distinct from new.price_key
          or other_object.payload_digest<>new.payload_digest)
    ) then
      raise exception 'A provider object ID cannot be reused for a different immutable price identity' using errcode='23505';
    end if;
    if new.state_revision<>old.state_revision+1 then
      raise exception 'Provider-sync object state must advance by compare-and-swap revision' using errcode='40001';
    end if;
    if not ((old.state='reserved' and new.state in ('unknown','bound','failed'))
      or (old.state='unknown' and new.state in ('bound','failed'))
      or (old.state='bound' and new.state='verified')) then
      raise exception 'Invalid provider-sync object state transition' using errcode='22023';
    end if;
  elsif tg_table_name='feature_subscription_contract_versions' then
    raise exception 'Subscription contract versions are immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_checkout_access_proofs' then
    raise exception 'Verified checkout paid-through proof is immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_contract_move_intents' then
    raise exception 'Subscription contract move intent is immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_contract_move_state' then
    if (new.request_id) is distinct from (old.request_id)
      or new.state_revision<>old.state_revision+1 then
      raise exception 'Contract-move state must preserve identity and advance by CAS' using errcode='40001';
    end if;
    if not (old.state in ('reserved','unknown','provider_verified')
      and new.state in ('unknown','provider_verified','applied','cas_stale','blocked_deletion','mismatch','failed')) then
      raise exception 'Invalid contract-move state transition' using errcode='22023';
    end if;
  elsif tg_table_name='feature_subscription_contract_current' then
    if new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.feature_key is distinct from old.feature_key
      or new.state_revision<>old.state_revision+1 then
      raise exception 'Active contract pointer must preserve subscription and advance by CAS' using errcode='40001';
    end if;
  elsif tg_table_name='feature_credit_lots' then
    if new.trial_claim_id is distinct from old.trial_claim_id then
      raise exception 'Assessment trial credit provenance is immutable' using errcode='42501';
    end if;
  elsif tg_table_name='feature_trial_claims' then
    raise exception 'Trial claim provenance is immutable' using errcode='42501';
  elsif tg_table_name='feature_billing_event_identity' then
    raise exception 'Financial provider event identity is immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_invoice_events' then
    raise exception 'Invoice event identity is immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_invoice_event_state' then
    if new.event_id is distinct from old.event_id or new.state_revision<>old.state_revision+1 then
      raise exception 'Invoice event state must preserve identity and advance by CAS' using errcode='40001';
    end if;
    if old.state in ('applied','blocked_deletion','mismatch','manual_review')
      or new.state not in ('retryable','applied','stale','mismatch','blocked_deletion','manual_review') then
      raise exception 'Invalid or terminal invoice event-state transition' using errcode='22023';
    end if;
  elsif tg_table_name='feature_subscription_refund_event_state' then
    if new.event_id is distinct from old.event_id or new.state_revision<>old.state_revision+1 then
      raise exception 'Refund event state must preserve identity and advance by CAS' using errcode='40001';
    end if;
    if old.state in ('applied','manual_review','mismatch','blocked_deletion')
      or new.state not in ('retryable','stale','applied','manual_review','mismatch','blocked_deletion') then
      raise exception 'Invalid or terminal refund event-state transition' using errcode='22023';
    end if;
  elsif tg_table_name='feature_subscription_refund_events' then
    if (new.refund_id,new.event_id,new.payment_intent_id,new.charge_id,new.amount_cents,new.currency,new.identity_digest,new.received_at)
       is distinct from (old.refund_id,old.event_id,old.payment_intent_id,old.charge_id,old.amount_cents,old.currency,old.identity_digest,old.received_at)
      or (old.payer_id is not null and new.payer_id is distinct from old.payer_id)
      or (old.invoice_id is not null and new.invoice_id is distinct from old.invoice_id)
      or (old.invoice_id is null and new.invoice_id is not null
        and old.payment_intent_id is null and old.charge_id is null) then
      raise exception 'Refund identity is immutable' using errcode='42501';
    end if;
  elsif tg_table_name='feature_subscription_invoice_current' then
    if tg_op='INSERT' then
      if new.state_revision<>1 then raise exception 'New invoice projection must start at revision one' using errcode='40001'; end if;
    else
      if (new.invoice_id,new.feature_key,new.subscription_id,new.payer_id,new.contract_version,new.currency,new.period_start,new.period_end)
         is distinct from (old.invoice_id,old.feature_key,old.subscription_id,old.payer_id,old.contract_version,old.currency,old.period_start,old.period_end) then
        raise exception 'Invoice ownership and contract identity are immutable' using errcode='42501';
      end if;
      if new.state_revision<>old.state_revision+1 then
        raise exception 'Invoice projection must advance by compare-and-swap revision' using errcode='40001';
      end if;
    end if;
  elsif tg_table_name='feature_billing_provider_aliases' then
    raise exception 'Provider invoice aliases are immutable' using errcode='42501';
  elsif tg_table_name='feature_subscription_access_current' then
    if (new.subscription_id,new.feature_key,new.payer_id) is distinct from (old.subscription_id,old.feature_key,old.payer_id)
      or new.proof_revision<>old.proof_revision+1 then
      raise exception 'Subscription access proof must preserve owner and advance by revision' using errcode='40001';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.protect_form_coach_billing_state() from public,anon,authenticated;

create trigger feature_customer_create_attempts_guard before update or delete on public.feature_customer_create_attempts
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_payer_customer_mappings_guard before update or delete on public.feature_payer_customer_mappings
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_pricing_sync_requests_guard before update or delete on public.feature_pricing_sync_requests
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_pricing_sync_objects_guard before update or delete on public.feature_pricing_sync_objects
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_contract_versions_immutable before update or delete on public.feature_subscription_contract_versions
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_contract_move_intents_immutable before update or delete on public.feature_subscription_contract_move_intents
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_contract_move_state_guard before update or delete on public.feature_subscription_contract_move_state
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_contract_current_guard before update or delete on public.feature_subscription_contract_current
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_subscription_checkout_access_proofs_guard before update or delete on public.feature_subscription_checkout_access_proofs
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_trial_claims_immutable before update or delete on public.feature_trial_claims
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_invoice_events_immutable before update or delete on public.feature_subscription_invoice_events
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_billing_event_identity_immutable before update or delete on public.feature_billing_event_identity
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_invoice_event_state_guard before update or delete on public.feature_subscription_invoice_event_state
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_refund_event_state_guard before update or delete on public.feature_subscription_refund_event_state
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_refund_events_guard before update or delete on public.feature_subscription_refund_events
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_invoice_current_guard before insert or update or delete on public.feature_subscription_invoice_current
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_billing_aliases_immutable before update or delete on public.feature_billing_provider_aliases
  for each row execute function private.protect_form_coach_billing_state();
create trigger feature_subscription_access_guard before update or delete on public.feature_subscription_access_current
  for each row execute function private.protect_form_coach_billing_state();

create function private.initialize_feature_subscription_contract()
returns trigger language plpgsql security definer set search_path = '' as $$
declare option_row public.feature_pricing_options%rowtype;
begin
  select * into option_row from public.feature_pricing_options o
  where o.feature_key=new.feature_key and o.revision=new.config_revision and o.price_key=new.price_key;
  if not found or option_row.interval is null or option_row.stripe_product_id is null or option_row.stripe_price_id is null then
    raise exception 'Subscription needs a verified immutable pricing option' using errcode='23514';
  end if;
  if new.payer_role<>(select r.payer from public.feature_pricing_revisions r where r.feature_key=new.feature_key and r.revision=new.config_revision) then
    raise exception 'Subscription payer does not match its source pricing revision' using errcode='23514';
  end if;
  insert into public.feature_subscription_contract_versions(
    stripe_subscription_id,contract_version,feature_key,payer_role,payer_id,config_revision,price_key,
    stripe_product_id,stripe_price_id,amount_cents,currency,billing_interval,effective_at
  ) values (
    new.stripe_subscription_id,1,new.feature_key,new.payer_role,new.payer_id,new.config_revision,new.price_key,
    option_row.stripe_product_id,option_row.stripe_price_id,option_row.amount_cents,option_row.currency,option_row.interval,now()
  );
  insert into public.feature_subscription_contract_current(stripe_subscription_id,feature_key,contract_version,state_revision)
    values(new.stripe_subscription_id,new.feature_key,1,1);
  return new;
end;
$$;
revoke all on function private.initialize_feature_subscription_contract() from public,anon,authenticated;

do $$
begin
  if exists(
    select 1 from public.feature_subscriptions s
    left join public.feature_pricing_options o
      on o.feature_key=s.feature_key and o.revision=s.config_revision and o.price_key=s.price_key
    where o.feature_key is null or o.interval is null or o.stripe_product_id is null or o.stripe_price_id is null
  ) then
    raise exception 'Existing Form Coach subscriptions need a verified subscription price before contract history can be initialized'
      using errcode='23514';
  end if;
end;
$$;

insert into public.feature_subscription_contract_versions(
  stripe_subscription_id,contract_version,feature_key,payer_role,payer_id,config_revision,price_key,
  stripe_product_id,stripe_price_id,amount_cents,currency,billing_interval,effective_at
)
select s.stripe_subscription_id,1,s.feature_key,s.payer_role,s.payer_id,s.config_revision,s.price_key,
       o.stripe_product_id,o.stripe_price_id,o.amount_cents,o.currency,o.interval,s.updated_at
from public.feature_subscriptions s
join public.feature_pricing_options o on o.feature_key=s.feature_key and o.revision=s.config_revision and o.price_key=s.price_key
where o.interval is not null and o.stripe_product_id is not null and o.stripe_price_id is not null;
insert into public.feature_subscription_contract_current(stripe_subscription_id,feature_key,contract_version,state_revision)
select s.stripe_subscription_id,s.feature_key,1,1 from public.feature_subscriptions s
join public.feature_subscription_contract_versions v on v.stripe_subscription_id=s.stripe_subscription_id and v.contract_version=1;
-- PostgreSQL fires same-event triggers alphabetically. Initialize the immutable contract before
-- the access refresher attempts to bind an already-recorded Checkout receipt.
create trigger feature_subscription_00_contract_init after insert on public.feature_subscriptions
  for each row execute function private.initialize_feature_subscription_contract();
create trigger feature_credit_lot_trial_claim_guard before update or delete on public.feature_credit_lots
  for each row execute function private.protect_form_coach_billing_state();

create function public.admin_reserve_feature_pricing_sync(
  p_expected_revision bigint,p_request_id uuid,p_request_digest text,p_candidate_payload jsonb
)
returns table(outcome text,request_id uuid,state text)
language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; existing public.feature_pricing_sync_requests%rowtype;
 status_value text; billing_model_value text; option_count integer; option_row jsonb;
begin
  if not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_expected_revision is null or p_expected_revision<1 or p_expected_revision>=9223372036854775807
    or p_request_id is null or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_candidate_payload is null or jsonb_typeof(p_candidate_payload)<>'object' then
    raise exception 'Invalid Form Coach pricing-sync request' using errcode='22023';
  end if;
  status_value:=p_candidate_payload->>'status';
  billing_model_value:=p_candidate_payload->>'billing_model';
  if coalesce(status_value,'') not in ('disabled','pricing_pending','live')
    or coalesce(p_candidate_payload->>'payer','') not in ('coach','member')
    or coalesce(p_candidate_payload->>'currency','') !~ '^[A-Z]{3}$'
    or jsonb_typeof(p_candidate_payload->'display_name') is distinct from 'string'
    or jsonb_typeof(p_candidate_payload->'description') is distinct from 'string'
    or jsonb_typeof(p_candidate_payload->'marketing_copy') is distinct from 'string'
    or nullif(trim(p_candidate_payload->>'display_name'),'') is null
    or char_length(p_candidate_payload->>'display_name')>120
    or char_length(coalesce(p_candidate_payload->>'description',''))>500
    or char_length(coalesce(p_candidate_payload->>'marketing_copy',''))>2000
    or coalesce(p_candidate_payload->>'trial_days','') !~ '^(0|[1-9][0-9]?|[12][0-9]{2}|3[0-5][0-9]|36[0-5])$'
    or coalesce(p_candidate_payload->>'trial_assessments','') !~ '^([0-9]|[1-9][0-9]{1,2}|1000)$'
    or (billing_model_value is not null and billing_model_value not in ('subscription','per_assessment'))
    or jsonb_typeof(p_candidate_payload->'price_options') is distinct from 'array'
    or (p_candidate_payload - array['status','payer','currency','display_name','description','marketing_copy','trial_days','trial_assessments','billing_model','price_options']) <> '{}'::jsonb then
    raise exception 'Invalid Form Coach pricing candidate' using errcode='22023';
  end if;
  option_count:=jsonb_array_length(p_candidate_payload->'price_options');
  if (status_value='pricing_pending' and (billing_model_value is not null or option_count<>0))
    or (status_value='live' and (billing_model_value is null or option_count=0))
    or (status_value='disabled' and (billing_model_value is not null or option_count<>0)) then
    raise exception 'Candidate status, model and prices do not agree' using errcode='22023';
  end if;
  for option_row in select value from jsonb_array_elements(p_candidate_payload->'price_options') loop
    if jsonb_typeof(option_row) is distinct from 'object'
      or (option_row - array['price_key','amount_cents','currency','interval','credits_per_pack']) <> '{}'::jsonb
      or nullif(option_row->>'price_key','') is null or (option_row->>'price_key') !~ '^[a-z][a-z0-9_]{0,39}$'
      or coalesce(option_row->>'amount_cents','') !~ '^[1-9][0-9]*$'
      or coalesce(option_row->>'currency','')<>coalesce(p_candidate_payload->>'currency','')
      or option_row ? 'stripe_product_id' or option_row ? 'stripe_price_id'
      or (billing_model_value='subscription' and (coalesce(option_row->>'interval','') not in ('month','year') or nullif(option_row->>'credits_per_pack','') is not null))
      or (billing_model_value='per_assessment' and (nullif(option_row->>'interval','') is not null or coalesce(option_row->>'credits_per_pack','') !~ '^[1-9][0-9]*$')) then
      raise exception 'Candidate price options must be provider-free and match the selected billing model' using errcode='22023';
    end if;
  end loop;
  if billing_model_value='subscription' and option_count<>1 then
    raise exception 'Subscription candidates require exactly one price option' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_candidate_payload->'price_options') x group by x->>'price_key' having count(*)>1) then
    raise exception 'Candidate price keys must be unique' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feature-pricing:form_coach',0));
  select c.revision into current_revision from public.feature_pricing_current c where c.feature_key='form_coach' for update;
  if current_revision is distinct from p_expected_revision then
    return query select 'cas_stale',null::uuid,null::text; return;
  end if;
  select * into existing from public.feature_pricing_sync_requests r where r.request_id=p_request_id;
  if found then
    if existing.feature_key<>'form_coach' or existing.expected_revision<>p_expected_revision
      or existing.request_digest<>p_request_digest or existing.candidate_payload<>p_candidate_payload
      or existing.requested_by<>auth.uid() then
      raise exception 'Pricing-sync request ID was reused with different identity or payload' using errcode='23505';
    end if;
    return query select 'existing',existing.request_id,existing.state; return;
  end if;
  insert into public.feature_pricing_sync_requests(request_id,feature_key,expected_revision,requested_by,request_digest,candidate_payload)
  values(p_request_id,'form_coach',p_expected_revision,auth.uid(),p_request_digest,p_candidate_payload);
  return query select 'reserved',p_request_id,'reserved'::text;
end;
$$;
revoke all on function public.admin_reserve_feature_pricing_sync(bigint,uuid,text,jsonb) from public,anon;
grant execute on function public.admin_reserve_feature_pricing_sync(bigint,uuid,text,jsonb) to authenticated;

create function public.reserve_feature_pricing_sync_object(
  p_request_id uuid,p_object_kind text,p_price_key text,p_idempotency_key text,p_payload_digest text
)
returns table(outcome text,object_id uuid,state_revision bigint)
language plpgsql security definer set search_path = '' as $$
declare request_row public.feature_pricing_sync_requests%rowtype; existing public.feature_pricing_sync_objects%rowtype; new_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_object_kind not in ('product','price')
    or (p_object_kind='product' and p_price_key is not null)
    or (p_object_kind='price' and (p_price_key is null or p_price_key !~ '^[a-z][a-z0-9_]{0,39}$'))
    or p_idempotency_key is null or p_idempotency_key !~ ('^form-coach-price-sync:'||p_request_id::text||':')
    or p_payload_digest is null or p_payload_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid provider-sync object reservation' using errcode='22023';
  end if;
  select * into request_row from public.feature_pricing_sync_requests r where r.request_id=p_request_id for update;
  if not found or request_row.state not in ('reserved','unknown') then
    return query select 'request_unavailable',null::uuid,null::bigint; return;
  end if;
  select * into existing from public.feature_pricing_sync_objects o
  where o.request_id=p_request_id and o.object_kind=p_object_kind and o.price_key is not distinct from p_price_key;
  if found then
    if existing.idempotency_key<>p_idempotency_key or existing.payload_digest<>p_payload_digest then
      raise exception 'Provider-sync object identity was reused with a different request' using errcode='23505';
    end if;
    return query select 'existing',existing.id,existing.state_revision; return;
  end if;
  insert into public.feature_pricing_sync_objects(request_id,object_kind,price_key,idempotency_key,payload_digest)
  values(p_request_id,p_object_kind,p_price_key,p_idempotency_key,p_payload_digest) returning id into new_id;
  return query select 'reserved',new_id,0::bigint;
end;
$$;
revoke all on function public.reserve_feature_pricing_sync_object(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_feature_pricing_sync_object(uuid,text,text,text,text) to service_role;

create function public.advance_feature_pricing_sync_object(
  p_object_id uuid,p_expected_state_revision bigint,p_next_state text,p_provider_object_id text,p_verified_payload_digest text
)
returns text language plpgsql security definer set search_path = '' as $$
declare current_row public.feature_pricing_sync_objects%rowtype; parent_request public.feature_pricing_sync_requests%rowtype;
 request_id_value uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  select o.request_id into request_id_value from public.feature_pricing_sync_objects o where o.id=p_object_id;
  if not found then return 'missing'; end if;
  select * into parent_request from public.feature_pricing_sync_requests r where r.request_id=request_id_value for update;
  if not found then return 'request_unavailable'; end if;
  if parent_request.state not in ('reserved','unknown') then return 'request_unavailable'; end if;
  select * into current_row from public.feature_pricing_sync_objects o where o.id=p_object_id for update;
  if not found then return 'missing'; end if;
  if p_expected_state_revision is null or p_expected_state_revision<0 then
    raise exception 'A non-null sync state revision is required' using errcode='22023';
  end if;
  if current_row.state_revision<>p_expected_state_revision then return 'cas_stale'; end if;
  if coalesce(p_next_state,'') not in ('unknown','bound','verified','failed') then
    raise exception 'Unsupported provider-sync transition' using errcode='22023';
  end if;
  if not ((current_row.state='reserved' and p_next_state in ('unknown','bound','failed'))
    or (current_row.state='unknown' and p_next_state in ('bound','failed'))
    or (current_row.state='bound' and p_next_state in ('verified','failed'))) then
    raise exception 'Invalid provider-sync transition' using errcode='22023';
  end if;
  if p_next_state in ('bound','verified') and nullif(trim(p_provider_object_id),'') is null then
    raise exception 'Bound sync state requires a provider object ID' using errcode='22023';
  end if;
  if p_next_state in ('bound','verified') then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-provider-object:'||p_provider_object_id,0));
  end if;
  if p_next_state='verified' and (current_row.state<>'bound'
    or p_provider_object_id is distinct from current_row.provider_object_id
    or p_verified_payload_digest is distinct from current_row.payload_digest) then
    raise exception 'Provider object verification did not match its reserved payload' using errcode='23505';
  end if;
  if current_row.provider_object_id is not null and p_provider_object_id is distinct from current_row.provider_object_id then
    raise exception 'Provider object ID cannot be rebound' using errcode='23505';
  end if;
  update public.feature_pricing_sync_objects set state=p_next_state,
    provider_object_id=case when p_next_state in ('bound','verified') then p_provider_object_id else provider_object_id end,
    verified_payload_digest=case when p_next_state='verified' then p_verified_payload_digest else verified_payload_digest end,
    state_revision=state_revision+1,updated_at=now() where id=p_object_id;
  return p_next_state;
end;
$$;
revoke all on function public.advance_feature_pricing_sync_object(uuid,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.advance_feature_pricing_sync_object(uuid,bigint,text,text,text) to service_role;

create function public.admin_publish_feature_pricing_sync(p_request_id uuid,p_expected_revision bigint)
returns table(outcome text,published_revision bigint)
language plpgsql security definer set search_path = '' as $$
declare request_row public.feature_pricing_sync_requests%rowtype; current_revision bigint; product_id text;
 candidate jsonb; option_row jsonb; price_id text; price_options jsonb:='[]'::jsonb; new_revision bigint;
begin
  if not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<1
    or p_expected_revision>=9223372036854775807 then
    raise exception 'Invalid pricing-sync compare-and-swap inputs' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feature-pricing:form_coach',0));
  select * into request_row from public.feature_pricing_sync_requests r where r.request_id=p_request_id for update;
  if not found then return query select 'missing',null::bigint; return; end if;
  if request_row.expected_revision<>p_expected_revision or request_row.requested_by<>auth.uid() then
    raise exception 'Pricing-sync request identity or expected revision changed' using errcode='23505';
  end if;
  if request_row.state='cas_applied' then return query select 'already_applied',request_row.published_revision; return; end if;
  if request_row.state not in ('reserved','unknown','verified') then
    return query select request_row.state,null::bigint; return;
  end if;
  select c.revision into current_revision from public.feature_pricing_current c where c.feature_key='form_coach' for update;
  if current_revision is distinct from p_expected_revision then
    update public.feature_pricing_sync_requests set state='cas_stale',state_revision=state_revision+1,updated_at=now()
      where request_id=p_request_id and state_revision=request_row.state_revision;
    return query select 'cas_stale',null::bigint; return;
  end if;
  candidate:=request_row.candidate_payload;
  if candidate->>'status'='live' then
    select o.provider_object_id into product_id from public.feature_pricing_sync_objects o
    where o.request_id=p_request_id and o.object_kind='product' and o.state='verified';
    if product_id is null then return query select 'objects_unverified',null::bigint; return; end if;
    if exists(select 1 from public.feature_provider_objects po where po.feature_key='form_coach'
        and po.object_id=product_id and po.object_type<>'product') then
      raise exception 'Provider Product ID is already bound to a different object namespace' using errcode='23505';
    end if;
    for option_row in select value from jsonb_array_elements(candidate->'price_options') loop
      select o.provider_object_id into price_id from public.feature_pricing_sync_objects o
      where o.request_id=p_request_id and o.object_kind='price' and o.price_key=option_row->>'price_key' and o.state='verified';
      if price_id is null then return query select 'objects_unverified',null::bigint; return; end if;
      if exists(select 1 from public.feature_provider_objects po
          join public.feature_pricing_options old_option on old_option.feature_key=po.feature_key
            and old_option.revision=po.config_revision and old_option.price_key=po.price_key
          where po.feature_key='form_coach' and po.object_id=price_id and po.object_type='price'
            and (po.price_key is distinct from option_row->>'price_key'
              or old_option.amount_cents is distinct from (option_row->>'amount_cents')::integer
              or old_option.currency is distinct from option_row->>'currency'
              or old_option.interval is distinct from option_row->>'interval'
              or old_option.credits_per_pack is distinct from nullif(option_row->>'credits_per_pack','')::integer)) then
        raise exception 'Provider Price ID is already bound to a different immutable price quote' using errcode='23505';
      end if;
      if exists(select 1 from public.feature_provider_objects po where po.feature_key='form_coach'
          and po.object_id=price_id and po.object_type<>'price') then
        raise exception 'Provider Price ID is already bound to a different object namespace' using errcode='23505';
      end if;
      price_options:=price_options||jsonb_build_array(option_row||jsonb_build_object('stripe_product_id',product_id,'stripe_price_id',price_id));
    end loop;
    if (select count(*) from public.feature_pricing_sync_objects o where o.request_id=p_request_id and o.object_kind='price' and o.state='verified')<>jsonb_array_length(candidate->'price_options')
      or exists(select 1 from public.feature_pricing_sync_objects o where o.request_id=p_request_id and o.state<>'verified') then
      return query select 'objects_unverified',null::bigint; return;
    end if;
  elsif exists(select 1 from public.feature_pricing_sync_objects o where o.request_id=p_request_id) then
    raise exception 'A non-live pricing change cannot include provider objects' using errcode='22023';
  end if;
  if request_row.state<>'verified' then
    update public.feature_pricing_sync_requests set state='verified',state_revision=state_revision+1,updated_at=now()
      where request_id=p_request_id and state_revision=request_row.state_revision;
    request_row.state_revision:=request_row.state_revision+1;
  end if;
  new_revision:=public.admin_create_feature_pricing_revision(
    'form_coach',p_expected_revision,candidate->>'status',candidate->>'payer',candidate->>'billing_model',
    candidate->>'currency',candidate->>'display_name',candidate->>'description',candidate->>'marketing_copy',
    (candidate->>'trial_days')::integer,(candidate->>'trial_assessments')::integer,price_options
  );
  if product_id is not null then
    insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision)
      values('form_coach','product',product_id,new_revision) on conflict do nothing;
    insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision,price_key)
      select 'form_coach','price',o.provider_object_id,new_revision,o.price_key
      from public.feature_pricing_sync_objects o where o.request_id=p_request_id and o.object_kind='price' and o.provider_object_id is not null
      on conflict do nothing;
  end if;
  update public.feature_pricing_sync_requests set state='cas_applied',state_revision=state_revision+1,
    published_revision=new_revision,updated_at=now() where request_id=p_request_id and state_revision=request_row.state_revision;
  return query select 'applied',new_revision;
end;
$$;
revoke all on function public.admin_publish_feature_pricing_sync(uuid,bigint) from public,anon;
grant execute on function public.admin_publish_feature_pricing_sync(uuid,bigint) to authenticated;
create function public.reserve_feature_customer_create(p_payer_id uuid,p_request_id uuid,p_request_digest text)
returns table(outcome text,attempt_id uuid,customer_id text,state_revision bigint)
language plpgsql security definer set search_path = '' as $$
declare existing public.feature_customer_create_attempts%rowtype; mapped public.feature_payer_customer_mappings%rowtype;
 legacy_customer_id text; legacy_customer_count integer;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_payer_id is null or p_request_id is null or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid customer-create reservation' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payer_id::text,0));
  if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id) then
    return query select 'blocked_deletion',null::uuid,null::text,null::bigint; return;
  end if;
  select * into existing from public.feature_customer_create_attempts a where a.request_id=p_request_id for update;
  if found then
    if existing.payer_id<>p_payer_id or existing.feature_key<>'form_coach' or existing.request_digest<>p_request_digest then
      raise exception 'Customer request ID was reused with different owner or payload' using errcode='23505';
    end if;
    return query select 'existing',existing.id,existing.stripe_customer_id,existing.state_revision; return;
  end if;
  select * into mapped from public.feature_payer_customer_mappings m where m.feature_key='form_coach' and m.payer_id=p_payer_id;
  if found then
    if exists(select 1 from public.feature_provider_objects o where o.object_id=mapped.stripe_customer_id
        and (o.feature_key<>'form_coach' or o.object_type<>'customer' or o.payer_id is distinct from p_payer_id))
      or exists(select 1 from public.feature_customer_create_attempts a where a.stripe_customer_id=mapped.stripe_customer_id
        and (a.feature_key<>'form_coach' or a.payer_id<>p_payer_id)) then
      raise exception 'Existing payer customer mapping conflicts with legacy provider ownership' using errcode='23505';
    end if;
    return query select 'reused',mapped.create_attempt_id,mapped.stripe_customer_id,null::bigint; return;
  end if;
  select * into existing from public.feature_customer_create_attempts a
    where a.feature_key='form_coach' and a.payer_id=p_payer_id and a.state in ('reserved','unknown','bound','cancel_required') for update;
  if found then return query select 'pending_reconciliation',existing.id,existing.stripe_customer_id,existing.state_revision; return; end if;
  select count(*)::integer,min(o.object_id) into legacy_customer_count,legacy_customer_id
    from public.feature_provider_objects o
    where o.feature_key='form_coach' and o.object_type='customer' and o.payer_id=p_payer_id;
  if legacy_customer_count>1 then
    return query select 'legacy_customer_ambiguous',null::uuid,null::text,null::bigint; return;
  elsif legacy_customer_count=1 then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-customer-id:'||legacy_customer_id,0));
    if exists(select 1 from public.feature_provider_objects o where o.object_id=legacy_customer_id
      and (o.feature_key<>'form_coach' or o.object_type<>'customer' or o.payer_id is distinct from p_payer_id))
      or exists(select 1 from public.feature_payer_customer_mappings m where m.stripe_customer_id=legacy_customer_id
        and (m.feature_key<>'form_coach' or m.payer_id<>p_payer_id)) then
      raise exception 'Legacy provider customer ownership conflicts with the Form Coach payer' using errcode='23505';
    end if;
    insert into public.feature_customer_create_attempts(feature_key,payer_id,request_id,request_digest,idempotency_key,state,stripe_customer_id)
      values('form_coach',p_payer_id,p_request_id,p_request_digest,'form-coach-customer:'||p_request_id::text,'bound',legacy_customer_id)
      returning * into existing;
    return query select 'legacy_bound',existing.id,existing.stripe_customer_id,existing.state_revision; return;
  end if;
  insert into public.feature_customer_create_attempts(feature_key,payer_id,request_id,request_digest,idempotency_key)
    values('form_coach',p_payer_id,p_request_id,p_request_digest,'form-coach-customer:'||p_request_id::text)
    returning * into existing;
  return query select 'reserved',existing.id,null::text,existing.state_revision;
end;
$$;
revoke all on function public.reserve_feature_customer_create(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_feature_customer_create(uuid,uuid,text) to service_role;

create function public.advance_feature_customer_create(
  p_attempt_id uuid,p_expected_state_revision bigint,p_next_state text,p_provider_customer_id text
)
returns text language plpgsql security definer set search_path = '' as $$
declare attempt public.feature_customer_create_attempts%rowtype; deleting boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  select * into attempt from public.feature_customer_create_attempts a where a.id=p_attempt_id;
  if not found then return 'missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended(attempt.payer_id::text,0));
  select * into attempt from public.feature_customer_create_attempts a where a.id=p_attempt_id for update;
  if p_expected_state_revision is null or p_expected_state_revision<0 then raise exception 'A non-null customer state revision is required' using errcode='22023'; end if;
  if attempt.state_revision<>p_expected_state_revision then return 'cas_stale'; end if;
  select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=attempt.payer_id) into deleting;
  if p_next_state in ('bound','verified','cancel_required') and nullif(trim(p_provider_customer_id),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-customer-id:'||trim(p_provider_customer_id),0));
    if exists(select 1 from public.feature_provider_objects o where o.object_id=trim(p_provider_customer_id)
      and (o.feature_key<>attempt.feature_key or o.object_type<>'customer' or o.payer_id is distinct from attempt.payer_id))
      or exists(select 1 from public.feature_payer_customer_mappings m where m.stripe_customer_id=trim(p_provider_customer_id)
        and (m.feature_key<>attempt.feature_key or m.payer_id<>attempt.payer_id))
      or exists(select 1 from public.feature_customer_create_attempts other_attempt where other_attempt.id<>attempt.id
        and other_attempt.stripe_customer_id=trim(p_provider_customer_id) and other_attempt.payer_id<>attempt.payer_id) then
      raise exception 'Provider customer ID is already owned by another feature or payer' using errcode='23505';
    end if;
  end if;
  if p_next_state='unknown' and attempt.state='reserved' then
    update public.feature_customer_create_attempts set state='unknown',state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return 'unknown';
  end if;
  if p_next_state='failed' and attempt.state in ('reserved','unknown') then
    update public.feature_customer_create_attempts set state='failed',state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return 'failed';
  end if;
  if p_next_state='bound' and attempt.state in ('reserved','unknown') then
    if nullif(trim(p_provider_customer_id),'') is null then raise exception 'Customer binding ID is required' using errcode='22023'; end if;
    update public.feature_customer_create_attempts set state=case when deleting then 'cancel_required' else 'bound' end,
      stripe_customer_id=trim(p_provider_customer_id),
      state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return case when deleting then 'cancel_required' else 'bound' end;
  end if;
  if p_next_state='cancel_required' and attempt.state in ('reserved','unknown') and deleting then
    if nullif(trim(p_provider_customer_id),'') is null then raise exception 'Late customer ID is required for cancellation' using errcode='22023'; end if;
    update public.feature_customer_create_attempts set state='cancel_required',stripe_customer_id=p_provider_customer_id,
      state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return 'cancel_required';
  end if;
  if p_next_state='cancel_required' and attempt.state='bound' and deleting then
    if p_provider_customer_id is distinct from attempt.stripe_customer_id then raise exception 'Customer ID changed during deletion cleanup' using errcode='23505'; end if;
    update public.feature_customer_create_attempts set state='cancel_required',state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return 'cancel_required';
  end if;
  if p_next_state='verified' and attempt.state='bound' and not deleting then
    if p_provider_customer_id is distinct from attempt.stripe_customer_id then raise exception 'Customer ID changed during verification' using errcode='23505'; end if;
    insert into public.feature_payer_customer_mappings(feature_key,payer_id,stripe_customer_id,create_attempt_id)
    values(attempt.feature_key,attempt.payer_id,attempt.stripe_customer_id,attempt.id);
    update public.feature_customer_create_attempts set state='verified',state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    insert into public.feature_provider_objects(feature_key,object_type,object_id,payer_id)
    values(attempt.feature_key,'customer',attempt.stripe_customer_id,attempt.payer_id) on conflict do nothing;
    return 'verified';
  end if;
  if deleting and attempt.state in ('reserved','unknown') and p_next_state<>'cancel_required' then
    if nullif(trim(p_provider_customer_id),'') is not null then
      update public.feature_customer_create_attempts set state='cancel_required',stripe_customer_id=trim(p_provider_customer_id),
        state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
      return 'cancel_required';
    end if;
    update public.feature_customer_create_attempts set state='blocked_deletion',state_revision=state_revision+1,updated_at=now() where id=p_attempt_id;
    return 'blocked_deletion';
  end if;
  raise exception 'Invalid customer-create state transition' using errcode='22023';
end;
$$;
revoke all on function public.advance_feature_customer_create(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.advance_feature_customer_create(uuid,bigint,text,text) to service_role;

create function public.admin_reserve_feature_contract_move(
  p_request_id uuid,p_subscription_id text,p_expected_contract_version integer,p_expected_contract_revision bigint,
  p_expected_subscription_revision bigint,p_target_revision bigint,p_target_price_key text,
  p_proration_behavior text,p_confirmed boolean,p_request_digest text
)
returns table(outcome text,request_id uuid,state text)
language plpgsql security definer set search_path = '' as $$
declare payer_id_value uuid; subscription public.feature_subscriptions%rowtype;
 current_contract public.feature_subscription_contract_current%rowtype;
 old_contract public.feature_subscription_contract_versions%rowtype;
 target_option public.feature_pricing_options%rowtype; target_revision public.feature_pricing_revisions%rowtype;
 existing public.feature_subscription_contract_move_intents%rowtype;
begin
  if not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
  if p_request_id is null or nullif(trim(p_subscription_id),'') is null
    or p_expected_contract_version is null or p_expected_contract_version<1
    or p_expected_contract_revision is null or p_expected_contract_revision<1
    or p_expected_subscription_revision is null or p_expected_subscription_revision<0
    or p_target_revision is null or p_target_revision<1
    or p_target_price_key is null or p_target_price_key !~ '^[a-z][a-z0-9_]{0,39}$'
    or coalesce(p_proration_behavior,'') not in ('none','create_prorations','always_invoice')
    or p_confirmed is distinct from true or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'A confirmed subscriber price move with current revisions is required' using errcode='22023';
  end if;
  select s.payer_id into payer_id_value from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach';
  if not found then return query select 'subscription_missing',p_request_id,null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(payer_id_value::text,0));
  if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id_value) then
    return query select 'blocked_deletion',p_request_id,null::text; return;
  end if;
  select * into existing from public.feature_subscription_contract_move_intents i where i.request_id=p_request_id;
  if found then
    if existing.stripe_subscription_id<>p_subscription_id or existing.payer_id<>payer_id_value
      or existing.from_contract_version<>p_expected_contract_version
      or existing.expected_contract_state_revision<>p_expected_contract_revision
      or existing.expected_subscription_state_revision<>p_expected_subscription_revision
      or existing.to_config_revision<>p_target_revision or existing.to_price_key<>p_target_price_key
      or existing.proration_behavior<>p_proration_behavior or existing.request_digest<>p_request_digest
      or existing.confirmed_by_admin<>auth.uid() then
      raise exception 'Contract-move request ID was reused with changed confirmation or quote' using errcode='23505';
    end if;
    return query select 'existing',existing.request_id,(select s.state from public.feature_subscription_contract_move_state s where s.request_id=existing.request_id); return;
  end if;
  select * into subscription from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id for update;
  select * into current_contract from public.feature_subscription_contract_current c where c.stripe_subscription_id=p_subscription_id for update;
  if not found or current_contract.contract_version<>p_expected_contract_version
    or current_contract.state_revision<>p_expected_contract_revision
    or subscription.state_revision<>p_expected_subscription_revision then
    return query select 'cas_stale',p_request_id,null::text; return;
  end if;
  if subscription.status not in ('active','trialing') then
    return query select 'subscription_not_movable',p_request_id,null::text; return;
  end if;
  select * into old_contract from public.feature_subscription_contract_versions v
    where v.stripe_subscription_id=p_subscription_id and v.contract_version=current_contract.contract_version;
  select * into target_revision from public.feature_pricing_revisions r
    where r.feature_key='form_coach' and r.revision=p_target_revision;
  select * into target_option from public.feature_pricing_options o
    where o.feature_key='form_coach' and o.revision=p_target_revision and o.price_key=p_target_price_key;
  if target_revision.status<>'live' or target_revision.billing_model<>'subscription'
    or target_revision.payer<>old_contract.payer_role
    or target_option.interval is null or target_option.stripe_product_id is null or target_option.stripe_price_id is null
    or target_option.currency<>old_contract.currency or target_option.interval<>old_contract.billing_interval
    or p_target_revision<=old_contract.config_revision then
    raise exception 'Target price is not compatible with the immutable subscription contract' using errcode='22023';
  end if;
  if exists(select 1 from public.feature_subscription_contract_move_state st
      join public.feature_subscription_contract_move_intents i on i.request_id=st.request_id
      where i.stripe_subscription_id=p_subscription_id and st.state in ('reserved','unknown','provider_verified')) then
    return query select 'pending_contract_move',p_request_id,null::text; return;
  end if;
  insert into public.feature_subscription_contract_move_intents(
    request_id,feature_key,stripe_subscription_id,payer_id,from_contract_version,from_config_revision,
    expected_contract_state_revision,expected_subscription_state_revision,to_config_revision,to_price_key,
    to_stripe_product_id,to_stripe_price_id,to_amount_cents,currency,billing_interval,proration_behavior,
    confirmed_by_admin,confirmed_at,request_digest
  ) values (
    p_request_id,'form_coach',p_subscription_id,payer_id_value,current_contract.contract_version,old_contract.config_revision,
    current_contract.state_revision,subscription.state_revision,p_target_revision,p_target_price_key,
    target_option.stripe_product_id,target_option.stripe_price_id,target_option.amount_cents,target_option.currency,
    target_option.interval,p_proration_behavior,auth.uid(),now(),p_request_digest
  );
  insert into public.feature_subscription_contract_move_state(request_id,state) values(p_request_id,'reserved');
  return query select 'reserved',p_request_id,'reserved'::text;
end;
$$;
revoke all on function public.admin_reserve_feature_contract_move(uuid,text,integer,bigint,bigint,bigint,text,text,boolean,text) from public,anon;
grant execute on function public.admin_reserve_feature_contract_move(uuid,text,integer,bigint,bigint,bigint,text,text,boolean,text) to authenticated;

create function public.apply_feature_contract_move(
  p_request_id uuid,p_expected_contract_state_revision bigint,p_expected_subscription_state_revision bigint,
  p_verified_customer_id text,p_verified_price_id text,p_verified_status text
)
returns table(outcome text,active_contract_version integer)
language plpgsql security definer set search_path = '' as $$
declare intent public.feature_subscription_contract_move_intents%rowtype;
 move_state public.feature_subscription_contract_move_state%rowtype;
 subscription public.feature_subscriptions%rowtype; current_contract public.feature_subscription_contract_current%rowtype;
 next_version integer; deleting boolean;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  select * into intent from public.feature_subscription_contract_move_intents i where i.request_id=p_request_id;
  if not found then return query select 'missing',null::integer; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(intent.payer_id::text,0));
  select * into move_state from public.feature_subscription_contract_move_state s where s.request_id=p_request_id for update;
  if move_state.state='applied' then return query select 'already_applied',move_state.applied_contract_version; return; end if;
  select * into subscription from public.feature_subscriptions s where s.stripe_subscription_id=intent.stripe_subscription_id for update;
  select * into current_contract from public.feature_subscription_contract_current c where c.stripe_subscription_id=intent.stripe_subscription_id for update;
  select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=intent.payer_id) into deleting;
  if deleting then
    update public.feature_subscription_contract_move_state set state='blocked_deletion',state_revision=state_revision+1,updated_at=now()
      where request_id=p_request_id and state_revision=move_state.state_revision;
    return query select 'blocked_deletion',null::integer; return;
  end if;
  if p_expected_contract_state_revision is null or p_expected_contract_state_revision<1
    or p_expected_subscription_state_revision is null or p_expected_subscription_state_revision<0 then
    raise exception 'Contract-move CAS revisions are required' using errcode='22023';
  end if;
  if current_contract.state_revision<>p_expected_contract_state_revision
    or current_contract.contract_version<>intent.from_contract_version
    or subscription.state_revision<>p_expected_subscription_state_revision
    or p_expected_contract_state_revision<>intent.expected_contract_state_revision
    or p_expected_subscription_state_revision<>intent.expected_subscription_state_revision then
    update public.feature_subscription_contract_move_state set state='cas_stale',state_revision=state_revision+1,updated_at=now()
      where request_id=p_request_id and state_revision=move_state.state_revision;
    return query select 'cas_stale',null::integer; return;
  end if;
  if p_verified_customer_id is distinct from subscription.stripe_customer_id
    or p_verified_price_id is distinct from intent.to_stripe_price_id
    or p_verified_status not in ('active','trialing')
    or p_verified_status is distinct from subscription.status then
    update public.feature_subscription_contract_move_state set state='mismatch',state_revision=state_revision+1,updated_at=now()
      where request_id=p_request_id and state_revision=move_state.state_revision;
    return query select 'provider_mismatch',null::integer; return;
  end if;
  next_version:=current_contract.contract_version+1;
  insert into public.feature_subscription_contract_versions(
    stripe_subscription_id,contract_version,feature_key,payer_role,payer_id,config_revision,price_key,
    stripe_product_id,stripe_price_id,amount_cents,currency,billing_interval,migration_request_id,effective_at
  ) values (
    intent.stripe_subscription_id,next_version,intent.feature_key,subscription.payer_role,intent.payer_id,
    intent.to_config_revision,intent.to_price_key,intent.to_stripe_product_id,intent.to_stripe_price_id,
    intent.to_amount_cents,intent.currency,intent.billing_interval,intent.request_id,now()
  );
  update public.feature_subscription_contract_current set contract_version=next_version,
    state_revision=state_revision+1,updated_at=now()
  where stripe_subscription_id=intent.stripe_subscription_id and state_revision=intent.expected_contract_state_revision;
  if not found then raise exception 'Active contract pointer changed during migration' using errcode='40001'; end if;
  update public.feature_subscription_contract_move_state set state='applied',applied_contract_version=next_version,
    state_revision=state_revision+1,updated_at=now()
  where request_id=p_request_id and state_revision=move_state.state_revision;
  if not found then raise exception 'Contract move state changed during migration' using errcode='40001'; end if;
  return query select 'applied',next_version;
end;
$$;
revoke all on function public.apply_feature_contract_move(uuid,bigint,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.apply_feature_contract_move(uuid,bigint,bigint,text,text,text) to service_role;

create function public.record_feature_trial_claim(
  p_request_id uuid,p_payer_id uuid,p_config_revision bigint,p_trial_kind text,p_source_kind text,
  p_source_id text,p_subscription_id text,p_starts_at timestamptz,p_expires_at timestamptz,
  p_granted_assessments integer,p_request_digest text
)
returns table(outcome text,claim_id uuid)
language plpgsql security definer set search_path = '' as $$
declare config public.feature_pricing_revisions%rowtype; payer_role_value text; existing public.feature_trial_claims%rowtype;
 new_claim_id uuid; profile_role text; source_config_revision bigint; current_config_revision bigint;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if p_request_id is null or p_payer_id is null or p_config_revision is null
    or coalesce(p_trial_kind,'') not in ('trial_days','trial_assessments')
    or coalesce(p_source_kind,'') not in ('subscription','subscription_invoice','assessment_trial')
    or nullif(trim(p_source_id),'') is null or p_starts_at is null
    or p_granted_assessments is null or p_granted_assessments<0
    or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid Form Coach trial claim' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_payer_id::text,0));
  if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id) then
    return query select 'blocked_deletion',null::uuid; return;
  end if;
  select * into existing from public.feature_trial_claims c where c.request_id=p_request_id;
  if found then
    if existing.feature_key<>'form_coach' or existing.payer_id<>p_payer_id or existing.config_revision<>p_config_revision
      or existing.trial_kind<>p_trial_kind or existing.source_kind<>p_source_kind or existing.source_id<>p_source_id
      or existing.stripe_subscription_id is distinct from p_subscription_id or existing.starts_at<>p_starts_at
      or existing.expires_at is distinct from p_expires_at or existing.granted_assessments<>p_granted_assessments
      or existing.request_digest<>p_request_digest then
      raise exception 'Trial request ID was reused with changed owner or source' using errcode='23505';
    end if;
    return query select 'already_claimed',existing.id; return;
  end if;
  if not exists(select 1 from public.feature_pricing_current c join public.feature_pricing_revisions r
      on r.feature_key=c.feature_key and r.revision=c.revision
      where c.feature_key='form_coach' and r.status='live') then
    return query select 'feature_unavailable',null::uuid; return;
  end if;
  if exists(select 1 from public.feature_trial_claims c where c.feature_key='form_coach' and c.payer_id=p_payer_id)
    or exists(select 1 from public.feature_trial_access_grants g where g.feature_key='form_coach' and g.user_id=p_payer_id)
    or exists(select 1 from public.feature_credit_lots l where l.feature_key='form_coach' and l.user_id=p_payer_id and l.lot_kind='assessment_trial') then
    return query select 'already_claimed',null::uuid; return;
  end if;
  select * into config from public.feature_pricing_revisions r where r.feature_key='form_coach' and r.revision=p_config_revision;
  if not found then return query select 'invalid_revision',null::uuid; return; end if;
  if p_trial_kind='trial_assessments' then
    select c.revision into current_config_revision from public.feature_pricing_current c where c.feature_key='form_coach';
    if current_config_revision is distinct from p_config_revision then
      return query select 'stale_config_revision',null::uuid; return;
    end if;
  elsif p_trial_kind='trial_days' and p_source_kind='subscription' then
    select v.config_revision into source_config_revision
    from public.feature_subscription_contract_current c
    join public.feature_subscription_contract_versions v on v.stripe_subscription_id=c.stripe_subscription_id
      and v.contract_version=c.contract_version
    where c.stripe_subscription_id=p_subscription_id and c.feature_key='form_coach';
  elsif p_trial_kind='trial_days' and p_source_kind='subscription_invoice' then
    select v.config_revision into source_config_revision
    from public.feature_subscription_invoice_current i
    join public.feature_subscription_contract_versions v on v.stripe_subscription_id=i.subscription_id
      and v.contract_version=i.contract_version
    where i.invoice_id=p_source_id and i.feature_key='form_coach';
  end if;
  if p_trial_kind='trial_days' and source_config_revision is distinct from p_config_revision then
    raise exception 'Trial offer revision does not match its immutable subscription contract' using errcode='22023';
  end if;
  select p.role::text into profile_role from public.profiles p where p.id=p_payer_id for share;
  if profile_role is null or profile_role<>config.payer then return query select 'payer_mismatch',null::uuid; return; end if;
  if p_trial_kind='trial_days' then
    if config.trial_days<1 or p_source_kind not in ('subscription','subscription_invoice')
      or p_subscription_id is null or p_expires_at is null or p_expires_at<=p_starts_at
      or p_expires_at>p_starts_at+make_interval(days=>config.trial_days)
      or not exists(select 1 from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id
        and s.feature_key='form_coach' and s.payer_id=p_payer_id and s.status='trialing'
        and p_expires_at<=s.current_period_end
        and ((p_source_kind='subscription' and p_source_id=p_subscription_id)
          or (p_source_kind='subscription_invoice' and exists(
            select 1 from public.feature_subscription_invoice_current i
            where i.invoice_id=p_source_id and i.subscription_id=p_subscription_id and i.payer_id=p_payer_id
              and i.status='paid' and i.amount_due_cents=0 and i.amount_paid_cents=0
              and i.period_start<=p_starts_at and i.period_end>=p_expires_at
          )))) then
      raise exception 'Time-trial claim does not match its verified subscription offer' using errcode='22023';
    end if;
  elsif p_trial_kind='trial_assessments' then
    if config.trial_assessments<1 or p_source_kind<>'assessment_trial' or p_subscription_id is not null
      or p_expires_at is not null or p_granted_assessments<>config.trial_assessments then
      raise exception 'Assessment-trial claim does not match its revision count' using errcode='22023';
    end if;
  end if;
  insert into public.feature_trial_claims(request_id,feature_key,payer_id,config_revision,trial_kind,source_kind,source_id,
    stripe_subscription_id,starts_at,expires_at,granted_assessments,request_digest)
  values(p_request_id,'form_coach',p_payer_id,p_config_revision,p_trial_kind,p_source_kind,p_source_id,
    p_subscription_id,p_starts_at,p_expires_at,p_granted_assessments,p_request_digest)
  returning id into new_claim_id;
  if p_trial_kind='trial_days' then
    insert into public.feature_trial_access_grants(feature_key,user_id,starts_at,expires_at,source,source_id)
    values('form_coach',p_payer_id,p_starts_at,p_expires_at,'subscription_trial',p_subscription_id);
  else
    insert into public.feature_credit_lots(feature_key,user_id,lot_kind,source_grant_id,trial_claim_id,
      granted_units,remaining_units,expires_at)
    values('form_coach',p_payer_id,'assessment_trial',null,new_claim_id,p_granted_assessments,p_granted_assessments,null);
    insert into public.feature_credit_ledger(feature_key,user_id,lot_id,operation_key,entry_kind,delta_units)
    values('form_coach',p_payer_id,(select l.id from public.feature_credit_lots l where l.trial_claim_id=new_claim_id),
      'trial:'||p_request_id::text,'grant',p_granted_assessments);
  end if;
  return query select 'claimed',new_claim_id;
end;
$$;
revoke all on function public.record_feature_trial_claim(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz,integer,text) from public,anon,authenticated;
grant execute on function public.record_feature_trial_claim(uuid,uuid,bigint,text,text,text,text,timestamptz,timestamptz,integer,text) to service_role;

create function private.capture_feature_subscription_checkout_proof(p_subscription_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare subscription public.feature_subscriptions%rowtype; contract_version_value integer; receipt_id_value uuid;
 paid_through_value timestamptz;
begin
  select * into subscription from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach' and s.status='active';
  if not found or subscription.current_period_end<=now()
    or exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=subscription.payer_id) then
    return;
  end if;
  select v.contract_version into contract_version_value
  from public.feature_subscription_contract_versions v
  where v.stripe_subscription_id=subscription.stripe_subscription_id and v.feature_key='form_coach'
    and v.config_revision=subscription.config_revision and v.price_key=subscription.price_key
  order by v.contract_version limit 1;
  if contract_version_value is null then return; end if;
  select r.id,i.period_end into receipt_id_value,paid_through_value
  from public.feature_payment_receipts r
  join public.feature_checkout_reservations checkout on checkout.id=r.reservation_id
  join public.feature_subscription_contract_versions v
    on v.stripe_subscription_id=subscription.stripe_subscription_id and v.contract_version=contract_version_value
  join public.feature_subscription_invoice_current i
    on i.subscription_id=subscription.stripe_subscription_id and i.feature_key='form_coach'
      and i.payer_id=subscription.payer_id and i.contract_version=v.contract_version
      and i.payment_intent_id=r.payment_intent_id
  where r.feature_key='form_coach' and r.payer_id=subscription.payer_id and r.disposition='applied'
    and checkout.state='paid' and checkout.stripe_customer_id=subscription.stripe_customer_id
    and r.amount_cents>0 and r.currency=v.currency and r.amount_cents=v.amount_cents
    and r.config_revision=v.config_revision and r.price_key=v.price_key and r.stripe_price_id=v.stripe_price_id
    and coalesce(r.stripe_subscription_id,checkout.stripe_subscription_id)=subscription.stripe_subscription_id
    and r.payment_intent_id is not null and i.status='paid' and i.amount_paid_cents>0
    and i.net_settled_cents>0 and i.refund_state='none'
    and not exists(select 1 from public.feature_subscription_refund_events refund_event
      where (refund_event.payer_id is null or refund_event.payer_id=i.payer_id)
        and refund_event.currency=i.currency
        and (refund_event.invoice_id=i.invoice_id or refund_event.payment_intent_id=i.payment_intent_id
          or (i.charge_id is not null and refund_event.charge_id=i.charge_id)))
  order by r.recorded_at,r.id limit 1;
  if receipt_id_value is null then return; end if;
  insert into public.feature_subscription_checkout_access_proofs(subscription_id,payer_id,receipt_id,contract_version,paid_through)
  values(subscription.stripe_subscription_id,subscription.payer_id,receipt_id_value,contract_version_value,paid_through_value)
  on conflict(subscription_id) do nothing;
end;
$$;
revoke all on function private.capture_feature_subscription_checkout_proof(text) from public,anon,authenticated;

create function private.recompute_feature_subscription_access(p_subscription_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare subscription public.feature_subscriptions%rowtype; paid_through timestamptz; trial_through timestamptz;
 paid_deadline timestamptz; trial_deadline timestamptz; access_deadline timestamptz;
begin
  select * into subscription from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id;
  if not found then return; end if;
  select max(proof.paid_through) into paid_through from (
    select i.period_end as paid_through from public.feature_subscription_invoice_current i
      where i.subscription_id=p_subscription_id and i.feature_key=subscription.feature_key and i.payer_id=subscription.payer_id
        and i.status='paid' and i.net_settled_cents>0 and i.refund_state='none'
        and not exists(select 1 from public.feature_subscription_refund_events refund_event
          where (refund_event.payer_id is null or refund_event.payer_id=i.payer_id)
            and refund_event.currency=i.currency
            and (refund_event.invoice_id=i.invoice_id
              or (i.payment_intent_id is not null and refund_event.payment_intent_id=i.payment_intent_id)
              or (i.charge_id is not null and refund_event.charge_id=i.charge_id)))
    union all
    select proof.paid_through from public.feature_subscription_checkout_access_proofs proof
      join public.feature_payment_receipts receipt on receipt.id=proof.receipt_id
      where proof.subscription_id=p_subscription_id and proof.payer_id=subscription.payer_id
        -- A durable refund marker blocks this checkout proof even before an invoice projection
        -- advances from none; stale CAS must not leave the receipt as an access fallback.
        and not exists(select 1 from public.feature_subscription_refund_events refund_event
          where (refund_event.payer_id is null or refund_event.payer_id=proof.payer_id)
            and refund_event.currency=receipt.currency
            and ((receipt.payment_intent_id is not null and refund_event.payment_intent_id=receipt.payment_intent_id)
              or exists(select 1 from public.feature_subscription_invoice_current i
                where i.subscription_id=p_subscription_id and i.payer_id=proof.payer_id
                  and i.currency=receipt.currency and i.payment_intent_id=receipt.payment_intent_id
                  and (refund_event.invoice_id=i.invoice_id
                    or (refund_event.charge_id is not null and refund_event.charge_id=i.charge_id)))))
  ) proof;
  select max(x.expires_at) into trial_through from (
    select c.expires_at from public.feature_trial_claims c
      where c.feature_key=subscription.feature_key and c.payer_id=subscription.payer_id
        and c.trial_kind='trial_days' and c.stripe_subscription_id=p_subscription_id
  ) x;
  if paid_through is not null then paid_deadline:=least(subscription.current_period_end,paid_through); end if;
  if trial_through is not null then trial_deadline:=least(subscription.current_period_end,trial_through); end if;
  if subscription.status in ('active','trialing') then access_deadline:=greatest(paid_deadline,trial_deadline); end if;
  if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=subscription.payer_id) then
    access_deadline:=null;
  end if;
  insert into public.feature_subscription_access_current(
    subscription_id,feature_key,payer_id,provider_period_end,verified_paid_through,verified_trial_through,access_through,proof_revision,updated_at
  ) values (
    subscription.stripe_subscription_id,subscription.feature_key,subscription.payer_id,subscription.current_period_end,
    paid_through,trial_through,access_deadline,1,now()
  ) on conflict(subscription_id) do update set provider_period_end=excluded.provider_period_end,
    verified_paid_through=excluded.verified_paid_through,verified_trial_through=excluded.verified_trial_through,
    access_through=excluded.access_through,proof_revision=public.feature_subscription_access_current.proof_revision+1,updated_at=now();
end;
$$;
revoke all on function private.recompute_feature_subscription_access(text) from public,anon,authenticated;

create function private.refresh_feature_subscription_access_from_subscription()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.capture_feature_subscription_checkout_proof(new.stripe_subscription_id);
  perform private.recompute_feature_subscription_access(new.stripe_subscription_id);
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_subscription() from public,anon,authenticated;
create trigger feature_subscription_access_state_refresh after insert or update on public.feature_subscriptions
  for each row execute function private.refresh_feature_subscription_access_from_subscription();

create function private.refresh_feature_subscription_access_from_checkout_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare subscription_id_value text;
begin
  select coalesce(new.stripe_subscription_id,checkout.stripe_subscription_id) into subscription_id_value
  from public.feature_checkout_reservations checkout where checkout.id=new.reservation_id;
  if subscription_id_value is not null then
    perform private.capture_feature_subscription_checkout_proof(subscription_id_value);
    perform private.recompute_feature_subscription_access(subscription_id_value);
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_checkout_receipt() from public,anon,authenticated;
create trigger feature_subscription_checkout_receipt_access_refresh after insert on public.feature_payment_receipts
  for each row execute function private.refresh_feature_subscription_access_from_checkout_receipt();

create function private.refresh_feature_subscription_access_from_checkout_reservation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.state='paid' and old.state is distinct from new.state and new.stripe_subscription_id is not null then
    perform private.capture_feature_subscription_checkout_proof(new.stripe_subscription_id);
    perform private.recompute_feature_subscription_access(new.stripe_subscription_id);
  end if;
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_checkout_reservation() from public,anon,authenticated;
create trigger feature_checkout_paid_access_refresh after update of state on public.feature_checkout_reservations
  for each row execute function private.refresh_feature_subscription_access_from_checkout_reservation();

create function private.refresh_feature_subscription_access_from_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.capture_feature_subscription_checkout_proof(new.subscription_id);
  perform private.recompute_feature_subscription_access(new.subscription_id);
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_invoice() from public,anon,authenticated;
create trigger feature_invoice_access_refresh after insert or update on public.feature_subscription_invoice_current
  for each row execute function private.refresh_feature_subscription_access_from_invoice();

create function private.refresh_feature_subscription_access_from_refund()
returns trigger language plpgsql security definer set search_path = '' as $$
declare affected record;
begin
  for affected in
    select distinct i.subscription_id from public.feature_subscription_invoice_current i
    where (new.invoice_id is not null and i.invoice_id=new.invoice_id)
      or (new.payment_intent_id is not null and i.payment_intent_id=new.payment_intent_id)
      or (new.charge_id is not null and i.charge_id=new.charge_id)
    union
    select distinct coalesce(receipt.stripe_subscription_id,checkout.stripe_subscription_id) as subscription_id
    from public.feature_payment_receipts receipt
    join public.feature_checkout_reservations checkout on checkout.id=receipt.reservation_id
    where (new.payment_intent_id is not null and receipt.payment_intent_id=new.payment_intent_id)
      or (new.charge_id is not null and exists(select 1 from public.feature_subscription_invoice_current i
        where i.subscription_id=coalesce(receipt.stripe_subscription_id,checkout.stripe_subscription_id)
          and i.charge_id=new.charge_id))
  loop
    if affected.subscription_id is not null then perform private.recompute_feature_subscription_access(affected.subscription_id); end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_refund() from public,anon,authenticated;
create trigger feature_refund_access_refresh after insert or update on public.feature_subscription_refund_events
  for each row execute function private.refresh_feature_subscription_access_from_refund();

create function private.refresh_feature_subscription_access_from_trial()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stripe_subscription_id is not null then perform private.recompute_feature_subscription_access(new.stripe_subscription_id); end if;
  return new;
end;
$$;
revoke all on function private.refresh_feature_subscription_access_from_trial() from public,anon,authenticated;
create trigger feature_trial_access_refresh after insert on public.feature_trial_claims
  for each row execute function private.refresh_feature_subscription_access_from_trial();

do $$
declare subscription_id_value text;
begin
  for subscription_id_value in select s.stripe_subscription_id from public.feature_subscriptions s
    where s.feature_key='form_coach' and s.status='active'
  loop
    perform private.capture_feature_subscription_checkout_proof(subscription_id_value);
    perform private.recompute_feature_subscription_access(subscription_id_value);
  end loop;
end;
$$;

create function public.record_feature_subscription_invoice(
  p_event_id text,p_event_type text,p_identity_digest text,p_invoice_id text,p_subscription_id text,
  p_payer_id uuid,p_contract_version integer,p_status text,p_currency text,p_amount_due_cents bigint,
  p_amount_paid_cents bigint,p_period_start timestamptz,p_period_end timestamptz,p_payment_intent_id text,
  p_charge_id text,p_trial_claim_id uuid,p_expected_invoice_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare event_row public.feature_subscription_invoice_events%rowtype; event_state public.feature_subscription_invoice_event_state%rowtype;
 subscription public.feature_subscriptions%rowtype; contract public.feature_subscription_contract_versions%rowtype;
 invoice_row public.feature_subscription_invoice_current%rowtype; expected_refunds bigint; refund_state_value text;
 alias_row public.feature_billing_provider_aliases%rowtype; deletion boolean; existing_event public.feature_billing_event_identity%rowtype;
 mapped_payer_id uuid; actual_payer_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_event_id),'') is null or coalesce(p_event_type,'') not in ('invoice.paid','invoice.payment_failed','invoice.finalized','invoice.voided')
    or p_identity_digest is null or p_identity_digest !~ '^[a-f0-9]{64}$'
    or nullif(trim(p_invoice_id),'') is null or nullif(trim(p_subscription_id),'') is null
    or p_contract_version is null or p_contract_version<1
    or coalesce(p_status,'') not in ('draft','open','paid','void','uncollectible','unknown')
    or coalesce(p_currency,'') !~ '^[A-Z]{3}$' or p_amount_due_cents is null or p_amount_due_cents<0
    or p_amount_paid_cents is null or p_amount_paid_cents<0
    or p_period_start is null or p_period_end is null or p_period_end<=p_period_start
    or p_expected_invoice_revision is null or p_expected_invoice_revision<0
    or (p_event_type='invoice.paid' and p_status<>'paid')
    or (p_event_type='invoice.voided' and p_status<>'void')
    or (p_event_type='invoice.finalized' and p_status not in ('open','paid'))
    or (p_event_type='invoice.payment_failed' and p_status not in ('open','uncollectible')) then
    raise exception 'Invalid verified subscription invoice snapshot' using errcode='22023';
  end if;
  -- Lock provider identities first in fixed invoice/PI/charge order, then the resolved payer.
  -- Refund reconciliation uses the same order before it re-resolves invoice ownership.
  perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:invoice:'||p_invoice_id,0));
  if p_payment_intent_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:payment_intent:'||p_payment_intent_id,0));
  end if;
  if p_charge_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:charge:'||p_charge_id,0));
  end if;
  select s.payer_id into mapped_payer_id from public.feature_subscriptions s
    where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach';
  actual_payer_id:=coalesce(mapped_payer_id,p_payer_id);
  if actual_payer_id is not null then perform pg_advisory_xact_lock(hashtextextended(actual_payer_id::text,0)); end if;
  select * into existing_event from public.feature_billing_event_identity e where e.event_id=p_event_id for update;
  if found then
    if existing_event.event_type<>p_event_type or existing_event.object_kind<>'invoice'
      or existing_event.object_id<>p_invoice_id or existing_event.identity_digest<>p_identity_digest then
      raise exception 'Provider event ID was reused with changed invoice identity' using errcode='23505';
    end if;
    select * into event_state from public.feature_subscription_invoice_event_state s where s.event_id=p_event_id for update;
    if event_state.state in ('applied','blocked_deletion','mismatch','manual_review') then return 'duplicate_event'; end if;
  else
    insert into public.feature_billing_event_identity(event_id,event_type,object_kind,object_id,identity_digest)
      values(p_event_id,p_event_type,'invoice',p_invoice_id,p_identity_digest);
    insert into public.feature_subscription_invoice_events(event_id,event_type,invoice_id,subscription_id,payer_id,identity_digest)
      values(p_event_id,p_event_type,p_invoice_id,p_subscription_id,actual_payer_id,p_identity_digest);
    insert into public.feature_subscription_invoice_event_state(event_id,state) values(p_event_id,'received');
    select * into event_state from public.feature_subscription_invoice_event_state s where s.event_id=p_event_id for update;
  end if;
  if mapped_payer_id is not null and p_payer_id is not null and mapped_payer_id<>p_payer_id then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_invoice_owner';
  end if;
  if mapped_payer_id is null or actual_payer_id is null then
    update public.feature_subscription_invoice_event_state set state='retryable',state_revision=state_revision+1,updated_at=now() where event_id=p_event_id;
    return 'retryable_unmatched_subscription';
  end if;
  p_payer_id:=mapped_payer_id;
  select * into subscription from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach' for share;
  select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id) into deletion;
  if deletion then
    update public.feature_subscription_invoice_event_state set state='blocked_deletion',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'blocked_deletion';
  end if;
  select * into contract from public.feature_subscription_contract_versions v
    where v.stripe_subscription_id=p_subscription_id and v.contract_version=p_contract_version
      and v.feature_key='form_coach' and v.payer_id=p_payer_id;
  if not found then
    update public.feature_subscription_invoice_event_state set state='retryable',state_revision=state_revision+1,updated_at=now() where event_id=p_event_id;
    return 'retryable_unmatched_contract';
  end if;
  if contract.currency<>p_currency then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_invoice_currency';
  end if;
  if p_trial_claim_id is not null and not exists(select 1 from public.feature_trial_claims c
      where c.id=p_trial_claim_id and c.feature_key='form_coach' and c.payer_id=p_payer_id
        and c.trial_kind='trial_days' and c.stripe_subscription_id=p_subscription_id
        and ((c.source_kind='subscription' and c.source_id=p_subscription_id)
          or (c.source_kind='subscription_invoice' and c.source_id=p_invoice_id))
        and c.starts_at<=p_period_start and c.expires_at>=p_period_end) then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_trial_claim';
  end if;
  if p_amount_paid_cents=0 and p_trial_claim_id is not null and (p_status<>'paid' or p_amount_due_cents<>0) then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_trial_invoice';
  end if;
  if p_trial_claim_id is not null and (p_amount_due_cents<>0 or p_amount_paid_cents<>0 or p_status<>'paid') then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_trial_invoice';
  end if;
  select * into invoice_row from public.feature_subscription_invoice_current i where i.invoice_id=p_invoice_id for update;
  if (not found and p_expected_invoice_revision<>0)
    or (found and invoice_row.state_revision<>p_expected_invoice_revision) then
    update public.feature_subscription_invoice_event_state set state='stale',state_revision=state_revision+1,updated_at=now() where event_id=p_event_id;
    return 'cas_stale';
  end if;
  for alias_row in
    select * from public.feature_billing_provider_aliases a
    where a.object_kind='invoice' and a.object_id=p_invoice_id
       or (p_payment_intent_id is not null and a.object_kind='payment_intent' and a.object_id=p_payment_intent_id)
       or (p_charge_id is not null and a.object_kind='charge' and a.object_id=p_charge_id)
    for update
  loop
    if alias_row.payer_id<>p_payer_id or alias_row.subscription_id<>p_subscription_id or alias_row.invoice_id<>p_invoice_id then
      update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
        processed_at=now(),updated_at=now() where event_id=p_event_id;
      return 'mismatch_provider_alias';
    end if;
  end loop;
  if exists(select 1 from public.feature_subscription_refund_events r
      where r.payer_id is not null and r.payer_id<>p_payer_id and ((p_invoice_id is not null and r.invoice_id=p_invoice_id)
        or (p_payment_intent_id is not null and r.payment_intent_id=p_payment_intent_id)
        or (p_charge_id is not null and r.charge_id=p_charge_id))) then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_refund_owner';
  end if;
  if exists(select 1 from public.feature_subscription_refund_events r
      where r.payer_id=p_payer_id and r.currency<>p_currency
        and ((r.invoice_id=p_invoice_id)
          or (p_payment_intent_id is not null and r.payment_intent_id=p_payment_intent_id)
          or (p_charge_id is not null and r.charge_id=p_charge_id))) then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_refund_currency';
  end if;
  update public.feature_subscription_refund_events r set invoice_id=coalesce(r.invoice_id,p_invoice_id),payer_id=coalesce(r.payer_id,p_payer_id)
    where (r.invoice_id is null or r.invoice_id=p_invoice_id) and (r.payer_id is null or r.payer_id=p_payer_id) and r.currency=p_currency
      and ((p_invoice_id is not null and r.invoice_id=p_invoice_id)
        or (p_payment_intent_id is not null and r.payment_intent_id=p_payment_intent_id)
        or (p_charge_id is not null and r.charge_id=p_charge_id));
  select coalesce(sum(r.amount_cents),0)::bigint into expected_refunds from public.feature_subscription_refund_events r
    where r.invoice_id=p_invoice_id and r.payer_id=p_payer_id and r.currency=p_currency;
  if expected_refunds>p_amount_paid_cents and p_status<>'paid' then
    update public.feature_subscription_invoice_event_state set state='retryable',state_revision=state_revision+1,updated_at=now() where event_id=p_event_id;
    return 'retryable_refund_invoice_state';
  end if;
  if expected_refunds>p_amount_paid_cents then
    update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
      processed_at=now(),updated_at=now() where event_id=p_event_id;
    return 'mismatch_refund_total';
  end if;
  refund_state_value:=case when expected_refunds=0 then 'none'
    when expected_refunds=p_amount_paid_cents and p_amount_paid_cents>0 then 'fully_refunded'
    else 'partial_review' end;
  if exists(select 1 from public.feature_billing_provider_aliases a where a.object_kind='invoice' and a.object_id=p_invoice_id) then
    update public.feature_subscription_invoice_current set status=p_status,amount_due_cents=p_amount_due_cents,
      amount_paid_cents=p_amount_paid_cents,payment_intent_id=p_payment_intent_id,charge_id=p_charge_id,
      trial_claim_id=p_trial_claim_id,refund_total_cents=expected_refunds,refund_state=refund_state_value,
      last_event_id=p_event_id,state_revision=state_revision+1,updated_at=now()
    where invoice_id=p_invoice_id and state_revision=p_expected_invoice_revision;
  else
    if p_expected_invoice_revision<>0 then return 'cas_stale'; end if;
    insert into public.feature_subscription_invoice_current(
      invoice_id,feature_key,subscription_id,payer_id,contract_version,status,currency,amount_due_cents,amount_paid_cents,
      period_start,period_end,payment_intent_id,charge_id,trial_claim_id,refund_total_cents,refund_state,last_event_id,state_revision
    ) values (
      p_invoice_id,'form_coach',p_subscription_id,p_payer_id,p_contract_version,p_status,p_currency,p_amount_due_cents,p_amount_paid_cents,
      p_period_start,p_period_end,p_payment_intent_id,p_charge_id,p_trial_claim_id,expected_refunds,refund_state_value,p_event_id,1
    );
    insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
      values('invoice',p_invoice_id,'form_coach',p_payer_id,p_subscription_id,p_invoice_id);
  end if;
  if p_payment_intent_id is not null then
    insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
      values('payment_intent',p_payment_intent_id,'form_coach',p_payer_id,p_subscription_id,p_invoice_id)
      on conflict(object_kind,object_id) do nothing;
    if not exists(select 1 from public.feature_billing_provider_aliases a where a.object_kind='payment_intent'
      and a.object_id=p_payment_intent_id and a.invoice_id=p_invoice_id and a.payer_id=p_payer_id) then
      update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
        processed_at=now(),updated_at=now() where event_id=p_event_id;
      return 'mismatch_payment_intent_alias';
    end if;
  end if;
  if p_charge_id is not null then
    insert into public.feature_billing_provider_aliases(object_kind,object_id,feature_key,payer_id,subscription_id,invoice_id)
      values('charge',p_charge_id,'form_coach',p_payer_id,p_subscription_id,p_invoice_id)
      on conflict(object_kind,object_id) do nothing;
    if not exists(select 1 from public.feature_billing_provider_aliases a where a.object_kind='charge'
      and a.object_id=p_charge_id and a.invoice_id=p_invoice_id and a.payer_id=p_payer_id) then
      update public.feature_subscription_invoice_event_state set state='mismatch',state_revision=state_revision+1,
        processed_at=now(),updated_at=now() where event_id=p_event_id;
      return 'mismatch_charge_alias';
    end if;
  end if;
  update public.feature_subscription_invoice_event_state set state=case when refund_state_value='partial_review' then 'manual_review' else 'applied' end,
    state_revision=state_revision+1,processed_at=now(),updated_at=now() where event_id=p_event_id;
  return case when refund_state_value='partial_review' then 'manual_review' else 'applied' end;
end;
$$;
revoke all on function public.record_feature_subscription_invoice(text,text,text,text,text,uuid,integer,text,text,bigint,bigint,timestamptz,timestamptz,text,text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.record_feature_subscription_invoice(text,text,text,text,text,uuid,integer,text,text,bigint,bigint,timestamptz,timestamptz,text,text,uuid,bigint) to service_role;

create function public.record_feature_subscription_refund(
  p_event_id text,p_event_type text,p_identity_digest text,p_refund_id text,p_invoice_id text,
  p_payment_intent_id text,p_charge_id text,p_payer_id uuid,p_amount_cents bigint,p_currency text,p_expected_invoice_revision bigint
)
returns text language plpgsql security definer set search_path = '' as $$
declare existing_event public.feature_billing_event_identity%rowtype; refund_row public.feature_subscription_refund_events%rowtype;
 refund_event_state public.feature_subscription_refund_event_state%rowtype;
 invoice_id_value text; actual_payer_id uuid; invoice_row public.feature_subscription_invoice_current%rowtype;
 payment_intent_invoice_id text; charge_invoice_id text; refund_total bigint; refund_state_value text;
begin
  if auth.role()<>'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
  if nullif(trim(p_event_id),'') is null or coalesce(p_event_type,'') not in ('charge.refunded','refund.updated')
    or p_identity_digest is null or p_identity_digest !~ '^[a-f0-9]{64}$'
    or nullif(trim(p_refund_id),'') is null
    or (p_invoice_id is null and p_payment_intent_id is null and p_charge_id is null)
    or p_amount_cents is null or p_amount_cents<1 or coalesce(p_currency,'') !~ '^[A-Z]{3}$'
     or p_expected_invoice_revision is null or p_expected_invoice_revision<0 then
    raise exception 'Invalid subscription refund event' using errcode='22023';
  end if;
  -- Use the same identity-first invoice/PI/charge order as invoice reconciliation. Once these
  -- locks are held, resolve ownership and only then take the payer/deletion fence lock.
  if p_invoice_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:invoice:'||p_invoice_id,0));
  end if;
  if p_payment_intent_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:payment_intent:'||p_payment_intent_id,0));
  end if;
  if p_charge_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('form-coach-alias:charge:'||p_charge_id,0));
  end if;
  invoice_id_value:=p_invoice_id;
  if p_payment_intent_id is not null then
    select a.invoice_id into payment_intent_invoice_id from public.feature_billing_provider_aliases a
      where a.object_kind='payment_intent' and a.object_id=p_payment_intent_id;
  end if;
  if p_charge_id is not null then
    select a.invoice_id into charge_invoice_id from public.feature_billing_provider_aliases a
      where a.object_kind='charge' and a.object_id=p_charge_id;
  end if;
  if invoice_id_value is not null and ((payment_intent_invoice_id is not null and payment_intent_invoice_id<>invoice_id_value)
      or (charge_invoice_id is not null and charge_invoice_id<>invoice_id_value))
    or payment_intent_invoice_id is not null and charge_invoice_id is not null and payment_intent_invoice_id<>charge_invoice_id then
    raise exception 'Refund provider aliases resolve to different invoices' using errcode='23505';
  end if;
  invoice_id_value:=coalesce(invoice_id_value,payment_intent_invoice_id,charge_invoice_id);
  if invoice_id_value is not null then
    select i.payer_id into actual_payer_id from public.feature_subscription_invoice_current i where i.invoice_id=invoice_id_value;
  end if;
  actual_payer_id:=coalesce(actual_payer_id,p_payer_id);
  if actual_payer_id is not null then perform pg_advisory_xact_lock(hashtextextended(actual_payer_id::text,0)); end if;
  select * into existing_event from public.feature_billing_event_identity e where e.event_id=p_event_id for update;
  if found then
    if existing_event.event_type<>p_event_type or existing_event.object_kind<>'refund'
      or existing_event.object_id<>p_refund_id or existing_event.identity_digest<>p_identity_digest then
      raise exception 'Provider event ID was reused with changed refund identity' using errcode='23505';
    end if;
  else
    insert into public.feature_billing_event_identity(event_id,event_type,object_kind,object_id,identity_digest)
      values(p_event_id,p_event_type,'refund',p_refund_id,p_identity_digest);
  end if;
  select * into refund_event_state from public.feature_subscription_refund_event_state s where s.event_id=p_event_id for update;
  if found then
    if refund_event_state.state in ('applied','manual_review','mismatch','blocked_deletion') then return 'duplicate_event'; end if;
  else
    insert into public.feature_subscription_refund_event_state(event_id,state) values(p_event_id,'received');
    select * into refund_event_state from public.feature_subscription_refund_event_state s where s.event_id=p_event_id for update;
  end if;
  select * into refund_row from public.feature_subscription_refund_events r where r.refund_id=p_refund_id for update;
  if found then
    if (refund_row.payer_id is not null and refund_row.payer_id is distinct from actual_payer_id)
      or refund_row.amount_cents<>p_amount_cents or refund_row.currency<>p_currency
      or refund_row.payment_intent_id is distinct from p_payment_intent_id
      or refund_row.charge_id is distinct from p_charge_id
      or (refund_row.invoice_id is not null and refund_row.invoice_id is distinct from invoice_id_value) then
      raise exception 'Refund ID was reused with changed payer, amount or invoice identity' using errcode='23505';
    end if;
  else
    insert into public.feature_subscription_refund_events(
      refund_id,event_id,invoice_id,payment_intent_id,charge_id,payer_id,amount_cents,currency,identity_digest
    ) values(p_refund_id,p_event_id,invoice_id_value,p_payment_intent_id,p_charge_id,actual_payer_id,p_amount_cents,p_currency,p_identity_digest)
    returning * into refund_row;
  end if;
  if invoice_id_value is null then
    update public.feature_subscription_refund_event_state set state='retryable',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'unmatched_refund';
  end if;
  select * into invoice_row from public.feature_subscription_invoice_current i where i.invoice_id=invoice_id_value for update;
  if not found then
    update public.feature_subscription_refund_event_state set state='retryable',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'unmatched_refund';
  end if;
  if invoice_row.payer_id is distinct from actual_payer_id or invoice_row.currency<>p_currency
    or invoice_row.payment_intent_id is distinct from p_payment_intent_id and p_payment_intent_id is not null
    or invoice_row.charge_id is distinct from p_charge_id and p_charge_id is not null then
    update public.feature_subscription_refund_event_state set state='mismatch',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'mismatch_refund_identity';
  end if;
  if refund_row.invoice_id is null or refund_row.payer_id is null then
    update public.feature_subscription_refund_events set invoice_id=coalesce(invoice_id,invoice_id_value),
      payer_id=coalesce(payer_id,actual_payer_id) where refund_id=p_refund_id;
  end if;
  if invoice_row.state_revision<>p_expected_invoice_revision then
    update public.feature_subscription_refund_event_state set state='stale',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'cas_stale';
  end if;
  select coalesce(sum(r.amount_cents),0)::bigint into refund_total from public.feature_subscription_refund_events r
    where r.invoice_id=invoice_id_value and r.payer_id=actual_payer_id and r.currency=p_currency;
  if invoice_row.amount_paid_cents=0 then
    update public.feature_subscription_refund_event_state set state='mismatch',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'mismatch_zero_invoice_refund';
  end if;
  refund_state_value:=case when refund_total=0 then 'none'
    when refund_total>=invoice_row.amount_paid_cents then 'fully_refunded'
    else 'partial_review' end;
  if refund_total>invoice_row.amount_paid_cents then
    update public.feature_subscription_refund_event_state set state='mismatch',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'mismatch_refund_total';
  end if;
  update public.feature_subscription_invoice_current set refund_total_cents=refund_total,refund_state=refund_state_value,
    state_revision=state_revision+1,updated_at=now()
  where invoice_id=invoice_id_value and state_revision=p_expected_invoice_revision;
  if not found then
    update public.feature_subscription_refund_event_state set state='stale',state_revision=state_revision+1,updated_at=now()
      where event_id=p_event_id and state_revision=refund_event_state.state_revision;
    return 'cas_stale';
  end if;
  update public.feature_subscription_refund_event_state set state=case when refund_state_value='partial_review' then 'manual_review' else 'applied' end,
    state_revision=state_revision+1,updated_at=now()
  where event_id=p_event_id and state_revision=refund_event_state.state_revision;
  return case when refund_state_value='partial_review' then 'manual_review' when refund_state_value='fully_refunded' then 'refunded' else 'applied' end;
end;
$$;
revoke all on function public.record_feature_subscription_refund(text,text,text,text,text,text,text,uuid,bigint,text,bigint) from public,anon,authenticated;
grant execute on function public.record_feature_subscription_refund(text,text,text,text,text,text,text,uuid,bigint,text,bigint) to service_role;

-- Preserve the accepted 1A RPC signature but require new subscription access proof from a verified
-- paid invoice or verified trial claim; provider current_period_end alone is not payment evidence.
create or replace function public.record_feature_bundle_funding(
 p_bundle_id uuid,p_feature_key text,p_payer_id uuid,p_config_revision bigint,p_due_at timestamptz,p_operation_key text
)
returns table(outcome text,funding_receipt_id uuid,funding_source text,source_id text,credit_units_consumed integer)
language plpgsql security definer set search_path = '' as $$
declare current_status text; revision_payer text; payer_role_value text;
 existing public.feature_bundle_funding_receipts%rowtype; source_kind text; source_id_value text;
 selected_lot public.feature_credit_lots%rowtype; new_receipt_id uuid; debit integer:=0;
begin
 if p_bundle_id is null or p_feature_key is null or p_payer_id is null or p_config_revision is null
   or p_due_at is null or nullif(trim(p_operation_key),'') is null then
   return query select 'invalid_request',null::uuid,null::text,null::text,0; return;
 end if;
 select r.status into current_status
 from public.feature_pricing_current c join public.feature_pricing_revisions r
   on r.feature_key=c.feature_key and r.revision=c.revision
 where c.feature_key=p_feature_key for share of c;
 if current_status is null then return query select 'unavailable',null::uuid,null::text,null::text,0; return; end if;
 if current_status='disabled' then return query select 'blocked_disabled',null::uuid,null::text,null::text,0; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_payer_id::text,0));
 if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id) then
   return query select 'account_deleting',null::uuid,null::text,null::text,0; return;
 end if;
 select * into existing from public.feature_bundle_funding_receipts f
 where f.feature_key=p_feature_key and f.bundle_id=p_bundle_id;
 if found then
   if existing.payer_id<>p_payer_id or existing.config_revision<>p_config_revision or existing.due_at<>p_due_at then
     raise exception 'Existing bundle funding does not match its frozen payer, revision, or due date' using errcode='23505';
   end if;
   if existing.due_at<now() then
     return query select 'expired_existing',existing.id,existing.funding_source,existing.source_id,existing.credit_units_consumed; return;
   end if;
   return query select 'already_funded',existing.id,existing.funding_source,existing.source_id,existing.credit_units_consumed; return;
 end if;
 select * into existing from public.feature_bundle_funding_receipts f where f.operation_key=p_operation_key;
 if found then
   if existing.bundle_id<>p_bundle_id or existing.feature_key<>p_feature_key or existing.payer_id<>p_payer_id
     or existing.config_revision<>p_config_revision or existing.due_at<>p_due_at then
     raise exception 'Funding operation key was reused with a different frozen bundle identity' using errcode='23505';
   end if;
   if existing.due_at<now() then
     return query select 'expired_existing',existing.id,existing.funding_source,existing.source_id,existing.credit_units_consumed; return;
   end if;
   return query select 'already_funded',existing.id,existing.funding_source,existing.source_id,existing.credit_units_consumed; return;
 end if;
 if p_due_at<now() then
   return query select 'invalid_request',null::uuid,null::text,null::text,0; return;
 end if;
 select r.payer into revision_payer from public.feature_pricing_revisions r
 where r.feature_key=p_feature_key and r.revision=p_config_revision;
 if revision_payer is null then return query select 'invalid_revision',null::uuid,null::text,null::text,0; return; end if;
 select p.role::text into payer_role_value from public.profiles p where p.id=p_payer_id for share;
 if payer_role_value is null or payer_role_value<>revision_payer then
   return query select 'payer_mismatch',null::uuid,null::text,null::text,0; return;
 end if;

 select g.id::text into source_id_value from public.feature_access_grants g
 where g.feature_key=p_feature_key and g.user_id=p_payer_id and g.starts_at<=now()
   and (g.expires_at is null or g.expires_at>=now())
   and not exists(select 1 from public.feature_access_grant_events e where e.grant_id=g.id and e.action='revoked')
 order by g.expires_at nulls last,g.id limit 1;
 if source_id_value is not null then source_kind:='comp';
 elsif current_status='live' then
   select s.stripe_subscription_id,case when a.verified_paid_through>=now() then 'subscription'
          when a.verified_trial_through>=now() then 'trial_days' end
   into source_id_value,source_kind
   from public.feature_subscriptions s
   join public.feature_subscription_access_current a on a.subscription_id=s.stripe_subscription_id
   where s.feature_key=p_feature_key and s.payer_id=p_payer_id and s.status in ('active','trialing')
     and s.current_period_end>=now() and a.access_through>=now()
   order by a.access_through desc,s.stripe_subscription_id limit 1;
   if source_kind is null then
     select l.* into selected_lot from public.feature_credit_lots l
     where l.feature_key=p_feature_key and l.user_id=p_payer_id and l.lot_kind='assessment_trial'
       and l.remaining_units>0 and (l.expires_at is null or l.expires_at>=now())
     order by l.expires_at nulls last,l.id limit 1 for update;
     if found then source_kind:='assessment_trial'; source_id_value:=selected_lot.id::text; end if;
   end if;
   if source_kind is null then
     select l.* into selected_lot from public.feature_credit_lots l
     where l.feature_key=p_feature_key and l.user_id=p_payer_id and l.lot_kind='pack'
       and l.remaining_units>0 and (l.expires_at is null or l.expires_at>=now())
     order by l.expires_at nulls last,l.id limit 1 for update;
     if found then source_kind:='pack'; source_id_value:=selected_lot.id::text; end if;
   end if;
 end if;
 if source_kind is null then return query select 'unfunded',null::uuid,null::text,null::text,0; return; end if;
 if source_kind in ('assessment_trial','pack') then
   update public.feature_credit_lots set remaining_units=remaining_units-1 where id=selected_lot.id;
   insert into public.feature_credit_ledger(feature_key,user_id,lot_id,operation_key,entry_kind,delta_units)
   values(p_feature_key,p_payer_id,selected_lot.id,'consume:'||p_operation_key,'consume',-1);
   debit:=1;
 end if;
 insert into public.feature_bundle_funding_receipts(bundle_id,feature_key,payer_role,payer_id,config_revision,
   funding_source,source_id,credit_units_consumed,due_at,operation_key)
 values(p_bundle_id,p_feature_key,revision_payer,p_payer_id,p_config_revision,source_kind,source_id_value,debit,p_due_at,p_operation_key)
 returning id into new_receipt_id;
 return query select 'funded',new_receipt_id,source_kind,source_id_value,debit;
end;
$$;
revoke all on function public.record_feature_bundle_funding(uuid,text,uuid,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.record_feature_bundle_funding(uuid,text,uuid,bigint,timestamptz,text) to service_role;

create view public.feature_my_invoice_history with (security_barrier=true) as
select case when i.trial_claim_id is not null then 'trial'::text else 'subscription'::text end as kind,
  case when i.refund_state='fully_refunded' then 'refunded'::text
       when i.refund_state='partial_review' then 'review'::text
       when i.trial_claim_id is not null then 'trial'::text
       when i.status='paid' and i.amount_paid_cents>0 then 'paid'::text
       else 'pending'::text end as status,
  i.amount_due_cents,i.amount_paid_cents,i.currency,i.period_start,i.period_end,i.updated_at as recorded_at
from public.feature_subscription_invoice_current i
where i.payer_id=(select auth.uid());

create view public.feature_my_subscription_contracts with (security_barrier=true) as
select s.feature_key,s.payer_role,s.status,s.current_period_end as provider_period_end,
  v.contract_version,v.config_revision,v.price_key,v.amount_cents,v.currency,v.billing_interval,
  a.verified_paid_through,a.verified_trial_through,a.access_through as verified_access_through
from public.feature_subscriptions s
join public.feature_subscription_contract_current c on c.stripe_subscription_id=s.stripe_subscription_id
join public.feature_subscription_contract_versions v
  on v.stripe_subscription_id=c.stripe_subscription_id and v.contract_version=c.contract_version
left join public.feature_subscription_access_current a on a.subscription_id=s.stripe_subscription_id
where s.payer_id=(select auth.uid());

create view public.feature_my_subscription_access with (security_barrier=true) as
select s.feature_key,s.status,a.provider_period_end,a.verified_paid_through,a.verified_trial_through,a.access_through
from public.feature_subscriptions s join public.feature_subscription_access_current a
  on a.subscription_id=s.stripe_subscription_id
where s.payer_id=(select auth.uid());

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'feature_customer_create_attempts','feature_payer_customer_mappings','feature_pricing_sync_requests',
    'feature_pricing_sync_objects','feature_subscription_contract_versions','feature_subscription_contract_current',
    'feature_subscription_checkout_access_proofs','feature_subscription_contract_move_intents','feature_subscription_contract_move_state','feature_trial_claims',
    'feature_billing_event_identity','feature_subscription_invoice_events','feature_subscription_invoice_event_state',
    'feature_subscription_refund_events','feature_subscription_refund_event_state','feature_subscription_invoice_current','feature_billing_provider_aliases',
    'feature_subscription_access_current'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on public.%I to service_role',table_name);
  end loop;
end;
$$;
revoke all on public.feature_my_invoice_history,public.feature_my_subscription_contracts,public.feature_my_subscription_access from public,anon;
grant select on public.feature_my_invoice_history,public.feature_my_subscription_contracts,public.feature_my_subscription_access to authenticated;
