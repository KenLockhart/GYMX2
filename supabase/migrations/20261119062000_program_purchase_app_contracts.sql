-- Narrow buyer-facing Program purchase reads and one atomic server confirmation.
-- Order, billing, provider and promotion tables remain inaccessible to API roles.

create function private.program_purchase_charge_dates(p_today date, p_installment_count smallint)
returns date[] language plpgsql immutable set search_path = '' as $$
declare
  v_dates date[] := array[]::date[];
  v_first date;
  v_anchor_day integer;
  v_end_of_month boolean;
  v_next_month date;
  v_last_day date;
  v_next date;
  v_index integer;
begin
  if p_today is null or p_installment_count is null or p_installment_count < 0 or p_installment_count > 12 then
    raise exception 'Program installment schedule input is invalid' using errcode = '22023';
  end if;
  if p_installment_count <= 1 then return v_dates; end if;

  v_first := (p_today + interval '1 month')::date;
  v_anchor_day := extract(day from v_first)::integer;
  v_end_of_month := v_first = (date_trunc('month',v_first::timestamp) + interval '1 month - 1 day')::date;
  v_dates := array_append(v_dates,v_first);
  for v_index in 2..p_installment_count - 1 loop
    v_next_month := date_trunc('month',(v_dates[array_length(v_dates,1)] + interval '1 month'))::date;
    v_last_day := (v_next_month + interval '1 month - 1 day')::date;
    v_next := case when v_end_of_month then v_last_day
      else v_next_month + least(v_anchor_day,extract(day from v_last_day)::integer) - 1 end;
    v_dates := array_append(v_dates,v_next);
  end loop;
  return v_dates;
end;
$$;
revoke all on function private.program_purchase_charge_dates(date,smallint) from public, anon, authenticated, service_role;

create function private.program_purchase_quote_payload(
  p_program_id uuid,p_offer_version_id uuid,p_content_version_id uuid,p_lesson_count smallint,
  p_currency text,p_list_price_cents integer,p_discount_cents integer,p_effective_total_cents integer,
  p_payment_plan text,p_installment_count smallint,p_installment_amounts integer[],p_maximum_installments smallint,
  p_promotion_code text,p_quote_date date,p_charge_dates date[]
)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'program_id',p_program_id,'offer_version_id',p_offer_version_id,
    'content_version_id',p_content_version_id,'lesson_count',p_lesson_count,
    'currency',p_currency,'list_price_cents',p_list_price_cents,'discount_cents',p_discount_cents,
    'effective_total_cents',p_effective_total_cents,'payment_plan',p_payment_plan,
    'installment_count',p_installment_count,'installment_amounts_cents',to_jsonb(p_installment_amounts),
    'maximum_installments',p_maximum_installments,'promotion_code',p_promotion_code,
    'quote_date',case when p_installment_count > 1 then p_quote_date else null end,
    'charge_dates',to_jsonb(p_charge_dates),'off_session_consent',p_installment_count > 1,
    'retry_window_days',case when p_installment_count > 1 then 7 else null end,
    'cancellation_stops_future_charges',true,'schedule_policy_version','monthly_calendar_eom_v1'
  );
$$;
revoke all on function private.program_purchase_quote_payload(uuid,uuid,uuid,smallint,text,integer,integer,integer,text,smallint,integer[],smallint,text,date,date[])
  from public, anon, authenticated, service_role;

create function private.program_purchase_quote_digest(p_payload jsonb)
returns text language sql immutable set search_path = '' as $$
  select private.stream_media_identity_digest('program-purchase-quote-v1|' || coalesce(p_payload,'null'::jsonb)::text);
$$;
revoke all on function private.program_purchase_quote_digest(jsonb) from public, anon, authenticated, service_role;

create function private.program_purchase_terms_digest(p_order_id uuid,p_quote_digest text,p_off_session_consent boolean,p_retry_window_days smallint)
returns text language sql immutable set search_path = '' as $$
  select private.stream_media_identity_digest(concat_ws(chr(31),
    'program-billing-terms-v1',p_order_id::text,p_quote_digest,'billing_consent=accepted',
    'off_session=' || p_off_session_consent::text,
    'retry_window_days=' || coalesce(p_retry_window_days::text,'none'),
    'cancellation_stops_future_charges=true'));
$$;
revoke all on function private.program_purchase_terms_digest(uuid,text,boolean,smallint) from public, anon, authenticated, service_role;

create function private.program_purchase_context(p_order_id uuid,p_buyer_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_context jsonb;
begin
  select jsonb_build_object(
    'status','ready',
    'order_id',orders.id,
    'request_id',case when orders.idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then orders.idempotency_key::uuid else null end,
    'buyer_id',orders.buyer_id,
    'program_id',orders.program_id,
    'offer_version_id',orders.offer_version_id,
    'content_version_id',orders.content_version_id,
    'lesson_count',orders.lesson_count,
    'currency',orders.currency,
    'list_price_cents',orders.list_price_cents,
    'discount_cents',orders.discount_cents,
    'effective_total_cents',orders.effective_total_cents,
    'payment_plan',orders.payment_plan,
    'installment_count',orders.installment_count,
    'installment_amounts_cents',to_jsonb(orders.installment_amounts_cents),
    'promotion_code',promotion.code,
    'zero_total_grant_reason',orders.zero_total_grant_reason,
    'order_state',state.billing_state,
    'billing_state',coalesce(billing.billing_state,state.billing_state),
    'billing_revision',coalesce(billing.revision,0),
    'terms',case when billing.order_id is null then null else jsonb_build_object(
      'digest',billing.terms_digest,'accepted_at',billing.accepted_at,
      'total_cents',billing.accepted_total_cents,
      'installment_count',billing.accepted_installment_count,
      'disclosed_charge_dates',to_jsonb(billing.disclosed_charge_dates),
      'saved_card_for_off_session',billing.off_session_consent,
      'retry_window_days',billing.retry_window_days,
      'cancellation_stops_future_charges',billing.cancellation_stops_future_charges
    ) end,
    'first_settled_at',billing.first_settled_at,
    'next_anchor_date',billing.next_anchor_date,
    'cancellation_requested',billing.cancellation_request_id is not null,
    'financial_conflict',coalesce(billing.financial_conflict,false),
    'canceled',coalesce(billing.billing_state = 'canceled' or state.billing_state = 'canceled',false)
  ) into v_context
  from public.program_orders orders
  join public.program_order_state state on state.order_id = orders.id
  left join public.program_promotions promotion on promotion.id = orders.promotion_id
  left join public.program_billing_orders billing on billing.order_id = orders.id
  where orders.id = p_order_id and orders.buyer_id = p_buyer_id;
  return coalesce(v_context,jsonb_build_object('status','not_found'));
end;
$$;
revoke all on function private.program_purchase_context(uuid,uuid) from public, anon, authenticated, service_role;

create function public.get_my_program_purchase_context(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'A signed-in buyer is required for Program purchase context' using errcode = '42501';
  end if;
  if p_order_id is null then return jsonb_build_object('status','not_found'); end if;
  return private.program_purchase_context(p_order_id,auth.uid());
end;
$$;
revoke all on function public.get_my_program_purchase_context(uuid) from public, anon, service_role;
grant execute on function public.get_my_program_purchase_context(uuid) to authenticated;

create function public.get_my_program_purchase_request(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_context jsonb;
  v_buyer_id uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    raise exception 'A signed-in buyer is required for Program purchase recovery' using errcode = '42501';
  end if;
  if p_request_id is null then return jsonb_build_object('status','not_found'); end if;
  select private.program_purchase_context(orders.id,v_buyer_id) into v_context
  from public.program_orders orders
  where orders.buyer_id = v_buyer_id and orders.idempotency_key = p_request_id::text;
  if not found or v_context->>'status' <> 'ready' then return jsonb_build_object('status','not_found'); end if;
  return jsonb_build_object(
    'status','found','request_id',p_request_id,
    'order_id',v_context->'order_id','buyer_id',v_context->'buyer_id',
    'program_id',v_context->'program_id','offer_version_id',v_context->'offer_version_id',
    'installment_count',v_context->'installment_count','promotion_code',v_context->'promotion_code'
  );
end;
$$;
revoke all on function public.get_my_program_purchase_request(uuid) from public, anon, service_role;
grant execute on function public.get_my_program_purchase_request(uuid) to authenticated;

create function public.get_my_program_purchase_quote(
  p_program_id uuid,p_installment_count smallint,p_promotion_code text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_buyer_id uuid := auth.uid();
  v_program_published boolean;
  v_program_platform_owned boolean;
  v_program_coach_id uuid;
  v_current_content_version_id uuid;
  v_current_offer_version_id uuid;
  v_offer public.program_offer_versions%rowtype;
  v_version public.program_content_versions%rowtype;
  v_promotion public.program_promotions%rowtype;
  v_promo_code text := nullif(upper(btrim(p_promotion_code)), '');
  v_discount integer := 0;
  v_total integer;
  v_plan text;
  v_amounts integer[] := array[]::integer[];
  v_each integer;
  v_remainder integer;
  v_max_installments smallint;
  v_used bigint;
  v_now timestamptz := clock_timestamp();
  v_today date;
  v_charge_dates date[] := array[]::date[];
  v_payload jsonb;
  v_digest text;
  v_index integer;
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    raise exception 'A signed-in Regular member is required for a Program quote' using errcode = '42501';
  end if;
  if p_program_id is null or p_installment_count is null
     or (v_promo_code is not null and v_promo_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    return jsonb_build_object('status','invalid_request');
  end if;
  if not private.stream_media_account_ingress_allowed(v_buyer_id)
     or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = v_buyer_id)
     or private.stream_account_is_tombstoned(v_buyer_id) then
    return jsonb_build_object('status','account_fenced');
  end if;
  if not private.has_role(v_buyer_id,'member'::public.user_role)
     or not private.has_platform_tier(v_buyer_id,'regular') then
    return jsonb_build_object('status','buyer_ineligible');
  end if;
  if exists (select 1 from public.program_orders orders where orders.buyer_id = v_buyer_id and orders.program_id = p_program_id) then
    return jsonb_build_object('status','already_owned');
  end if;

  select program.published,program.platform_owned,program.coach_id,
    state.current_content_version_id,state.current_offer_version_id
  into v_program_published,v_program_platform_owned,v_program_coach_id,
    v_current_content_version_id,v_current_offer_version_id
  from public.programs program
  join public.program_commerce_state state on state.program_id = program.id
  where program.id = p_program_id;
  if not found or not v_program_published then return jsonb_build_object('status','not_available'); end if;
  select offer.* into v_offer from public.program_offer_versions offer
  where offer.program_id = p_program_id and offer.id = v_current_offer_version_id;
  if not found or v_offer.offer_kind <> 'paid'
     or v_offer.content_version_id is distinct from v_current_content_version_id
     or v_offer.platform_owned is distinct from v_program_platform_owned
     or v_offer.seller_profile_id is distinct from v_program_coach_id then
    return jsonb_build_object('status','not_available');
  end if;
  select version.* into v_version from public.program_content_versions version
  where version.program_id = p_program_id and version.id = v_offer.content_version_id;
  if not found or v_version.revision_kind <> 'paid' or v_version.lesson_count not between 1 and 365 then
    return jsonb_build_object('status','not_available');
  end if;
  if not v_program_platform_owned and not exists (
    select 1 from public.coach_members link where link.coach_id = v_program_coach_id and link.member_id = v_buyer_id
  ) then
    return jsonb_build_object('status','buyer_ineligible');
  end if;
  v_max_installments := least(12::smallint,v_version.lesson_count,v_offer.max_installments);

  if v_promo_code is not null then
    select promotion.* into v_promotion from public.program_promotions promotion
    where promotion.program_id = p_program_id and promotion.offer_version_id = v_offer.id
      and promotion.code = v_promo_code;
    if not found or not v_promotion.enabled or v_promotion.starts_at > v_now
       or (v_promotion.ends_at is not null and v_promotion.ends_at <= v_now) then
      return jsonb_build_object('status','promotion_unavailable');
    end if;
    select count(*) into v_used from public.program_promotion_reservations reservation
    where reservation.promotion_id = v_promotion.id and reservation.state in ('reserved','redeemed');
    if v_used >= v_promotion.max_redemptions
       or exists (select 1 from public.program_promotion_redemptions redemption
         where redemption.promotion_id = v_promotion.id and redemption.member_id = v_buyer_id)
       or exists (select 1 from public.program_promotion_reservations reservation
         where reservation.promotion_id = v_promotion.id and reservation.member_id = v_buyer_id
           and reservation.state in ('reserved','redeemed')) then
      return jsonb_build_object('status','promotion_unavailable');
    end if;
    v_discount := case v_promotion.discount_kind
      when 'fixed' then least(v_offer.list_price_cents,v_promotion.discount_value)
      else round((v_offer.list_price_cents::numeric * v_promotion.discount_value::numeric) / 10000)::integer
    end;
  end if;

  v_total := v_offer.list_price_cents - v_discount;
  if v_total = 0 then
    if v_promotion.id is null or p_installment_count <> 0 then
      return jsonb_build_object('status','installment_invalid');
    end if;
    v_plan := 'free';
  else
    if p_installment_count < 1 or p_installment_count > v_max_installments then
      return jsonb_build_object('status','installment_invalid');
    end if;
    if v_total < 50 then return jsonb_build_object('status','charge_below_minimum'); end if;
    v_plan := case when p_installment_count = 1 then 'pay_in_full' else 'installments' end;
    if v_plan = 'pay_in_full' then
      v_amounts := array[v_total];
    else
      v_each := v_total / p_installment_count;
      v_remainder := v_total - v_each * (p_installment_count - 1);
      if v_each < 50 or v_remainder < 50 then return jsonb_build_object('status','charge_below_minimum'); end if;
      for v_index in 1..p_installment_count loop
        v_amounts := array_append(v_amounts,case when v_index = p_installment_count then v_remainder else v_each end);
      end loop;
    end if;
  end if;

  v_today := (v_now at time zone 'America/New_York')::date;
  v_charge_dates := private.program_purchase_charge_dates(v_today,p_installment_count);
  v_payload := private.program_purchase_quote_payload(
    p_program_id,v_offer.id,v_version.id,v_version.lesson_count,v_offer.currency,
    v_offer.list_price_cents,v_discount,v_total,v_plan,
    p_installment_count,
    v_amounts,v_max_installments,v_promo_code,
    case when p_installment_count > 1 then v_today else null end,v_charge_dates);
  v_digest := private.program_purchase_quote_digest(v_payload);
  return v_payload || jsonb_build_object('status','ready','quote_digest',v_digest);
end;
$$;
revoke all on function public.get_my_program_purchase_quote(uuid,smallint,text) from public, anon, service_role;
grant execute on function public.get_my_program_purchase_quote(uuid,smallint,text) to authenticated;

create function public.confirm_program_purchase(
  p_buyer_id uuid,
  p_program_id uuid,
  p_offer_version_id uuid,
  p_installment_count smallint,
  p_request_id uuid,
  p_promotion_code text,
  p_expected_quote_digest text,
  p_charge_dates date[],
  p_billing_consent boolean,
  p_off_session_consent boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.program_orders%rowtype;
  v_existing_promo text;
  v_order public.program_orders%rowtype;
  v_offer public.program_offer_versions%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_promo_code text := nullif(upper(btrim(p_promotion_code)), '');
  v_order_id uuid;
  v_today date;
  v_dates date[] := array[]::date[];
  v_payload jsonb;
  v_quote_digest text;
  v_terms_digest text;
  v_terms jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Program purchase confirmation is server managed' using errcode = '42501';
  end if;
  if p_buyer_id is null or p_program_id is null or p_offer_version_id is null
     or p_installment_count is null or p_request_id is null then
    return jsonb_build_object('status','invalid_request');
  end if;

  -- Recover the owner-bound idempotency key before checking current membership,
  -- offer availability, promotion quota, consent or quote freshness.
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_id::text,0));
  select orders.* into v_existing from public.program_orders orders
  where orders.buyer_id = p_buyer_id and orders.idempotency_key = p_request_id::text for update;
  if found then
    select promotion.code into v_existing_promo from public.program_promotions promotion
    where promotion.id = v_existing.promotion_id;
    if v_existing.program_id is distinct from p_program_id
       or v_existing.offer_version_id is distinct from p_offer_version_id
       or v_existing.installment_count is distinct from p_installment_count
       or v_existing_promo is distinct from v_promo_code then
      return jsonb_build_object('status','request_conflict');
    end if;
    if v_existing.payment_plan = 'free' then
      return jsonb_build_object('status','already_granted','order_id',v_existing.id,'billing_revision',null);
    end if;
    select billing.* into v_billing from public.program_billing_orders billing where billing.order_id = v_existing.id;
    if not found then return jsonb_build_object('status','terms_missing'); end if;
    return jsonb_build_object('status','already_confirmed','order_id',v_existing.id,'billing_revision',v_billing.revision);
  end if;

  if v_promo_code is not null and v_promo_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'
     or p_expected_quote_digest is null or p_expected_quote_digest !~ '^[0-9a-f]{64}$'
     or p_charge_dates is null or p_installment_count < 0 or p_installment_count > 12 then
    return jsonb_build_object('status','invalid_request');
  end if;
  if p_installment_count > 0 and p_billing_consent is distinct from true then
    return jsonb_build_object('status','consent_required');
  end if;
  if p_installment_count > 1 and p_off_session_consent is distinct from true then
    return jsonb_build_object('status','off_session_consent_required');
  end if;
  if p_installment_count <= 1 and p_off_session_consent is distinct from false then
    return jsonb_build_object('status','invalid_request');
  end if;

  begin
    v_order_id := public.create_program_order_reservation(
      p_buyer_id,p_program_id,p_offer_version_id,p_installment_count,p_request_id::text,v_promo_code);
    select orders.* into v_order from public.program_orders orders where orders.id = v_order_id;
    if not found then raise exception 'Program reservation did not persist' using errcode = 'PZ002'; end if;
    -- Recheck fences and buyer/coach eligibility after the reservation acquired its account lock.
    -- This also protects the zero-total branch, which does not call the billing-terms RPC.
    if not private.stream_media_account_ingress_allowed(p_buyer_id)
       or exists (select 1 from public.platform_membership_deletion_locks fence where fence.member_id = p_buyer_id)
       or private.stream_account_is_tombstoned(p_buyer_id) then
      raise exception 'Program purchase is blocked by an account fence' using errcode = 'PZ003';
    end if;
    if not private.program_billing_order_is_eligible(v_order.id,p_buyer_id) then
      raise exception 'Program buyer eligibility changed' using errcode = 'PZ004';
    end if;
    select offer.* into v_offer from public.program_offer_versions offer
    where offer.program_id = v_order.program_id and offer.id = v_order.offer_version_id;
    if not found then raise exception 'Program offer context is unavailable' using errcode = 'PZ002'; end if;
    select promotion.code into v_existing_promo from public.program_promotions promotion
    where promotion.id = v_order.promotion_id;

    -- Recompute after the order creator acquired its buyer, Program and promotion locks.
    -- If New York's date changed while waiting, the exception block rolls back order and quota.
    v_today := (clock_timestamp() at time zone 'America/New_York')::date;
    v_dates := private.program_purchase_charge_dates(v_today,v_order.installment_count);
    if v_dates is distinct from p_charge_dates then
      raise exception 'Program purchase quote changed' using errcode = 'PZ001';
    end if;
    v_payload := private.program_purchase_quote_payload(
      v_order.program_id,v_order.offer_version_id,v_order.content_version_id,v_order.lesson_count,
      v_order.currency,v_order.list_price_cents,v_order.discount_cents,v_order.effective_total_cents,
      v_order.payment_plan,v_order.installment_count,v_order.installment_amounts_cents,
      least(12::smallint,v_order.lesson_count,v_offer.max_installments),v_existing_promo,
      case when v_order.installment_count > 1 then v_today else null end,v_dates);
    v_quote_digest := private.program_purchase_quote_digest(v_payload);
    if v_quote_digest is distinct from p_expected_quote_digest then
      raise exception 'Program purchase quote changed' using errcode = 'PZ001';
    end if;
    if v_order.payment_plan = 'free' then
      return jsonb_build_object('status','grant_created','order_id',v_order.id,'billing_revision',null);
    end if;

    v_terms_digest := private.program_purchase_terms_digest(
      v_order.id,v_quote_digest,p_off_session_consent,
      case when v_order.installment_count > 1 then 7::smallint else null end);
    v_terms := public.prepare_program_billing_terms(
      v_order.id,0::bigint,v_terms_digest,v_dates,p_off_session_consent,
      case when v_order.installment_count > 1 then 7::smallint else null end);
    if v_terms->>'status' is distinct from 'saved' or (v_terms->>'revision')::bigint is distinct from 1 then
      raise exception 'Program billing terms were not saved' using errcode = 'PZ002';
    end if;
    return jsonb_build_object('status','confirmed','order_id',v_order.id,'billing_revision',1);
  exception
    when sqlstate 'PZ001' then return jsonb_build_object('status','quote_changed');
    when sqlstate 'PZ002' then return jsonb_build_object('status','purchase_unavailable');
    when sqlstate 'PZ003' then return jsonb_build_object('status','account_fenced');
    when sqlstate 'PZ004' then return jsonb_build_object('status','buyer_ineligible');
  end;
end;
$$;
revoke all on function public.confirm_program_purchase(uuid,uuid,uuid,smallint,uuid,text,text,date[],boolean,boolean)
  from public, anon, authenticated;
grant execute on function public.confirm_program_purchase(uuid,uuid,uuid,smallint,uuid,text,text,date[],boolean,boolean)
  to service_role;
