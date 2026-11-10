-- Coach Discovery PR 3: coach credentials with private documents and admin-only verification.
--
-- Coaches add and remove their own credentials and can ask for verification once a document is
-- attached. Only admins can mark one verified or rejected. Changing a verified credential sends it
-- back to unverified. Members never read this table directly: public_coach_credentials returns the
-- safe fields (no ID numbers, documents or notes), and an expired credential never shows as verified.

create table public.coach_credentials (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('certification', 'cpr_aed', 'education', 'license', 'insurance', 'continuing_ed')),
  organization text not null check (char_length(organization) between 1 and 100),
  title text not null check (char_length(title) between 1 and 120),
  credential_number text not null default '' check (char_length(credential_number) <= 80),
  issued_on date,
  expires_on date,
  document_path text check (document_path is null or char_length(document_path) <= 200),
  status text not null default 'unverified' check (status in ('unverified', 'pending', 'verified', 'rejected')),
  verification_source text not null default '' check (char_length(verification_source) <= 200),
  admin_note text not null default '' check (char_length(admin_note) <= 500),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index coach_credentials_coach_idx on public.coach_credentials (coach_id);
create index coach_credentials_pending_idx on public.coach_credentials (created_at) where status = 'pending';

-- Who did what to each credential, for admins.
create table public.credential_events (
  id bigint generated always as identity primary key,
  credential_id uuid not null references public.coach_credentials (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in ('added', 'requested', 'verified', 'rejected', 'changed')),
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index credential_events_credential_idx on public.credential_events (credential_id, created_at);

alter table public.coach_credentials enable row level security;
alter table public.credential_events enable row level security;

-- Start from no access: Supabase grants new tables to anon and authenticated by default.
revoke all on public.coach_credentials, public.credential_events from anon, authenticated;

create policy "Coaches and admins read credentials"
on public.coach_credentials for select to authenticated
using (coach_id = (select auth.uid()) or (select private.is_admin()));

create policy "Coaches add their own credentials"
on public.coach_credentials for insert to authenticated
with check (coach_id = (select auth.uid()) and (select private.is_coach()) and status = 'unverified');

create policy "Coaches change their own credentials"
on public.coach_credentials for update to authenticated
using (coach_id = (select auth.uid()))
with check (coach_id = (select auth.uid()));

create policy "Coaches remove their own credentials"
on public.coach_credentials for delete to authenticated
using (coach_id = (select auth.uid()));

create policy "Admins read credential history"
on public.credential_events for select to authenticated
using ((select private.is_admin()));

grant select, delete on public.coach_credentials to authenticated;
grant insert (coach_id, kind, organization, title, credential_number, issued_on, expires_on, document_path)
  on public.coach_credentials to authenticated;
grant update (kind, organization, title, credential_number, issued_on, expires_on, document_path)
  on public.coach_credentials to authenticated;
grant select on public.credential_events to authenticated;
grant all on public.coach_credentials, public.credential_events to service_role;

-- A coach changing a credential's details (or document) means it must be checked again.
create function private.credential_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind, new.organization, new.title, new.credential_number, new.issued_on, new.expires_on, new.document_path)
     is distinct from
     (old.kind, old.organization, old.title, old.credential_number, old.issued_on, old.expires_on, old.document_path)
  then
    if old.status in ('pending', 'verified', 'rejected') then
      new.status := 'unverified';
      new.verified_by := null;
      new.verified_at := null;
      new.verification_source := '';
    end if;
    insert into public.credential_events (credential_id, actor_id, action)
    values (new.id, (select auth.uid()), 'changed');
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger credential_changed before update on public.coach_credentials
for each row execute function private.credential_changed();

create function private.credential_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.credential_events (credential_id, actor_id, action)
  values (new.id, (select auth.uid()), 'added');
  return new;
end;
$$;
create trigger credential_added after insert on public.coach_credentials
for each row execute function private.credential_added();
revoke all on function private.credential_changed(), private.credential_added() from public, anon, authenticated;

-- The coach asks GYMX2 to verify a credential. It needs a document to check.
create function public.request_credential_verification(target_credential_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.coach_credentials
  set status = 'pending', admin_note = ''
  where id = target_credential_id
    and coach_id = (select auth.uid())
    and status in ('unverified', 'rejected')
    and document_path is not null;
  if not found then
    raise exception 'Add a certificate document first' using errcode = 'P0001';
  end if;
  insert into public.credential_events (credential_id, actor_id, action)
  values (target_credential_id, (select auth.uid()), 'requested');
end;
$$;

-- Admins record the outcome and where they checked it.
create function public.verify_credential(target_credential_id uuid, approve boolean, source text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only admins verify credentials' using errcode = '42501';
  end if;
  if approve and char_length(trim(coalesce(source, ''))) = 0 then
    raise exception 'Say where you checked it' using errcode = 'P0001';
  end if;
  update public.coach_credentials
  set status = case when approve then 'verified' else 'rejected' end,
      verification_source = case when approve then left(trim(source), 200) else '' end,
      admin_note = left(coalesce(note, ''), 500),
      verified_by = case when approve then (select auth.uid()) else null end,
      verified_at = case when approve then now() else null end
  where id = target_credential_id and status = 'pending';
  if not found then
    raise exception 'This credential isn''t waiting for verification' using errcode = 'P0001';
  end if;
  insert into public.credential_events (credential_id, actor_id, action, note)
  values (target_credential_id, (select auth.uid()),
          case when approve then 'verified' else 'rejected' end,
          left(coalesce(case when approve then source else note end, ''), 500));
end;
$$;

-- What members see: no ID numbers, documents or notes; rejected ones hidden; expired never verified.
create function public.public_coach_credentials(target_coach_id uuid)
returns table (kind text, organization text, title text, display_status text, expires_on date, verified_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.kind, c.organization, c.title,
         case
           when c.expires_on is not null and c.expires_on < current_date then 'expired'
           when c.status = 'verified' then 'verified'
           when c.status = 'pending' then 'pending'
           else 'unverified'
         end,
         c.expires_on,
         case when c.status = 'verified' then c.verified_at end
  from public.coach_credentials c
  where c.coach_id = target_coach_id and c.status <> 'rejected'
  order by (c.status = 'verified') desc, c.kind, c.created_at;
$$;

revoke all on function public.request_credential_verification(uuid), public.verify_credential(uuid, boolean, text, text),
  public.public_coach_credentials(uuid) from public, anon;
grant execute on function public.request_credential_verification(uuid), public.verify_credential(uuid, boolean, text, text),
  public.public_coach_credentials(uuid) to authenticated;

-- Certificate documents: private to the coach (through the server) and admins.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('credential-docs', 'credential-docs', false, 10485760,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);
