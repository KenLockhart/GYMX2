-- When a buyer deletes their account, their orders stay for tax and accounting records,
-- with no link to the deleted person. Everything else about them is removed with the account.
alter table public.purchases alter column member_id drop not null;
alter table public.purchases drop constraint purchases_member_id_fkey;
alter table public.purchases
  add constraint purchases_member_id_fkey
  foreign key (member_id) references public.profiles (id) on delete set null;
