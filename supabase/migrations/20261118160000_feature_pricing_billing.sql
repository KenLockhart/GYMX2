-- Form Coach billing foundation. No provider objects, comp grants, receipts or credits are seeded.
create table public.feature_pricing_revisions (
  feature_key text not null check (feature_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  revision bigint not null check (revision > 0),
  status text not null check (status in ('disabled', 'pricing_pending', 'live')),
  payer text not null check (payer in ('coach', 'member')),
  billing_model text check (billing_model in ('subscription', 'per_assessment')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 500),
  marketing_copy text not null default '' check (char_length(marketing_copy) <= 2000),
  trial_days integer not null default 0 check (trial_days between 0 and 365),
  trial_assessments integer not null default 0 check (trial_assessments between 0 and 1000),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (feature_key, revision),
  check (status <> 'pricing_pending' or billing_model is null)
);
create table public.feature_pricing_current (
  feature_key text primary key,
  revision bigint not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  foreign key (feature_key, revision) references public.feature_pricing_revisions (feature_key, revision) on delete restrict
);
create table public.feature_pricing_options (
  feature_key text not null,
  revision bigint not null,
  price_key text not null check (price_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  interval text check (interval in ('month', 'year')),
  credits_per_pack integer check (credits_per_pack is null or credits_per_pack between 1 and 1000000),
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  primary key (feature_key, revision, price_key),
  foreign key (feature_key, revision) references public.feature_pricing_revisions (feature_key, revision) on delete restrict,
  check ((stripe_product_id is null) = (stripe_price_id is null)),
  check ((interval is null) <> (credits_per_pack is null))
);
create table public.feature_pricing_change_log (
  id bigint generated always as identity primary key,
  feature_key text not null,
  revision bigint not null,
  previous_revision bigint,
  changed_by uuid,
  recorded_at timestamptz not null default now(),
  foreign key (feature_key, revision) references public.feature_pricing_revisions (feature_key, revision) on delete restrict,
  foreign key (feature_key, previous_revision) references public.feature_pricing_revisions (feature_key, revision) on delete restrict,
  unique (feature_key, revision)
);
create function private.reject_feature_billing_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Form Coach billing history is immutable' using errcode = '42501'; end;
$$;
revoke all on function private.reject_feature_billing_history_mutation() from public, anon, authenticated;
create trigger feature_pricing_revisions_immutable before update or delete on public.feature_pricing_revisions for each row execute function private.reject_feature_billing_history_mutation();
create trigger feature_pricing_options_immutable before update or delete on public.feature_pricing_options for each row execute function private.reject_feature_billing_history_mutation();
create trigger feature_pricing_change_log_immutable before update or delete on public.feature_pricing_change_log for each row execute function private.reject_feature_billing_history_mutation();
insert into public.feature_pricing_revisions(feature_key,revision,status,payer,billing_model,currency,display_name,description,marketing_copy,trial_days,trial_assessments)
values ('form_coach',1,'pricing_pending','coach',null,'USD','Form Coach','','',0,0);
insert into public.feature_pricing_current(feature_key,revision) values ('form_coach',1);
insert into public.feature_pricing_change_log(feature_key,revision,previous_revision) values ('form_coach',1,null);

create function public.admin_create_feature_pricing_revision(
  p_feature_key text, p_expected_revision bigint, p_status text, p_payer text,
  p_billing_model text, p_currency text, p_display_name text, p_description text,
  p_marketing_copy text, p_trial_days integer, p_trial_assessments integer, p_price_options jsonb
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_revision bigint; next_revision bigint; option_count integer; option_row record;
begin
  if not private.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if p_feature_key is null or p_feature_key !~ '^[a-z][a-z0-9_]{0,63}$'
    or p_expected_revision is null or p_expected_revision < 1 or p_expected_revision >= 9223372036854775807
    or p_status is null or p_status not in ('disabled','pricing_pending','live')
    or p_payer is null or p_payer not in ('coach','member')
    or (p_billing_model is not null and p_billing_model not in ('subscription','per_assessment'))
    or p_currency is null or p_currency !~ '^[A-Z]{3}$'
    or nullif(trim(p_display_name),'') is null or char_length(trim(p_display_name))>120
    or p_description is null or char_length(p_description)>500
    or p_marketing_copy is null or char_length(p_marketing_copy)>2000
    or p_trial_days is null or p_trial_days not between 0 and 365
    or p_trial_assessments is null or p_trial_assessments not between 0 and 1000
    or p_price_options is null or jsonb_typeof(p_price_options) <> 'array' then
    raise exception 'Invalid feature pricing configuration' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feature-pricing:' || p_feature_key,0));
  select c.revision into current_revision from public.feature_pricing_current c
  where c.feature_key = p_feature_key for update;
  if not found then raise exception 'Feature pricing configuration does not exist' using errcode = 'P0002'; end if;
  if current_revision <> p_expected_revision then raise exception 'Feature pricing revision changed' using errcode = '40001'; end if;
  option_count := jsonb_array_length(p_price_options);
  if p_status = 'pricing_pending' and (option_count <> 0 or p_billing_model is not null) then
    raise exception 'Pricing-pending revisions have no price or billing model' using errcode = '22023';
  end if;
  if p_status = 'live' and (option_count = 0 or p_billing_model is null) then
    raise exception 'A live revision requires a billing model and price binding' using errcode = '22023';
  end if;
  for option_row in select * from jsonb_to_recordset(p_price_options) as x(
    price_key text, amount_cents integer, currency text, interval text,
    credits_per_pack integer, stripe_product_id text, stripe_price_id text
  ) loop
    if option_row.price_key is null or option_row.price_key !~ '^[a-z][a-z0-9_]{0,39}$'
      or option_row.amount_cents is null or option_row.amount_cents <= 0
      or option_row.currency <> p_currency
      or ((option_row.stripe_product_id is null) <> (option_row.stripe_price_id is null)) then
      raise exception 'Invalid feature price option' using errcode = '22023';
    end if;
    if p_billing_model = 'subscription' and (option_row.interval is null or option_row.interval not in ('month','year') or option_row.credits_per_pack is not null) then
      raise exception 'Subscription prices need an interval and no credit quantity' using errcode = '22023';
    end if;
    if p_billing_model = 'per_assessment' and (option_row.interval is not null or option_row.credits_per_pack is null or option_row.credits_per_pack not between 1 and 1000000) then
      raise exception 'Assessment packs need credits and no interval' using errcode = '22023';
    end if;
    if p_status = 'live' and (option_row.stripe_product_id is null or option_row.stripe_price_id is null) then
      raise exception 'Live prices require verified provider bindings' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from jsonb_to_recordset(p_price_options) as x(price_key text) group by x.price_key having count(*) > 1) then
    raise exception 'Feature price keys must be unique' using errcode = '22023';
  end if;
  if p_status = 'live' and p_billing_model = 'subscription' and option_count <> 1 then
    raise exception 'A subscription revision has exactly one price' using errcode = '22023';
  end if;
  next_revision := current_revision + 1;
  insert into public.feature_pricing_revisions(feature_key,revision,status,payer,billing_model,currency,
    display_name,description,marketing_copy,trial_days,trial_assessments,created_by)
  values (p_feature_key,next_revision,p_status,p_payer,p_billing_model,p_currency,
    trim(p_display_name),p_description,p_marketing_copy,p_trial_days,p_trial_assessments,auth.uid());
  insert into public.feature_pricing_options(feature_key,revision,price_key,amount_cents,currency,interval,credits_per_pack,stripe_product_id,stripe_price_id)
  select p_feature_key,next_revision,x.price_key,x.amount_cents,x.currency,x.interval,x.credits_per_pack,x.stripe_product_id,x.stripe_price_id
  from jsonb_to_recordset(p_price_options) as x(price_key text,amount_cents integer,currency text,interval text,credits_per_pack integer,stripe_product_id text,stripe_price_id text);
  insert into public.feature_pricing_change_log(feature_key,revision,previous_revision,changed_by)
  values (p_feature_key,next_revision,current_revision,auth.uid());
  update public.feature_pricing_current set revision=next_revision,changed_by=auth.uid(),changed_at=now()
  where feature_key=p_feature_key;
  return next_revision;
end;
$$;
revoke all on function public.admin_create_feature_pricing_revision(text,bigint,text,text,text,text,text,text,text,integer,integer,jsonb) from public,anon;
grant execute on function public.admin_create_feature_pricing_revision(text,bigint,text,text,text,text,text,text,text,integer,integer,jsonb) to authenticated;
create table public.feature_checkout_reservations (
  id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
  idempotency_key text not null unique, feature_key text not null, config_revision bigint not null,
  payer_role text not null check (payer_role in ('coach','member')), payer_id uuid not null,
  price_key text not null, stripe_product_id text not null, stripe_price_id text not null,
  unit_amount_cents integer not null check (unit_amount_cents > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
  pack_quantity integer not null check (pack_quantity between 1 and 100),
  credits_per_pack integer check (credits_per_pack is null or credits_per_pack > 0),
  quoted_credits bigint not null default 0 check (quoted_credits >= 0), total_amount_cents bigint not null check (total_amount_cents > 0),
  state text not null default 'reserved' check (state in ('reserved','unknown','bound','paid','cancel_required','canceled','expired','rejected')),
  stripe_checkout_session_id text unique, stripe_customer_id text, stripe_subscription_id text,
  expires_at timestamptz not null, created_at timestamptz not null default now(), bound_at timestamptz,
  foreign key (feature_key,config_revision,price_key) references public.feature_pricing_options(feature_key,revision,price_key) on delete restrict
);
create unique index feature_checkout_one_unresolved_per_payer_idx on public.feature_checkout_reservations(feature_key,payer_id)
where state in ('reserved','unknown','bound','cancel_required');
create function private.protect_feature_checkout_quote() returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.request_id,new.idempotency_key,new.feature_key,new.config_revision,new.payer_role,new.payer_id,new.price_key,
      new.stripe_product_id,new.stripe_price_id,new.unit_amount_cents,new.currency,new.pack_quantity,new.credits_per_pack,
      new.quoted_credits,new.total_amount_cents,new.expires_at,new.created_at)
     is distinct from
     (old.request_id,old.idempotency_key,old.feature_key,old.config_revision,old.payer_role,old.payer_id,old.price_key,
      old.stripe_product_id,old.stripe_price_id,old.unit_amount_cents,old.currency,old.pack_quantity,old.credits_per_pack,
      old.quoted_credits,old.total_amount_cents,old.expires_at,old.created_at) then
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
create trigger feature_checkout_quote_immutable before update on public.feature_checkout_reservations for each row execute function private.protect_feature_checkout_quote();

create table public.feature_provider_objects (
 feature_key text not null, object_type text not null check (object_type in ('product','price','checkout_session','payment_intent','invoice','customer','subscription','refund')),
 object_id text not null, config_revision bigint, price_key text, payer_id uuid, recorded_at timestamptz not null default now(),
 primary key(feature_key,object_type,object_id),
 foreign key(feature_key,config_revision) references public.feature_pricing_revisions(feature_key,revision) on delete restrict
);
create table public.feature_processed_events (
 event_id text primary key, event_type text not null, feature_key text not null, object_id text,
 processing_state text not null check (processing_state in ('received','applied','stale','mismatch','blocked_deletion','unmatched')),
 received_at timestamptz not null default now(), processed_at timestamptz,
 foreign key(feature_key) references public.feature_pricing_current(feature_key) on delete restrict
);
create table public.feature_payment_receipts (
 id uuid primary key default gen_random_uuid(), feature_key text not null, reservation_id uuid not null, request_id uuid not null,
 payer_role text not null check (payer_role in ('coach','member')), payer_id uuid not null, config_revision bigint not null,
 price_key text not null, stripe_product_id text not null, stripe_price_id text not null,
 stripe_checkout_session_id text not null unique, payment_object_id text not null unique,
 payment_intent_id text, stripe_subscription_id text, pack_quantity integer not null check (pack_quantity between 1 and 100),
 credits_per_pack integer check (credits_per_pack is null or credits_per_pack > 0), total_credits bigint not null check (total_credits >= 0),
 amount_cents bigint not null check (amount_cents > 0), currency text not null check (currency ~ '^[A-Z]{3}$'),
 disposition text not null check (disposition in ('applied','blocked_deletion')), event_id text not null, recorded_at timestamptz not null default now(),
 foreign key(reservation_id) references public.feature_checkout_reservations(id) on delete restrict,
 foreign key(feature_key,config_revision,price_key) references public.feature_pricing_options(feature_key,revision,price_key) on delete restrict,
 foreign key(event_id) references public.feature_processed_events(event_id) on delete restrict
);
create table public.feature_subscriptions (
 stripe_subscription_id text primary key, feature_key text not null,
 payer_role text not null check (payer_role in ('coach','member')), payer_id uuid not null,
 config_revision bigint not null, price_key text not null, stripe_customer_id text not null,
 status text not null check (status in ('pending_reconcile','active','trialing','canceled','incomplete','incomplete_expired','past_due','paused','unpaid','blocked_deletion')),
 current_period_end timestamptz not null, cancel_at_period_end boolean not null default false,
 state_revision bigint not null default 0 check (state_revision >= 0), updated_at timestamptz not null default now(),
 foreign key(feature_key,config_revision,price_key) references public.feature_pricing_options(feature_key,revision,price_key) on delete restrict
);
create index feature_subscriptions_owner_state_idx on public.feature_subscriptions(feature_key,payer_id,status,current_period_end desc);
create unique index feature_subscriptions_one_collectible_per_payer_idx
on public.feature_subscriptions(feature_key,payer_id)
where status in ('pending_reconcile','active','trialing','incomplete','past_due','paused','unpaid','blocked_deletion');
create table public.feature_access_grants (
 id uuid primary key default gen_random_uuid(), feature_key text not null, user_id uuid not null,
 grant_kind text not null check (grant_kind='comp'), starts_at timestamptz not null default now(), expires_at timestamptz,
 reason text not null check (char_length(trim(reason)) between 1 and 500), granted_by uuid not null,
 granted_at timestamptz not null default now(), request_id uuid not null unique,
  check (expires_at is null or expires_at > starts_at),
  foreign key(feature_key) references public.feature_pricing_current(feature_key) on delete restrict
);
create table public.feature_access_grant_events (
 id bigint generated always as identity primary key, grant_id uuid not null references public.feature_access_grants(id) on delete restrict,
 action text not null check (action='revoked'), actor_id uuid not null, recorded_at timestamptz not null default now(), unique(grant_id,action)
);
create table public.feature_trial_access_grants (
 id uuid primary key default gen_random_uuid(), feature_key text not null, user_id uuid not null,
 starts_at timestamptz not null, expires_at timestamptz not null check(expires_at>starts_at),
 source text not null check(source='subscription_trial'), source_id text not null, created_at timestamptz not null default now(),
 unique(feature_key,source_id),
 foreign key(feature_key) references public.feature_pricing_current(feature_key) on delete restrict
);
create table public.feature_credit_lots (
 id uuid primary key default gen_random_uuid(), feature_key text not null, user_id uuid not null,
 lot_kind text not null check(lot_kind in ('assessment_trial','pack')), source_receipt_id uuid, source_grant_id uuid,
 pack_key text, pack_unit_index integer, granted_units integer not null check(granted_units>0),
 remaining_units integer not null check(remaining_units between 0 and granted_units), expires_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(feature_key) references public.feature_pricing_current(feature_key) on delete restrict,
 foreign key(source_receipt_id) references public.feature_payment_receipts(id) on delete restrict,
 check ((lot_kind='pack' and source_receipt_id is not null and pack_key is not null and pack_unit_index is not null and pack_unit_index between 1 and 100)
     or (lot_kind='assessment_trial' and source_receipt_id is null))
);
create unique index feature_credit_pack_unit_once_idx on public.feature_credit_lots(source_receipt_id,pack_unit_index) where lot_kind='pack';
create index feature_credit_lots_owner_available_idx on public.feature_credit_lots(feature_key,user_id,lot_kind,expires_at,id) where remaining_units>0;
create table public.feature_credit_ledger (
 id bigint generated always as identity primary key, feature_key text not null, user_id uuid not null,
 lot_id uuid not null references public.feature_credit_lots(id) on delete restrict, operation_key text not null unique,
 entry_kind text not null check(entry_kind in ('grant','consume','refund')), delta_units integer not null check(delta_units<>0),
 related_receipt_id uuid references public.feature_payment_receipts(id) on delete restrict,
 related_event_id text references public.feature_processed_events(event_id) on delete restrict, created_at timestamptz not null default now()
);
create table public.feature_pack_refunds (
 id bigint generated always as identity primary key, refund_id text not null unique,
 receipt_id uuid not null references public.feature_payment_receipts(id) on delete restrict,
 refunded_pack_quantity integer not null check(refunded_pack_quantity between 1 and 100), created_at timestamptz not null default now()
);
create table public.feature_pack_refund_units (
 refund_id bigint not null references public.feature_pack_refunds(id) on delete restrict,
 lot_id uuid not null references public.feature_credit_lots(id) on delete restrict,
 removed_credit_units integer not null check(removed_credit_units>=0), primary key(refund_id,lot_id), unique(lot_id)
);
create table public.feature_bundle_funding_receipts (
 id uuid primary key default gen_random_uuid(), bundle_id uuid not null, feature_key text not null,
 payer_role text not null check(payer_role in ('coach','member')), payer_id uuid not null,
 config_revision bigint not null, funding_source text not null check(funding_source in ('comp','subscription','trial_days','assessment_trial','pack')),
 source_id text not null, credit_units_consumed integer not null check(credit_units_consumed in (0,1)),
 due_at timestamptz not null, operation_key text not null unique, funded_at timestamptz not null default now(),
 unique(feature_key,bundle_id),
 foreign key(feature_key,config_revision) references public.feature_pricing_revisions(feature_key,revision) on delete restrict,
 check ((funding_source in ('comp','subscription','trial_days') and credit_units_consumed=0)
     or (funding_source in ('assessment_trial','pack') and credit_units_consumed=1))
);
create function private.reject_feature_ledger_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Form Coach payment and credit history is immutable' using errcode='42501'; end;
$$;
revoke all on function private.reject_feature_ledger_mutation() from public,anon,authenticated;
create trigger feature_payment_receipts_immutable before update or delete on public.feature_payment_receipts for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_credit_ledger_immutable before update or delete on public.feature_credit_ledger for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_bundle_funding_immutable before update or delete on public.feature_bundle_funding_receipts for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_access_grants_immutable before update or delete on public.feature_access_grants for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_access_grant_events_immutable before update or delete on public.feature_access_grant_events for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_pack_refund_units_immutable before update or delete on public.feature_pack_refund_units for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_provider_objects_immutable before update or delete on public.feature_provider_objects for each row execute function private.reject_feature_ledger_mutation();
create trigger feature_trial_access_grants_immutable before update or delete on public.feature_trial_access_grants for each row execute function private.reject_feature_ledger_mutation();

create function private.protect_feature_processed_event()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Processed provider events are immutable' using errcode='42501'; end if;
  if (new.event_id,new.event_type,new.feature_key,new.object_id,new.received_at)
     is distinct from (old.event_id,old.event_type,old.feature_key,old.object_id,old.received_at) then
    raise exception 'Processed provider event identity is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_feature_processed_event() from public,anon,authenticated;
create trigger feature_processed_event_identity_immutable before update or delete on public.feature_processed_events for each row execute function private.protect_feature_processed_event();

create function private.protect_feature_subscription_contract()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Feature subscription history cannot be deleted' using errcode='42501'; end if;
  if (new.stripe_subscription_id,new.feature_key,new.payer_role,new.payer_id,new.config_revision,new.price_key)
     is distinct from (old.stripe_subscription_id,old.feature_key,old.payer_role,old.payer_id,old.config_revision,old.price_key) then
    raise exception 'Feature subscription payer and price contract are immutable' using errcode='42501';
  end if;
  if new.stripe_customer_id is distinct from old.stripe_customer_id
    and (nullif(trim(old.stripe_customer_id),'') is not null or nullif(trim(new.stripe_customer_id),'') is null) then
    raise exception 'A known subscription customer binding is immutable' using errcode='42501';
  end if;
  if new.state_revision<>old.state_revision+1 then
    raise exception 'Feature subscription state must advance by compare-and-swap revision' using errcode='40001';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_feature_subscription_contract() from public,anon,authenticated;
create trigger feature_subscription_contract_immutable before update or delete on public.feature_subscriptions for each row execute function private.protect_feature_subscription_contract();

-- A verified subscription payment may predate complete provider binding in legacy rows.
-- Recreate only its reconciliation mapping after the immutable receipt and both IDs exist.
create function private.ensure_feature_checkout_subscription(p_reservation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare reservation public.feature_checkout_reservations%rowtype; existing public.feature_subscriptions%rowtype;
 deleting boolean; expected_status text;
begin
  select * into reservation from public.feature_checkout_reservations r where r.id=p_reservation_id;
  if not found or reservation.credits_per_pack is not null
    or nullif(trim(reservation.stripe_customer_id),'') is null
    or nullif(trim(reservation.stripe_subscription_id),'') is null
    or not exists(select 1 from public.feature_payment_receipts p where p.reservation_id=reservation.id) then
    return;
  end if;
  if exists(select 1 from public.feature_payment_receipts p where p.reservation_id=reservation.id
    and p.stripe_subscription_id is not null and p.stripe_subscription_id<>reservation.stripe_subscription_id) then
    raise exception 'Subscription binding conflicts with its immutable payment receipt' using errcode='23505';
  end if;
  select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=reservation.payer_id)
    or reservation.state='cancel_required'
    or exists(select 1 from public.feature_payment_receipts p where p.reservation_id=reservation.id and p.disposition='blocked_deletion')
    into deleting;
  expected_status:=case when deleting then 'blocked_deletion' else 'pending_reconcile' end;
  select * into existing from public.feature_subscriptions s
  where s.stripe_subscription_id=reservation.stripe_subscription_id for update;
  if found then
    if existing.feature_key<>reservation.feature_key or existing.payer_role<>reservation.payer_role
      or existing.payer_id<>reservation.payer_id or existing.config_revision<>reservation.config_revision
      or existing.price_key<>reservation.price_key
      or (nullif(trim(existing.stripe_customer_id),'') is not null and existing.stripe_customer_id<>reservation.stripe_customer_id) then
      raise exception 'Subscription provider identity conflicts with its immutable checkout quote' using errcode='23505';
    end if;
    if nullif(trim(existing.stripe_customer_id),'') is null then
      update public.feature_subscriptions set stripe_customer_id=reservation.stripe_customer_id,status=expected_status,
        state_revision=state_revision+1,updated_at=now() where stripe_subscription_id=existing.stripe_subscription_id;
    elsif deleting and existing.status<>'blocked_deletion' then
      update public.feature_subscriptions set status='blocked_deletion',state_revision=state_revision+1,updated_at=now()
      where stripe_subscription_id=existing.stripe_subscription_id;
    end if;
  else
    insert into public.feature_subscriptions(stripe_subscription_id,feature_key,payer_role,payer_id,config_revision,price_key,
      stripe_customer_id,status,current_period_end)
    values(reservation.stripe_subscription_id,reservation.feature_key,reservation.payer_role,reservation.payer_id,
      reservation.config_revision,reservation.price_key,reservation.stripe_customer_id,expected_status,now());
  end if;
end;
$$;
revoke all on function private.ensure_feature_checkout_subscription(uuid) from public,anon,authenticated;

create function private.protect_feature_credit_lot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'Feature credit lot history cannot be deleted' using errcode='42501'; end if;
  if (new.feature_key,new.user_id,new.lot_kind,new.source_receipt_id,new.source_grant_id,new.pack_key,new.pack_unit_index,new.granted_units,new.expires_at,new.created_at)
     is distinct from (old.feature_key,old.user_id,old.lot_kind,old.source_receipt_id,old.source_grant_id,old.pack_key,old.pack_unit_index,old.granted_units,old.expires_at,old.created_at) then
    raise exception 'Feature credit lot provenance is immutable' using errcode='42501';
  end if;
  if new.remaining_units>old.remaining_units then raise exception 'Feature credits can only be granted in a new lot' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function private.protect_feature_credit_lot() from public,anon,authenticated;
create trigger feature_credit_lot_provenance_immutable before update or delete on public.feature_credit_lots for each row execute function private.protect_feature_credit_lot();
create function public.feature_stripe_namespace(p_metadata jsonb,p_object_id text)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_metadata ->> 'feature_namespace'='form_coach' or p_metadata ->> 'feature_key'='form_coach'
    or exists(select 1 from public.feature_provider_objects o where o.feature_key='form_coach' and o.object_id=p_object_id)
    or exists(select 1 from public.feature_checkout_reservations r where r.feature_key='form_coach' and r.stripe_checkout_session_id=p_object_id)
    or exists(select 1 from public.feature_payment_receipts r where r.feature_key='form_coach' and (r.payment_object_id=p_object_id or r.stripe_checkout_session_id=p_object_id))
    or exists(select 1 from public.feature_subscriptions s where s.feature_key='form_coach' and s.stripe_subscription_id=p_object_id)
    then 'form_coach' else null end;
$$;
revoke all on function public.feature_stripe_namespace(jsonb,text) from public,anon,authenticated;
grant execute on function public.feature_stripe_namespace(jsonb,text) to service_role;

create function public.reserve_feature_checkout(
 p_feature_key text,p_payer_id uuid,p_config_revision bigint,p_price_key text,p_pack_quantity integer,p_request_id uuid
)
returns table(outcome text,reservation_id uuid,request_id uuid,expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare config_row public.feature_pricing_revisions%rowtype; price_row public.feature_pricing_options%rowtype;
 current_revision bigint; payer_role_value text; existing public.feature_checkout_reservations%rowtype;
 total_cents bigint; total_credits bigint; expiry timestamptz; new_id uuid;
begin
 if p_feature_key is null or p_payer_id is null or p_config_revision is null or p_price_key is null or p_request_id is null then
   return query select 'invalid_request',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('feature-pricing:'||p_feature_key,0));
 select c.revision into current_revision from public.feature_pricing_current c where c.feature_key=p_feature_key;
 if not found then return query select 'unavailable',null::uuid,p_request_id,null::timestamptz; return; end if;
 select * into config_row from public.feature_pricing_revisions r where r.feature_key=p_feature_key and r.revision=current_revision;
 if config_row.status<>'live' or current_revision<>p_config_revision then
   return query select 'stale_or_unavailable',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 select p.role::text into payer_role_value from public.profiles p where p.id=p_payer_id;
 if payer_role_value is null or payer_role_value<>config_row.payer then
   return query select 'payer_role_mismatch',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 select * into price_row from public.feature_pricing_options o
 where o.feature_key=p_feature_key and o.revision=p_config_revision and o.price_key=p_price_key;
 if not found or price_row.stripe_price_id is null or price_row.stripe_product_id is null then
   return query select 'price_unavailable',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 if p_pack_quantity is null or p_pack_quantity<1 or p_pack_quantity>100
   or (config_row.billing_model='subscription' and p_pack_quantity<>1) then
   return query select 'invalid_quantity',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_payer_id::text,0));
 if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_payer_id) then
   return query select 'account_deleting',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_feature_key||':'||p_payer_id::text,0));
 select * into existing from public.feature_checkout_reservations r where r.request_id=p_request_id;
 if found then
   if existing.feature_key<>p_feature_key or existing.payer_id<>p_payer_id or existing.config_revision<>p_config_revision
     or existing.price_key<>p_price_key or existing.pack_quantity<>p_pack_quantity then
     raise exception 'Checkout request key was reused with a different quote' using errcode='23505';
   end if;
   return query select 'existing',existing.id,existing.request_id,existing.expires_at; return;
 end if;
 select * into existing from public.feature_checkout_reservations r
  where r.feature_key=p_feature_key and r.payer_id=p_payer_id and (
    r.state in ('reserved','unknown','bound','cancel_required')
    or (r.state='paid' and r.credits_per_pack is null and (
      nullif(trim(r.stripe_subscription_id),'') is null
      or not exists(select 1 from public.feature_subscriptions s
        where s.stripe_subscription_id=r.stripe_subscription_id and s.feature_key=r.feature_key and s.payer_id=r.payer_id)
    ))
  ) for update;
 if found then return query select 'pending_reconciliation',existing.id,existing.request_id,existing.expires_at; return; end if;
  if config_row.billing_model='subscription' and exists(
    select 1 from public.feature_subscriptions s
    where s.feature_key=p_feature_key and s.payer_id=p_payer_id
      and s.status in ('pending_reconcile','active','trialing','incomplete','past_due','paused','unpaid','blocked_deletion')
  ) then
    return query select 'subscription_exists',null::uuid,p_request_id,null::timestamptz; return;
  end if;
 total_cents:=price_row.amount_cents::bigint*p_pack_quantity;
 total_credits:=coalesce(price_row.credits_per_pack::bigint*p_pack_quantity,0);
 if total_cents>214748364700::bigint or total_credits>100000000 then
   return query select 'invalid_quantity',null::uuid,p_request_id,null::timestamptz; return;
 end if;
 expiry:=now()+interval '30 minutes';
 insert into public.feature_checkout_reservations(request_id,idempotency_key,feature_key,config_revision,payer_role,payer_id,
   price_key,stripe_product_id,stripe_price_id,unit_amount_cents,currency,pack_quantity,credits_per_pack,quoted_credits,total_amount_cents,expires_at)
 values(p_request_id,'form-coach:'||p_request_id::text,p_feature_key,p_config_revision,payer_role_value,p_payer_id,
   p_price_key,price_row.stripe_product_id,price_row.stripe_price_id,price_row.amount_cents,price_row.currency,p_pack_quantity,
   price_row.credits_per_pack,total_credits,total_cents,expiry) returning id into new_id;
 return query select 'reserved',new_id,p_request_id,expiry;
end;
$$;
revoke all on function public.reserve_feature_checkout(text,uuid,bigint,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.reserve_feature_checkout(text,uuid,bigint,text,integer,uuid) to service_role;

create function public.mark_feature_checkout_unknown(p_reservation_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare current_state text;
begin
 update public.feature_checkout_reservations set state='unknown' where id=p_reservation_id and state='reserved' returning state into current_state;
 if found then return 'unknown'; end if;
 select r.state into current_state from public.feature_checkout_reservations r where r.id=p_reservation_id;
 return coalesce(current_state,'not_found');
end;
$$;
revoke all on function public.mark_feature_checkout_unknown(uuid) from public,anon,authenticated;
grant execute on function public.mark_feature_checkout_unknown(uuid) to service_role;

create function public.bind_feature_checkout_session(p_reservation_id uuid,p_session_id text,p_customer_id text default null,p_subscription_id text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare reservation public.feature_checkout_reservations%rowtype; deleting boolean; payer_id uuid;
 customer_id_value text; subscription_id_value text;
begin
 select r.payer_id into payer_id from public.feature_checkout_reservations r where r.id=p_reservation_id;
 if not found then return 'not_found'; end if;
 if p_session_id is null or nullif(trim(p_session_id),'') is null then raise exception 'Checkout session id is required' using errcode='22023'; end if;
 customer_id_value:=nullif(trim(p_customer_id),'');
 subscription_id_value:=nullif(trim(p_subscription_id),'');
 -- Match account-deletion serialization: payer advisory lock precedes reservation row locks.
 perform pg_advisory_xact_lock(hashtextextended(payer_id::text,0));
 select * into reservation from public.feature_checkout_reservations r where r.id=p_reservation_id for update;
 if not found then return 'not_found'; end if;
 if reservation.payer_id<>payer_id then raise exception 'Checkout payer changed unexpectedly' using errcode='40001'; end if;
 select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id) into deleting;
 if reservation.stripe_checkout_session_id is not null and reservation.stripe_checkout_session_id<>p_session_id then
   raise exception 'Reservation already bound to another session' using errcode='23505';
 end if;
 if nullif(trim(reservation.stripe_customer_id),'') is not null and customer_id_value is not null
   and reservation.stripe_customer_id<>customer_id_value then
   raise exception 'Reservation already bound to another customer' using errcode='23505';
 end if;
 if nullif(trim(reservation.stripe_subscription_id),'') is not null and subscription_id_value is not null
   and reservation.stripe_subscription_id<>subscription_id_value then
   raise exception 'Reservation already bound to another subscription' using errcode='23505';
 end if;
 if reservation.stripe_checkout_session_id is null and reservation.state not in ('reserved','unknown') then return reservation.state; end if;
 customer_id_value:=coalesce(nullif(trim(reservation.stripe_customer_id),''),customer_id_value);
 subscription_id_value:=coalesce(nullif(trim(reservation.stripe_subscription_id),''),subscription_id_value);
 if customer_id_value is not null and exists(select 1 from public.feature_provider_objects o
   where o.feature_key=reservation.feature_key and o.object_type='customer' and o.object_id=customer_id_value
     and o.payer_id is distinct from reservation.payer_id) then
   raise exception 'Customer provider identity belongs to another payer' using errcode='23505';
 end if;
 if subscription_id_value is not null and exists(select 1 from public.feature_provider_objects o
   where o.feature_key=reservation.feature_key and o.object_type='subscription' and o.object_id=subscription_id_value
     and (o.config_revision is distinct from reservation.config_revision or o.price_key is distinct from reservation.price_key
       or o.payer_id is distinct from reservation.payer_id)) then
   raise exception 'Subscription provider identity conflicts with its immutable checkout quote' using errcode='23505';
 end if;
 update public.feature_checkout_reservations set stripe_checkout_session_id=coalesce(stripe_checkout_session_id,p_session_id),
   stripe_customer_id=customer_id_value,stripe_subscription_id=subscription_id_value,
   state=case when deleting and state in ('reserved','unknown','bound') then 'cancel_required'
     when stripe_checkout_session_id is null and state in ('reserved','unknown') then 'bound' else state end,
   bound_at=coalesce(bound_at,now())
 where id=p_reservation_id;
 insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision,price_key,payer_id)
 values(reservation.feature_key,'checkout_session',p_session_id,reservation.config_revision,reservation.price_key,reservation.payer_id) on conflict do nothing;
 if customer_id_value is not null then
   insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision,price_key,payer_id)
   values(reservation.feature_key,'customer',customer_id_value,reservation.config_revision,reservation.price_key,reservation.payer_id) on conflict do nothing;
 end if;
 if subscription_id_value is not null then
   insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision,price_key,payer_id)
   values(reservation.feature_key,'subscription',subscription_id_value,reservation.config_revision,reservation.price_key,reservation.payer_id) on conflict do nothing;
 end if;
 perform private.ensure_feature_checkout_subscription(p_reservation_id);
 select * into reservation from public.feature_checkout_reservations r where r.id=p_reservation_id;
 return case when deleting and reservation.state in ('reserved','unknown','bound') then 'cancel_required' else reservation.state end;
end;
$$;
revoke all on function public.bind_feature_checkout_session(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.bind_feature_checkout_session(uuid,text,text,text) to service_role;

create function public.apply_feature_checkout_payment(
 p_event_id text,p_event_type text,p_event_metadata jsonb,p_session_id text,p_payment_object_id text,
 p_payment_intent_id text,p_price_id text,p_amount_cents bigint,p_currency text,p_quantity integer
)
returns text language plpgsql security definer set search_path = '' as $$
declare reservation public.feature_checkout_reservations%rowtype; deleting boolean; receipt_id uuid; lot_id uuid; pack_index integer;
 processed_event public.feature_processed_events%rowtype; payer_id uuid; receipt_exists boolean;
begin
 if nullif(trim(p_event_id),'') is null or nullif(trim(p_session_id),'') is null
   or nullif(trim(p_payment_object_id),'') is null or p_event_type is null then return 'invalid_request'; end if;
 if public.feature_stripe_namespace(p_event_metadata,coalesce(p_session_id,p_payment_object_id)) is distinct from 'form_coach' then return 'unmatched_namespace'; end if;
 if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded') then return 'unsupported_event'; end if;
 insert into public.feature_processed_events(event_id,event_type,feature_key,object_id,processing_state)
 values(p_event_id,p_event_type,'form_coach',coalesce(p_session_id,p_payment_object_id),'received') on conflict(event_id) do nothing;
 if not found then
   select * into processed_event from public.feature_processed_events e where e.event_id=p_event_id for update;
   if (processed_event.event_type<>p_event_type or processed_event.feature_key<>'form_coach'
     or processed_event.object_id is distinct from coalesce(p_session_id,p_payment_object_id)) then
     return 'event_id_mismatch';
   end if;
   if processed_event.processing_state not in ('unmatched','received') then return 'duplicate_event'; end if;
   update public.feature_processed_events set processing_state='received',processed_at=null where event_id=p_event_id;
 end if;
 select r.payer_id into payer_id from public.feature_checkout_reservations r
 where r.feature_key='form_coach' and r.stripe_checkout_session_id=p_session_id;
 if not found then
   update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id;
   return 'unmatched_reservation';
 end if;
 -- Match account-deletion serialization: payer advisory lock precedes reservation row locks.
 perform pg_advisory_xact_lock(hashtextextended(payer_id::text,0));
 select * into reservation from public.feature_checkout_reservations r
 where r.feature_key='form_coach' and r.stripe_checkout_session_id=p_session_id for update;
 if not found then
   update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id;
   return 'unmatched_reservation';
 end if;
 if reservation.credits_per_pack is null and (nullif(trim(reservation.stripe_customer_id),'') is null
   or nullif(trim(reservation.stripe_subscription_id),'') is null) then
   update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id;
   return 'awaiting_provider_binding';
 end if;
 select exists(select 1 from public.feature_payment_receipts r where r.stripe_checkout_session_id=p_session_id) into receipt_exists;
 if receipt_exists then
   perform private.ensure_feature_checkout_subscription(reservation.id);
   update public.feature_processed_events set processing_state='applied',processed_at=now() where event_id=p_event_id;
   return 'already_applied';
 end if;
 if reservation.state='paid' then
   update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id;
   return 'missing_payment_receipt';
 end if;
 if p_event_id is null or p_session_id is null or p_payment_object_id is null or p_price_id is null
   or p_amount_cents is null or p_currency is null or p_quantity is null
   or reservation.stripe_price_id<>p_price_id or reservation.total_amount_cents<>p_amount_cents
   or reservation.currency<>upper(p_currency) or reservation.pack_quantity<>p_quantity then
   update public.feature_processed_events set processing_state='mismatch',processed_at=now() where event_id=p_event_id;
   return 'quote_mismatch';
 end if;
 select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=reservation.payer_id) into deleting;
 insert into public.feature_payment_receipts(feature_key,reservation_id,request_id,payer_role,payer_id,config_revision,price_key,
   stripe_product_id,stripe_price_id,stripe_checkout_session_id,payment_object_id,payment_intent_id,stripe_subscription_id,
   pack_quantity,credits_per_pack,total_credits,amount_cents,currency,disposition,event_id)
 values(reservation.feature_key,reservation.id,reservation.request_id,reservation.payer_role,reservation.payer_id,
   reservation.config_revision,reservation.price_key,reservation.stripe_product_id,reservation.stripe_price_id,p_session_id,
   coalesce(p_payment_object_id,p_session_id),p_payment_intent_id,reservation.stripe_subscription_id,reservation.pack_quantity,
   reservation.credits_per_pack,reservation.quoted_credits,p_amount_cents,upper(p_currency),case when deleting then 'blocked_deletion' else 'applied' end,p_event_id)
 returning id into receipt_id;
 if p_payment_intent_id is not null then
   insert into public.feature_provider_objects(feature_key,object_type,object_id,config_revision,price_key,payer_id)
   values(reservation.feature_key,'payment_intent',p_payment_intent_id,reservation.config_revision,reservation.price_key,reservation.payer_id) on conflict do nothing;
 end if;
 perform private.ensure_feature_checkout_subscription(reservation.id);
 if deleting then
   update public.feature_checkout_reservations set state='cancel_required' where id=reservation.id;
   update public.feature_processed_events set processing_state='blocked_deletion',processed_at=now() where event_id=p_event_id;
   return 'blocked_deletion';
 end if;
 if reservation.credits_per_pack is not null then
   for pack_index in 1..reservation.pack_quantity loop
     insert into public.feature_credit_lots(feature_key,user_id,lot_kind,source_receipt_id,pack_key,pack_unit_index,granted_units,remaining_units)
     values(reservation.feature_key,reservation.payer_id,'pack',receipt_id,reservation.price_key,pack_index,reservation.credits_per_pack,reservation.credits_per_pack)
     returning id into lot_id;
     insert into public.feature_credit_ledger(feature_key,user_id,lot_id,operation_key,entry_kind,delta_units,related_receipt_id,related_event_id)
     values(reservation.feature_key,reservation.payer_id,lot_id,'receipt:'||receipt_id::text||':pack:'||pack_index::text,
       'grant',reservation.credits_per_pack,receipt_id,p_event_id);
   end loop;
 end if;
 update public.feature_checkout_reservations set state='paid' where id=reservation.id;
 update public.feature_processed_events set processing_state='applied',processed_at=now() where event_id=p_event_id;
 return 'applied';
end;
$$;
revoke all on function public.apply_feature_checkout_payment(text,text,jsonb,text,text,text,text,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.apply_feature_checkout_payment(text,text,jsonb,text,text,text,text,bigint,text,integer) to service_role;
-- Call only after retrieving current subscription state from Stripe; event timestamps are audit data, not ordering authority.
create function public.apply_feature_subscription_state_cas(
 p_event_id text,p_event_type text,p_subscription_id text,p_expected_revision bigint,
 p_current_status text,p_current_period_end timestamptz,p_cancel_at_period_end boolean
)
returns text language plpgsql security definer set search_path = '' as $$
declare subscription public.feature_subscriptions%rowtype; deleting boolean; next_status text;
 processed_event public.feature_processed_events%rowtype; payer_id uuid;
begin
 if nullif(trim(p_event_id),'') is null or p_event_type is null or nullif(trim(p_subscription_id),'') is null
   or p_expected_revision is null or p_current_period_end is null
   or p_current_status not in ('active','trialing','canceled','incomplete','incomplete_expired','past_due','paused','unpaid') then
   raise exception 'Invalid reconciled subscription status' using errcode='22023';
 end if;
 insert into public.feature_processed_events(event_id,event_type,feature_key,object_id,processing_state)
 values(p_event_id,p_event_type,'form_coach',p_subscription_id,'received') on conflict(event_id) do nothing;
 if not found then
   select * into processed_event from public.feature_processed_events e where e.event_id=p_event_id for update;
   if (processed_event.event_type<>p_event_type or processed_event.feature_key<>'form_coach'
     or processed_event.object_id is distinct from p_subscription_id) then
     return 'event_id_mismatch';
   end if;
   if processed_event.processing_state not in ('unmatched','stale','received') then return 'duplicate_event'; end if;
   update public.feature_processed_events set processing_state='received',processed_at=null where event_id=p_event_id;
 end if;
 select s.payer_id into payer_id from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach';
 if not found then update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id; return 'unmatched_subscription'; end if;
 -- Match account-deletion serialization: payer advisory lock precedes subscription row locks.
 perform pg_advisory_xact_lock(hashtextextended(payer_id::text,0));
 select * into subscription from public.feature_subscriptions s where s.stripe_subscription_id=p_subscription_id and s.feature_key='form_coach' for update;
 if not found then update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id; return 'unmatched_subscription'; end if;
 if subscription.payer_id<>payer_id then raise exception 'Subscription payer changed unexpectedly' using errcode='40001'; end if;
 select exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=payer_id) into deleting;
 if nullif(trim(subscription.stripe_customer_id),'') is null then
   update public.feature_processed_events set processing_state='unmatched',processed_at=now() where event_id=p_event_id;
   return 'awaiting_provider_binding';
 end if;
 if subscription.state_revision<>p_expected_revision then
   update public.feature_processed_events set processing_state='stale',processed_at=now() where event_id=p_event_id;
   return 'stale_revision';
 end if;
 next_status:=case when deleting then 'blocked_deletion' else p_current_status end;
 update public.feature_subscriptions set status=next_status,current_period_end=p_current_period_end,
   cancel_at_period_end=p_cancel_at_period_end,state_revision=state_revision+1,updated_at=now()
 where stripe_subscription_id=p_subscription_id;
 update public.feature_processed_events set processing_state=case when deleting then 'blocked_deletion' else 'applied' end,
   processed_at=now() where event_id=p_event_id;
 return case when deleting then 'blocked_deletion' else 'applied' end;
end;
$$;
revoke all on function public.apply_feature_subscription_state_cas(text,text,text,bigint,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_feature_subscription_state_cas(text,text,text,bigint,text,timestamptz,boolean) to service_role;

create function public.admin_grant_feature_comp(
 p_user_id uuid,p_feature_key text,p_starts_at timestamptz,p_expires_at timestamptz,p_reason text,p_request_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_grant_id uuid;
begin
 if not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 if p_user_id is null or p_feature_key is null or p_starts_at is null or p_request_id is null
   or nullif(trim(p_reason),'') is null or char_length(trim(p_reason))>500
   or (p_expires_at is not null and p_expires_at<=p_starts_at) then
   raise exception 'Invalid comp grant' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
 if exists(select 1 from public.platform_membership_deletion_locks d where d.member_id=p_user_id) then
   raise exception 'Account deletion is in progress' using errcode='P0001';
 end if;
 if not exists(select 1 from public.feature_pricing_current c where c.feature_key=p_feature_key) then
   raise exception 'Feature pricing configuration does not exist' using errcode='P0002';
 end if;
 select g.id into new_grant_id from public.feature_access_grants g where g.request_id=p_request_id;
 if found then
   if not exists(select 1 from public.feature_access_grants g where g.id=new_grant_id and g.user_id=p_user_id
     and g.feature_key=p_feature_key and g.starts_at=p_starts_at and g.expires_at is not distinct from p_expires_at
     and g.reason=trim(p_reason)) then
     raise exception 'Comp request key was reused with different grant details' using errcode='23505';
   end if;
   return new_grant_id;
 end if;
 if not exists(select 1 from public.profiles p where p.id=p_user_id) then raise exception 'Comp recipient not found' using errcode='P0002'; end if;
 insert into public.feature_access_grants(feature_key,user_id,grant_kind,starts_at,expires_at,reason,granted_by,request_id)
 values(p_feature_key,p_user_id,'comp',p_starts_at,p_expires_at,trim(p_reason),auth.uid(),p_request_id)
 returning id into new_grant_id;
 return new_grant_id;
end;
$$;
revoke all on function public.admin_grant_feature_comp(uuid,text,timestamptz,timestamptz,text,uuid) from public,anon;
grant execute on function public.admin_grant_feature_comp(uuid,text,timestamptz,timestamptz,text,uuid) to authenticated;

create function public.admin_revoke_feature_comp(p_grant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
 if not private.is_admin() then raise exception 'Admin access required' using errcode='42501'; end if;
 insert into public.feature_access_grant_events(grant_id,action,actor_id)
 select g.id,'revoked',auth.uid() from public.feature_access_grants g where g.id=p_grant_id
 on conflict(grant_id,action) do nothing;
 return found;
end;
$$;
revoke all on function public.admin_revoke_feature_comp(uuid) from public,anon;
grant execute on function public.admin_revoke_feature_comp(uuid) to authenticated;

-- p_refunded_pack_quantity must come from a verified provider refund for this exact pack receipt.
create function public.apply_feature_pack_refund(p_receipt_id uuid,p_refund_id text,p_refunded_pack_quantity integer)
returns table(outcome text,removed_credit_units integer)
language plpgsql security definer set search_path = '' as $$
declare receipt public.feature_payment_receipts%rowtype; total_refunded integer; refund_row_id bigint;
 refund_record public.feature_pack_refunds%rowtype; pack_lot public.feature_credit_lots%rowtype;
 removed integer; removed_total integer:=0; picked integer:=0; prior_removed integer;
begin
 select * into refund_record from public.feature_pack_refunds f where f.refund_id=p_refund_id;
 if found then
   if refund_record.receipt_id is distinct from p_receipt_id
     or refund_record.refunded_pack_quantity is distinct from p_refunded_pack_quantity then
     raise exception 'Refund id was reused with a different receipt or quantity' using errcode='23505';
   end if;
   select coalesce(sum(u.removed_credit_units),0)::integer into prior_removed from public.feature_pack_refund_units u where u.refund_id=refund_record.id;
   return query select 'duplicate_refund',prior_removed; return;
 end if;
 select * into receipt from public.feature_payment_receipts r where r.id=p_receipt_id for update;
 if not found or receipt.disposition<>'applied' or receipt.credits_per_pack is null then return query select 'not_pack_receipt',0; return; end if;
 if p_refunded_pack_quantity is null or p_refunded_pack_quantity<1 then return query select 'invalid_refund_quantity',0; return; end if;
 select coalesce(sum(f.refunded_pack_quantity),0)::integer into total_refunded from public.feature_pack_refunds f where f.receipt_id=p_receipt_id;
 if total_refunded+p_refunded_pack_quantity>receipt.pack_quantity then return query select 'refund_quantity_exceeds_purchase',0; return; end if;
 insert into public.feature_pack_refunds(refund_id,receipt_id,refunded_pack_quantity)
 values(p_refund_id,p_receipt_id,p_refunded_pack_quantity) returning id into refund_row_id;
 for pack_lot in
   select l.* from public.feature_credit_lots l
   where l.source_receipt_id=p_receipt_id and l.lot_kind='pack'
     and not exists(select 1 from public.feature_pack_refund_units u where u.lot_id=l.id)
   order by l.pack_unit_index desc limit p_refunded_pack_quantity for update
 loop
   removed:=pack_lot.remaining_units;
   if removed>0 then
     update public.feature_credit_lots set remaining_units=0 where id=pack_lot.id;
     insert into public.feature_credit_ledger(feature_key,user_id,lot_id,operation_key,entry_kind,delta_units,related_receipt_id)
     values(pack_lot.feature_key,pack_lot.user_id,pack_lot.id,'refund:'||p_refund_id||':'||pack_lot.id::text,'refund',-removed,p_receipt_id);
   end if;
   insert into public.feature_pack_refund_units(refund_id,lot_id,removed_credit_units) values(refund_row_id,pack_lot.id,removed);
   removed_total:=removed_total+removed; picked:=picked+1;
 end loop;
 if picked<>p_refunded_pack_quantity then raise exception 'Refund pack units are missing' using errcode='P0001'; end if;
 return query select 'applied',removed_total;
end;
$$;
revoke all on function public.apply_feature_pack_refund(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.apply_feature_pack_refund(uuid,text,integer) to service_role;
create trigger feature_pack_refunds_immutable before update or delete on public.feature_pack_refunds for each row execute function private.reject_feature_ledger_mutation();

-- Trusted caller must lock the assessment and pass its persisted send-time payer/revision snapshot. Browser fields are never funding evidence.
-- `already_funded` reports a receipt only; callers must check due_at before authorizing an attempt. Expired receipts never re-enter source selection.
create function public.record_feature_bundle_funding(
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
   select s.stripe_subscription_id into source_id_value from public.feature_subscriptions s
   where s.feature_key=p_feature_key and s.payer_id=p_payer_id and s.status in ('active','trialing') and s.current_period_end>=now()
   order by s.current_period_end desc,s.stripe_subscription_id limit 1;
   if source_id_value is not null then source_kind:='subscription'; end if;
   if source_kind is null then
     select t.id::text into source_id_value from public.feature_trial_access_grants t
     where t.feature_key=p_feature_key and t.user_id=p_payer_id and t.starts_at<=now() and t.expires_at>=now()
     order by t.expires_at,t.id limit 1;
     if source_id_value is not null then source_kind:='trial_days'; end if;
   end if;
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

-- Views execute with the migration owner, but every projection is scoped to auth.uid() or an admin.
create view public.feature_public_pricing with (security_barrier=true) as
select r.feature_key,r.revision,r.status,r.payer,r.billing_model,r.currency,
       r.display_name,r.description,r.marketing_copy,r.trial_days,r.trial_assessments,
       o.price_key,o.amount_cents,o.interval,o.credits_per_pack
from public.feature_pricing_current c
join public.feature_pricing_revisions r on r.feature_key=c.feature_key and r.revision=c.revision
left join public.feature_pricing_options o on o.feature_key=r.feature_key and o.revision=r.revision
where r.status<>'disabled';
create view public.feature_my_credit_lots with (security_barrier=true) as
select l.id as lot_id,l.feature_key,l.lot_kind,l.pack_key,l.granted_units,l.remaining_units,l.expires_at,l.created_at
from public.feature_credit_lots l where l.user_id=(select auth.uid()) or (select private.is_admin());
create view public.feature_my_payment_receipts with (security_barrier=true) as
select r.id as receipt_id,r.feature_key,r.payer_role,r.price_key,r.pack_quantity,r.total_credits,
       r.amount_cents,r.currency,r.disposition,r.recorded_at
from public.feature_payment_receipts r where r.payer_id=(select auth.uid()) or (select private.is_admin());
create view public.feature_my_billing_summary with (security_barrier=true) as
select s.payer_id as user_id,s.feature_key,'subscription'::text as source_kind,s.status as state,
       s.current_period_end as valid_through,s.config_revision,null::integer as remaining_credits
from public.feature_subscriptions s where s.payer_id=(select auth.uid()) or (select private.is_admin())
union all
select l.user_id,l.feature_key,l.lot_kind,'available'::text,l.expires_at,null::bigint,l.remaining_units
from public.feature_credit_lots l where l.user_id=(select auth.uid()) or (select private.is_admin())
union all
select g.user_id,g.feature_key,'comp'::text,
       case when exists(select 1 from public.feature_access_grant_events e where e.grant_id=g.id and e.action='revoked') then 'revoked' else 'granted' end,
       g.expires_at,null::bigint,null::integer
from public.feature_access_grants g where g.user_id=(select auth.uid()) or (select private.is_admin());

do $$
declare table_name text;
begin
 foreach table_name in array array[
   'feature_pricing_revisions','feature_pricing_current','feature_pricing_options','feature_pricing_change_log',
   'feature_checkout_reservations','feature_provider_objects','feature_processed_events','feature_payment_receipts',
   'feature_subscriptions','feature_access_grants','feature_access_grant_events','feature_trial_access_grants',
   'feature_credit_lots','feature_credit_ledger','feature_pack_refunds','feature_pack_refund_units','feature_bundle_funding_receipts'
 ] loop
   execute format('alter table public.%I enable row level security',table_name);
   execute format('revoke all on public.%I from public,anon,authenticated',table_name);
   execute format('grant select,insert,update,delete on public.%I to service_role',table_name);
 end loop;
end;
$$;
grant usage,select on sequence public.feature_pricing_change_log_id_seq,public.feature_credit_ledger_id_seq,
 public.feature_access_grant_events_id_seq,public.feature_pack_refunds_id_seq to service_role;
grant select on public.feature_public_pricing to anon,authenticated;
grant select on public.feature_my_credit_lots,public.feature_my_payment_receipts,public.feature_my_billing_summary to authenticated;
revoke all on public.feature_public_pricing,public.feature_my_credit_lots,public.feature_my_payment_receipts,public.feature_my_billing_summary from public;
