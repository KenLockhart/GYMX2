-- Bounded, owner-scoped Program purchase history. Keep the older
-- get_my_program_billing_history() contract unchanged for existing callers.

create function private.program_purchase_history_entry(p_order_id uuid,p_buyer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.program_orders%rowtype;
  v_state public.program_order_state%rowtype;
  v_billing public.program_billing_orders%rowtype;
  v_attempt public.program_billing_checkout_attempts%rowtype;
  v_current_invoice public.program_billing_installment_invoices%rowtype;
  v_order_found boolean := false;
  v_state_found boolean := false;
  v_billing_found boolean := false;
  v_attempt_found boolean := false;
  v_invoice_found boolean := false;
  v_order_shape_ok boolean := false;
  v_installments_ok boolean := false;
  v_terms_ok boolean := false;
  v_attempts_ok boolean := false;
  v_state_pair_ok boolean := false;
  v_has_refund boolean := false;
  v_refund_backed_by_settlement boolean := false;
  v_pending_checkout boolean := false;
  v_pending_payment boolean := false;
  v_unledgered_paid_evidence boolean := false;
  v_financial_conflict boolean := false;
  v_manual_review boolean := false;
  v_deleted boolean := false;
  v_cleared integer := 0;
  v_installment_rows integer := 0;
  v_amount_sum bigint := 0;
  v_gross_sum bigint := 0;
  v_net_sum bigint := 0;
  v_refund_sum bigint := 0;
  v_all_installment_amounts_valid boolean := false;
  v_safety_stage text := 'unknown';
  v_payment_stage text := 'unknown';
  v_cancellation_stage text := 'unknown';
  v_checkout_retry_hint boolean := false;
  v_next_due_date date;
  v_retry_deadline timestamptz;
begin
  if p_order_id is null or p_buyer_id is null then
    return null;
  end if;

  select orders.* into v_order
  from public.program_orders orders
  where orders.id = p_order_id and orders.buyer_id = p_buyer_id;
  v_order_found := found;
  if not v_order_found then
    return null;
  end if;

  select state.* into v_state
  from public.program_order_state state
  where state.order_id = p_order_id;
  v_state_found := found;

  select billing.* into v_billing
  from public.program_billing_orders billing
  where billing.order_id = p_order_id;
  v_billing_found := found;

  select coalesce(sum(amount)::bigint,0),
         coalesce(bool_and(amount is not null and amount >= 50),true)
  into v_amount_sum,v_all_installment_amounts_valid
  from unnest(v_order.installment_amounts_cents) as amounts(amount);

  if v_order.payment_plan = 'free' then
    v_order_shape_ok := v_order.effective_total_cents = 0
      and v_order.payment_plan = 'free'
      and v_order.installment_count = 0
      and cardinality(v_order.installment_amounts_cents) = 0
      and v_order.promotion_id is not null
      and v_order.zero_total_grant_reason = 'promotion_100_percent';
  else
    v_order_shape_ok := v_order.effective_total_cents > 0
      and v_order.effective_total_cents = v_order.list_price_cents - v_order.discount_cents
      and v_order.zero_total_grant_reason is null
      and v_order.installment_count between 1 and 12
      and cardinality(v_order.installment_amounts_cents) = v_order.installment_count
      and coalesce(array_lower(v_order.installment_amounts_cents,1),1) = 1
      and coalesce(array_upper(v_order.installment_amounts_cents,1),0) = v_order.installment_count
      and v_amount_sum = v_order.effective_total_cents
      and v_all_installment_amounts_valid
      and ((v_order.payment_plan = 'pay_in_full' and v_order.installment_count = 1)
        or (v_order.payment_plan = 'installments' and v_order.installment_count between 2 and 12));
  end if;

  select count(*)::integer,
         coalesce(bool_and(installment.due_cents =
           v_order.installment_amounts_cents[installment.installment_number]),true),
         coalesce(bool_or(installment.provider_refunded_cents > 0
           or installment.refund_marker_cents > 0),false),
         coalesce(bool_or(greatest(installment.provider_refunded_cents,installment.refund_marker_cents) > 0
           and installment.gross_settled_cents > 0),false),
         coalesce(sum(installment.gross_settled_cents),0)::bigint,
         coalesce(sum(installment.net_settled_cents),0)::bigint,
         coalesce(sum(greatest(installment.provider_refunded_cents,installment.refund_marker_cents)),0)::bigint
  into v_installment_rows,v_all_installment_amounts_valid,v_has_refund,v_refund_backed_by_settlement,
    v_gross_sum,v_net_sum,v_refund_sum
  from public.program_order_installments installment
  where installment.order_id = p_order_id;

  v_installments_ok := v_installment_rows = v_order.installment_count
    and v_all_installment_amounts_valid
    and not exists (
      select 1
      from generate_series(1,v_order.installment_count) as expected(installment_number)
      left join public.program_order_installments installment
        on installment.order_id = p_order_id
       and installment.installment_number = expected.installment_number
      where installment.order_id is null
    )
    and not exists (
      select 1 from public.program_order_installments installment
      where installment.order_id = p_order_id
        and installment.installment_number > v_order.installment_count
    );

  select coalesce(max(settled.installment_number),0)::integer into v_cleared
  from generate_series(1,v_order.installment_count) as settled(installment_number)
  where not exists (
    select 1
    from generate_series(1,settled.installment_number) as required(installment_number)
    left join public.program_order_installments installment
      on installment.order_id = p_order_id
     and installment.installment_number = required.installment_number
    where installment.order_id is null
       or installment.net_settled_cents <>
         v_order.installment_amounts_cents[required.installment_number]
  );

  if v_billing_found then
    v_terms_ok := v_billing.terms_version = 1
      and v_billing.terms_digest ~ '^[0-9a-f]{64}$'
      and v_billing.accepted_total_cents = v_order.effective_total_cents
      and v_billing.accepted_installment_count = v_order.installment_count
      and v_billing.cancellation_stops_future_charges
      and coalesce(array_lower(v_billing.disclosed_charge_dates,1),1) = 1
      and coalesce(array_upper(v_billing.disclosed_charge_dates,1),0) =
        cardinality(v_billing.disclosed_charge_dates)
      and (
        (v_order.installment_count = 1
          and not v_billing.off_session_consent
          and v_billing.retry_window_days is null
          and cardinality(v_billing.disclosed_charge_dates) = 0)
        or (v_order.installment_count > 1
          and v_billing.off_session_consent
          and v_billing.retry_window_days = 7
          and cardinality(v_billing.disclosed_charge_dates) = v_order.installment_count - 1)
      );

    select count(*)::integer into v_installment_rows
    from public.program_billing_checkout_attempts attempt
    where attempt.order_id = p_order_id;
    v_attempts_ok := v_installment_rows = v_billing.current_checkout_attempt
      and not exists (
        select 1
        from generate_series(1,v_billing.current_checkout_attempt) as expected(attempt_number)
        left join public.program_billing_checkout_attempts attempt
          on attempt.order_id = p_order_id
         and attempt.attempt_number = expected.attempt_number
        where attempt.order_id is null
      );
    if v_billing.current_checkout_attempt > 0 then
      select attempt.* into v_attempt
      from public.program_billing_checkout_attempts attempt
      where attempt.order_id = p_order_id
        and attempt.attempt_number = v_billing.current_checkout_attempt;
      v_attempt_found := found;
      v_attempts_ok := v_attempts_ok and v_attempt_found;
    end if;

    if v_billing.next_installment_number is not null then
      if v_billing.next_installment_number < 2
         or v_billing.next_installment_number > v_order.installment_count
         or v_billing.next_anchor_date is distinct from
           v_billing.disclosed_charge_dates[v_billing.next_installment_number - 1] then
        v_terms_ok := false;
      end if;
      select invoice.* into v_current_invoice
      from public.program_billing_installment_invoices invoice
      where invoice.order_id = p_order_id
        and invoice.installment_number = v_billing.next_installment_number;
      v_invoice_found := found;
      if v_invoice_found then
        v_next_due_date := v_current_invoice.due_date;
        v_retry_deadline := v_current_invoice.retry_deadline;
        if v_billing.next_anchor_date is distinct from v_current_invoice.due_date then
          v_terms_ok := false;
        end if;
      else
        v_next_due_date := v_billing.next_anchor_date;
      end if;
    end if;

    select exists (
      select 1 from public.program_billing_operations operation
      where operation.order_id = p_order_id
        and operation.operation_kind in ('customer_create','checkout_create')
        and operation.operation_state in ('intent','unknown')
    ) into v_pending_checkout;

    select exists (
      select 1 from public.program_billing_operations operation
      where operation.order_id = p_order_id
        and operation.operation_kind in
          ('invoice_create','invoice_item_create','invoice_finalize','invoice_pay')
        and operation.operation_state in ('intent','unknown')
    ) into v_pending_payment;

    select exists (
      select 1
      from public.program_billing_provider_observations observation
      where observation.order_id = p_order_id
        and observation.provider_status in ('complete','paid','succeeded')
        and not exists (
          select 1 from public.program_order_installments installment
          where installment.order_id = p_order_id
            and installment.installment_number =
              coalesce(observation.installment_number,1)
            and installment.gross_settled_cents = installment.due_cents
        )
    ) into v_unledgered_paid_evidence;

    v_financial_conflict := v_billing.financial_conflict
      or v_billing.billing_state = 'financial_conflict'
      or exists (
        select 1 from public.program_billing_financial_conflicts conflict
        where conflict.order_id = p_order_id
      );

    v_manual_review := v_billing.billing_state = 'manual_review'
      or exists (
        select 1 from public.program_billing_provider_observations observation
        where observation.order_id = p_order_id and observation.manual_review_required
      )
      or exists (
        select 1 from public.program_billing_retry_requests request
        where request.order_id = p_order_id and request.request_state = 'manual_review'
      );

    v_deleted := v_billing.account_tombstone_id is not null
      or v_billing.billing_state = 'deletion_pending';
  end if;

  if v_state_found then
    v_deleted := v_deleted or v_state.billing_state = 'closed';
  end if;

  if v_billing_found and v_state_found then
    v_state_pair_ok := case v_billing.billing_state
      when 'terms_saved' then v_state.billing_state = 'awaiting_checkout'
      when 'checkout_ready' then v_state.billing_state in ('awaiting_checkout','checkout_pending')
      when 'active' then v_state.billing_state in ('active','cancel_requested','canceled')
        or (v_has_refund and v_state.billing_state = 'awaiting_checkout')
      when 'paid' then v_state.billing_state in ('paid','cancel_requested','canceled')
        or (v_has_refund and v_state.billing_state in ('awaiting_checkout','active'))
      when 'cancel_requested' then v_state.billing_state = 'cancel_requested'
      when 'canceled' then v_state.billing_state = 'canceled'
      when 'deletion_pending' then v_state.billing_state = 'closed'
      when 'financial_conflict' then true
      when 'manual_review' then true
      else false
    end;
  end if;

  if v_deleted then
    v_safety_stage := 'deletion_hold';
  elsif v_financial_conflict then
    v_safety_stage := 'financial_conflict';
  elsif v_manual_review then
    v_safety_stage := 'manual_review';
  elsif not v_state_found
     or not v_order_shape_ok
     or not v_installments_ok
     or (v_order.payment_plan = 'free' and v_billing_found)
     or (v_order.effective_total_cents > 0 and not v_billing_found)
     or (v_billing_found and (not v_terms_ok or not v_attempts_ok or not v_state_pair_ok)) then
    v_safety_stage := 'unknown';
  else
    v_safety_stage := 'clear';
  end if;

  if v_safety_stage = 'deletion_hold' then
    v_cancellation_stage := 'unknown';
  elsif v_order.payment_plan = 'free'
     and v_order.effective_total_cents = 0
     and v_order.zero_total_grant_reason = 'promotion_100_percent'
     and v_state_found and v_state.billing_state = 'free_grant'
     and not v_billing_found then
    v_cancellation_stage := 'not_applicable';
  elsif not v_billing_found then
    v_cancellation_stage := 'unknown';
  elsif v_billing.cancellation_request_id is not null
     and v_billing.cancellation_reason = 'buyer'
     and v_billing.billing_state = 'cancel_requested'
     and v_state_found and v_state.billing_state = 'cancel_requested' then
    v_cancellation_stage := 'requested';
  elsif v_billing.cancellation_request_id is not null
     and v_billing.cancellation_reason = 'buyer'
     and v_billing.billing_state = 'canceled'
     and v_state_found and v_state.billing_state = 'canceled' then
    v_cancellation_stage := 'completed';
  elsif v_billing.cancellation_request_id is null
     and v_billing.cancellation_reason is null
     and v_billing.billing_state not in ('cancel_requested','canceled','deletion_pending')
     and v_state_found
     and v_state.billing_state not in ('cancel_requested','canceled','closed') then
    v_cancellation_stage := 'none';
  else
    v_cancellation_stage := 'unknown';
  end if;

  if v_safety_stage = 'clear' and v_cancellation_stage = 'unknown' then
    v_safety_stage := 'unknown';
  end if;

  if v_safety_stage <> 'clear' then
    v_payment_stage := 'unknown';
    v_next_due_date := null;
    v_retry_deadline := null;
  elsif v_order.payment_plan = 'free' then
    v_payment_stage := 'free_grant';
  elsif v_has_refund and not v_refund_backed_by_settlement then
    v_payment_stage := 'unknown';
  elsif v_has_refund and v_gross_sum >= v_order.effective_total_cents
     and v_net_sum = 0 and v_refund_sum >= v_order.effective_total_cents then
    v_payment_stage := 'refunded';
  elsif v_has_refund then
    v_payment_stage := 'partially_refunded';
  elsif v_cleared = v_order.installment_count
     and v_billing.billing_state in ('paid','cancel_requested','canceled')
     and v_state.billing_state in ('paid','cancel_requested','canceled') then
    v_payment_stage := 'settled';
  elsif v_cleared > 0
     and v_cleared < v_order.installment_count
     and (v_billing.billing_state in ('active','cancel_requested','canceled')
       or (v_billing.billing_state = 'paid' and v_has_refund)) then
    v_payment_stage := 'partially_settled';
  elsif v_billing.billing_state = 'paid'
     or v_state.billing_state = 'paid'
     or v_unledgered_paid_evidence
     or (v_attempt_found and v_attempt.attempt_state = 'paid')
     or (v_invoice_found and
       (v_current_invoice.provider_status = 'paid'
        or v_current_invoice.current_pay_outcome in ('unknown','requires_action','processing','succeeded')))
     or v_pending_payment then
    v_payment_stage := 'payment_pending';
  elsif v_pending_checkout then
    v_payment_stage := 'checkout_pending';
  elsif v_attempt_found and v_attempt.attempt_state = 'expired_unpaid'
     and v_attempt.create_outcome = 'created'
     and v_cleared = 0
     and v_cancellation_stage = 'none' then
    v_payment_stage := 'checkout_retryable';
    v_checkout_retry_hint := true;
  elsif v_attempt_found and v_attempt.attempt_state = 'open'
     and v_attempt.create_outcome = 'created' then
    v_payment_stage := 'checkout_open';
  elsif v_attempt_found and v_attempt.attempt_state = 'prepared' then
    v_payment_stage := 'checkout_pending';
  elsif v_cleared = 0
     and v_billing.billing_state in ('terms_saved','checkout_ready')
     and v_cancellation_stage = 'none' then
    v_payment_stage := 'checkout_required';
  elsif v_cleared = 0
     and v_cancellation_stage in ('requested','completed') then
    v_payment_stage := 'not_started';
  elsif v_cleared > 0
     and v_cleared < v_order.installment_count then
    v_payment_stage := 'partially_settled';
  else
    v_payment_stage := 'unknown';
  end if;

  -- A settled billing order, any durable cancellation request, or a completed
  -- cancellation has no future collection to advertise. Refunds after settlement
  -- do not reopen that schedule or resurrect its old due/retry dates.
  if v_billing_found and (
    v_billing.billing_state in ('paid','canceled')
    or v_billing.cancellation_request_id is not null
  ) then
    v_next_due_date := null;
    v_retry_deadline := null;
    v_checkout_retry_hint := false;
  end if;

  return jsonb_build_object(
    'order_id',v_order.id,
    'program_id',v_order.program_id,
    'program_label','Program',
    'created_at',v_order.created_at,
    'currency',v_order.currency,
    'list_price_cents',v_order.list_price_cents,
    'discount_cents',v_order.discount_cents,
    'effective_total_cents',v_order.effective_total_cents,
    'payment_plan',v_order.payment_plan,
    'installment_count',v_order.installment_count,
    'installment_amounts_cents',to_jsonb(v_order.installment_amounts_cents),
    'cleared_installments',v_cleared,
    'has_recorded_refund',v_has_refund,
    'payment_stage',v_payment_stage,
    'cancellation_stage',v_cancellation_stage,
    'safety_stage',v_safety_stage,
    'checkout_retry_hint',v_checkout_retry_hint,
    'next_due_date',v_next_due_date,
    'retry_deadline',v_retry_deadline
  );
end;
$$;
revoke all on function private.program_purchase_history_entry(uuid,uuid)
  from public, anon, authenticated, service_role;

create function public.get_my_program_purchase_history(
  p_limit integer,
  p_cursor_created_at timestamptz,
  p_cursor_order_id uuid,
  p_program_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_items jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_created_at timestamptz;
  v_next_order_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    return jsonb_build_object('status','auth_required');
  end if;
  if p_limit is null or p_limit not between 1 and 50
     or ((p_cursor_created_at is null) <> (p_cursor_order_id is null)) then
    return jsonb_build_object('status','invalid_request');
  end if;

  with page as materialized (
    select orders.id,orders.created_at,
      row_number() over (order by orders.created_at desc,orders.id desc) as row_number
    from public.program_orders orders
    where orders.buyer_id = v_buyer_id
      and (p_program_id is null or orders.program_id = p_program_id)
      and (p_cursor_created_at is null
        or (orders.created_at,orders.id) < (p_cursor_created_at,p_cursor_order_id))
    order by orders.created_at desc,orders.id desc
    limit p_limit + 1
  ), visible as materialized (
    select page.id,page.created_at,page.row_number
    from page
    where page.row_number <= p_limit
  )
  select coalesce(jsonb_agg(
           private.program_purchase_history_entry(visible.id,v_buyer_id)
           order by visible.created_at desc,visible.id desc),'[]'::jsonb),
         (select count(*) > p_limit from page),
         (select visible.created_at from visible
           order by visible.created_at asc,visible.id asc limit 1),
         (select visible.id from visible
           order by visible.created_at asc,visible.id asc limit 1)
  into v_items,v_has_more,v_next_created_at,v_next_order_id
  from visible;

  return jsonb_build_object(
    'status','ready',
    'items',v_items,
    'has_more',v_has_more,
    'next_cursor',case when v_has_more then
      jsonb_build_object('created_at',v_next_created_at,'order_id',v_next_order_id)
      else null end
  );
end;
$$;
revoke all on function public.get_my_program_purchase_history(integer,timestamptz,uuid,uuid)
  from public, anon, service_role;
grant execute on function public.get_my_program_purchase_history(integer,timestamptz,uuid,uuid)
  to authenticated;

create function public.get_my_program_purchase_history_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_buyer_id uuid := auth.uid();
  v_item jsonb;
begin
  if auth.role() is distinct from 'authenticated' or v_buyer_id is null then
    return jsonb_build_object('status','auth_required');
  end if;
  if p_order_id is null then
    return jsonb_build_object('status','invalid_request');
  end if;
  v_item := private.program_purchase_history_entry(p_order_id,v_buyer_id);
  if v_item is null then
    return jsonb_build_object('status','not_found');
  end if;
  return jsonb_build_object('status','ready','item',v_item);
end;
$$;
revoke all on function public.get_my_program_purchase_history_detail(uuid)
  from public, anon, service_role;
grant execute on function public.get_my_program_purchase_history_detail(uuid)
  to authenticated;
