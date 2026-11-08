-- Phone and browser push notifications. One row per device a person turned notifications on for.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  device text not null default '' check (char_length(device) <= 120),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "People see their own devices"
on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "People add their own devices"
on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "People remove their own devices"
on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, delete on public.push_subscriptions to service_role;

-- "Day N is ready" pushes for programs are logged so each goes out once.
alter table public.reminder_log drop constraint reminder_log_kind_check;
alter table public.reminder_log add constraint reminder_log_kind_check
  check (kind in ('session', 'task', 'streak', 'weekly', 'program'));
