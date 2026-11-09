-- Admin wording for GYMX2's automatic emails. One row per email that admins changed.
-- Only the server reads and writes it (admins edit through server actions that check their role).
create table public.email_copy (
  key text primary key check (key ~ '^[a-z]+\.[a-z]+$'),
  subject text not null default '' check (char_length(subject) <= 150),
  heading text not null default '' check (char_length(heading) <= 150),
  intro text not null default '' check (char_length(intro) <= 2000),
  button_label text not null default '' check (char_length(button_label) <= 60),
  note text not null default '' check (char_length(note) <= 2000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

alter table public.email_copy enable row level security;
revoke all on public.email_copy from public, anon, authenticated;
grant select, insert, update, delete on public.email_copy to service_role;
