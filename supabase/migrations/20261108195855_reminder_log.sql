-- Reminder emails sent, so a retried or repeated scheduled run never sends the same one twice.
create table public.reminder_log (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('session', 'task', 'streak', 'weekly')),
  ref text not null check (char_length(ref) <= 40),
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.reminder_log enable row level security;
-- No policies: only the server reads and writes it.
revoke all on public.reminder_log from public, anon, authenticated;
grant select, insert, delete on public.reminder_log to service_role;
