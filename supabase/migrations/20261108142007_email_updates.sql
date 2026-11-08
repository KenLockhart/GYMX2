-- Lets people turn off optional emails (new messages and session invites or changes).
-- Order emails, such as "your order shipped", are always sent.
alter table public.profiles add column email_updates boolean not null default true;

grant update (email_updates) on public.profiles to authenticated;
