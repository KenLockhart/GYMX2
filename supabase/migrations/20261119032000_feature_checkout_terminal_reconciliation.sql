-- A Checkout reservation is released only after the application has retrieved
-- the exact bound Stripe Session and verified its final expired/unpaid state.
-- This records that narrow terminal evidence without treating local deadlines,
-- failed expire calls, or stale webhook payloads as proof.

create table public.feature_checkout_terminal_attestations (
  request_id uuid primary key,
  reservation_id uuid not null unique
    references public.feature_checkout_reservations(id) on delete restrict,
  feature_key text not null check (feature_key = 'form_coach'),
  payer_id uuid not null,
  stripe_checkout_session_id text not null unique,
  stripe_customer_id text not null,
  session_status text not null check (session_status = 'expired'),
  payment_status text not null check (payment_status = 'unpaid'),
  session_mode text not null check (session_mode in ('payment', 'subscription')),
  session_metadata jsonb not null check (jsonb_typeof(session_metadata) = 'object'),
  line_item_price_id text not null,
  line_item_quantity integer not null check (line_item_quantity > 0),
  evidence_digest text not null check (evidence_digest ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now()
);

alter table public.feature_checkout_terminal_attestations enable row level security;
revoke all on public.feature_checkout_terminal_attestations from public, anon, authenticated, service_role;

create trigger feature_checkout_terminal_attestations_immutable
  before update or delete on public.feature_checkout_terminal_attestations
  for each row execute function private.reject_feature_billing_history_mutation();

create function private.protect_feature_checkout_terminal_state()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  has_attestation boolean;
  has_matching_attestation boolean;
  has_receipt boolean;
begin
  if new.state is not distinct from old.state then return new; end if;
  select exists(select 1 from public.feature_checkout_terminal_attestations a
    where a.reservation_id = old.id) into has_attestation;
  if has_attestation and new.state <> 'expired' then
    raise exception 'An attested expired Checkout reservation is immutable' using errcode = '42501';
  end if;
  if new.state = 'expired' then
    select exists(select 1 from public.feature_checkout_terminal_attestations a
      where a.reservation_id = old.id
        and a.request_id = old.request_id
        and a.feature_key = old.feature_key
        and a.payer_id = old.payer_id
        and a.stripe_checkout_session_id = old.stripe_checkout_session_id
        and a.stripe_customer_id = old.stripe_customer_id
        and a.session_status = 'expired'
        and a.payment_status = 'unpaid'
        and a.session_mode = case when old.credits_per_pack is null then 'subscription' else 'payment' end
        and a.session_metadata = jsonb_build_object(
          'feature_namespace', old.feature_key,
          'feature_key', old.feature_key,
          'payer_id', old.payer_id::text,
          'reservation_id', old.id::text,
          'request_id', old.request_id::text,
          'config_revision', old.config_revision::text,
          'price_key', old.price_key,
          'pack_quantity', old.pack_quantity::text
        )
        and a.line_item_price_id = old.stripe_price_id
        and a.line_item_quantity = old.pack_quantity)
      into has_matching_attestation;
    if not has_matching_attestation or old.state <> 'bound' then
      raise exception 'A bound Checkout reservation needs exact terminal evidence before expiry' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.state = 'paid' then
    select exists(select 1 from public.feature_payment_receipts r
      where r.reservation_id = old.id
        and r.feature_key = old.feature_key
        and r.request_id = old.request_id
        and r.payer_id = old.payer_id
        and r.config_revision = old.config_revision
        and r.price_key = old.price_key
        and r.stripe_product_id = old.stripe_product_id
        and r.stripe_price_id = old.stripe_price_id
        and r.stripe_checkout_session_id = old.stripe_checkout_session_id
        and r.pack_quantity = old.pack_quantity
        and r.amount_cents = old.total_amount_cents
        and r.currency = old.currency
        and r.disposition = 'applied')
      into has_receipt;
    if old.state <> 'bound' or not has_receipt then
      raise exception 'A paid Checkout reservation needs its exact payment receipt' using errcode = '42501';
    end if;
    return new;
  end if;
  if (old.state = 'reserved' and new.state in ('unknown','bound','cancel_required'))
    or (old.state = 'unknown' and new.state in ('bound','cancel_required'))
    or (old.state = 'bound' and new.state = 'cancel_required') then
    return new;
  end if;
  raise exception 'Unsupported Checkout reservation state transition' using errcode = '42501';
end;
$$;
revoke all on function private.protect_feature_checkout_terminal_state() from public, anon, authenticated;
create trigger feature_checkout_terminal_state_guard
  before update of state on public.feature_checkout_reservations
  for each row execute function private.protect_feature_checkout_terminal_state();

create function public.record_form_coach_checkout_expired_session(
  p_request_id uuid,
  p_reservation_id uuid,
  p_session_id text,
  p_customer_id text,
  p_session_status text,
  p_payment_status text,
  p_mode text,
  p_metadata jsonb,
  p_price_id text,
  p_quantity integer,
  p_evidence_digest text
)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  payer_id_value uuid;
  reservation public.feature_checkout_reservations%rowtype;
  existing public.feature_checkout_terminal_attestations%rowtype;
  billing_model_value text;
  expected_mode text;
  expected_metadata jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_reservation_id is null
    or nullif(trim(p_session_id), '') is null or char_length(p_session_id) > 255
    or nullif(trim(p_customer_id), '') is null or char_length(p_customer_id) > 255
    or p_session_status is null or p_payment_status is null or p_mode is null
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
    or nullif(trim(p_price_id), '') is null or char_length(p_price_id) > 255
    or p_quantity is null or p_quantity < 1
    or p_evidence_digest is null or p_evidence_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid expired Checkout evidence' using errcode = '22023';
  end if;
  if p_session_status <> 'expired' or p_payment_status <> 'unpaid' then
    return 'not_terminal';
  end if;

  -- Match all billing/account-deletion/receipt writers: payer advisory lock,
  -- then the immutable Checkout reservation row.
  select r.payer_id into payer_id_value
    from public.feature_checkout_reservations r
    where r.id = p_reservation_id and r.feature_key = 'form_coach';
  if not found then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(payer_id_value::text, 0));
  select r.* into reservation
    from public.feature_checkout_reservations r
    where r.id = p_reservation_id and r.feature_key = 'form_coach'
    for update;
  if not found then return 'not_found'; end if;
  if reservation.payer_id is distinct from payer_id_value then
    raise exception 'Checkout payer changed unexpectedly' using errcode = '40001';
  end if;

  select r.billing_model into billing_model_value
    from public.feature_pricing_revisions r
    where r.feature_key = reservation.feature_key and r.revision = reservation.config_revision;
  expected_mode := case when billing_model_value = 'subscription' then 'subscription'
                        when billing_model_value = 'per_assessment' then 'payment' else null end;
  expected_metadata := jsonb_build_object(
    'feature_namespace', reservation.feature_key,
    'feature_key', reservation.feature_key,
    'payer_id', reservation.payer_id::text,
    'reservation_id', reservation.id::text,
    'request_id', reservation.request_id::text,
    'config_revision', reservation.config_revision::text,
    'price_key', reservation.price_key,
    'pack_quantity', reservation.pack_quantity::text
  );
  if reservation.request_id <> p_request_id
    or reservation.stripe_checkout_session_id is distinct from p_session_id
    or reservation.stripe_customer_id is distinct from p_customer_id
    or reservation.feature_key <> 'form_coach'
    or expected_mode is null or p_mode <> expected_mode
    or p_metadata <> expected_metadata
    or p_price_id <> reservation.stripe_price_id
    or p_quantity <> reservation.pack_quantity then
    return 'quote_mismatch';
  end if;

  select * into existing
    from public.feature_checkout_terminal_attestations a
    where a.request_id = p_request_id
    for update;
  if found then
    if (existing.reservation_id, existing.feature_key, existing.payer_id,
        existing.stripe_checkout_session_id, existing.stripe_customer_id,
        existing.session_status, existing.payment_status, existing.session_mode,
        existing.session_metadata, existing.line_item_price_id, existing.line_item_quantity,
        existing.evidence_digest)
       is distinct from
       (p_reservation_id, 'form_coach'::text, reservation.payer_id,
        p_session_id, p_customer_id, 'expired'::text, 'unpaid'::text, p_mode,
        p_metadata, p_price_id, p_quantity, p_evidence_digest)
       or reservation.state <> 'expired'
       or reservation.request_id <> p_request_id
       or reservation.stripe_checkout_session_id <> p_session_id
       or reservation.stripe_customer_id <> p_customer_id then
      return 'conflict';
    end if;
    return 'already_expired';
  end if;
  if exists (select 1 from public.feature_checkout_terminal_attestations a
      where a.reservation_id = p_reservation_id or a.stripe_checkout_session_id = p_session_id) then
    return 'conflict';
  end if;

  -- A session with a receipt, subscription binding, or subscription mapping is
  -- contradictory to the exact expired/unpaid provider snapshot.
  if exists (select 1 from public.feature_payment_receipts r
      where r.reservation_id = reservation.id or r.stripe_checkout_session_id = p_session_id) then
    return 'payment_exists';
  end if;
  if reservation.stripe_subscription_id is not null
    or exists (select 1 from public.feature_subscriptions s
      where s.feature_key = reservation.feature_key
        and s.stripe_subscription_id = reservation.stripe_subscription_id) then
    return 'subscription_conflict';
  end if;
  if reservation.state <> 'bound' then return 'not_bound'; end if;
  if not exists (select 1
      from public.feature_payer_customer_mappings m
      join public.feature_customer_create_attempts a on a.id = m.create_attempt_id
      join public.feature_provider_objects o on o.feature_key = m.feature_key
        and o.object_type = 'customer' and o.object_id = m.stripe_customer_id
      where m.feature_key = reservation.feature_key and m.payer_id = reservation.payer_id
        and m.stripe_customer_id = reservation.stripe_customer_id
        and a.feature_key = reservation.feature_key and a.payer_id = reservation.payer_id
        and a.state = 'verified' and a.stripe_customer_id = reservation.stripe_customer_id
        and o.payer_id = reservation.payer_id)
    or not exists (select 1 from public.feature_provider_objects o
      where o.feature_key = reservation.feature_key and o.object_type = 'checkout_session'
        and o.object_id = p_session_id and o.config_revision = reservation.config_revision
        and o.price_key = reservation.price_key and o.payer_id = reservation.payer_id) then
    return 'binding_mismatch';
  end if;

  insert into public.feature_checkout_terminal_attestations(
    request_id, reservation_id, feature_key, payer_id, stripe_checkout_session_id,
    stripe_customer_id, session_status, payment_status, session_mode,
    session_metadata, line_item_price_id, line_item_quantity, evidence_digest
  ) values (
    p_request_id, reservation.id, reservation.feature_key, reservation.payer_id,
    p_session_id, p_customer_id, 'expired', 'unpaid', p_mode,
    p_metadata, p_price_id, p_quantity, p_evidence_digest
  );
  update public.feature_checkout_reservations r set state = 'expired'
    where r.id = reservation.id and r.state = 'bound'
      and r.stripe_checkout_session_id = p_session_id
      and r.stripe_customer_id = p_customer_id;
  if not found then
    raise exception 'Checkout reservation changed while recording terminal evidence' using errcode = '40001';
  end if;
  return 'expired';
end;
$$;

revoke all on function public.record_form_coach_checkout_expired_session(uuid,uuid,text,text,text,text,text,jsonb,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.record_form_coach_checkout_expired_session(uuid,uuid,text,text,text,text,text,jsonb,text,integer,text)
  to service_role;

create function private.reject_receipt_for_expired_feature_checkout()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  payer_id_value uuid;
  checkout_state text;
begin
  select r.payer_id into payer_id_value from public.feature_checkout_reservations r
    where r.id = new.reservation_id;
  if not found then
    raise exception 'Checkout reservation is missing' using errcode = '23503';
  end if;
  -- Same lock order as apply_feature_checkout_payment and the terminal RPC.
  perform pg_advisory_xact_lock(hashtextextended(payer_id_value::text, 0));
  select r.state into checkout_state from public.feature_checkout_reservations r
    where r.id = new.reservation_id for update;
  if checkout_state = 'expired' or exists (select 1 from public.feature_checkout_terminal_attestations a
      where a.reservation_id = new.reservation_id) then
    raise exception 'An expired Checkout session cannot create a payment receipt' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_receipt_for_expired_feature_checkout() from public, anon, authenticated;
create trigger feature_checkout_expired_receipt_guard
  before insert on public.feature_payment_receipts
  for each row execute function private.reject_receipt_for_expired_feature_checkout();
