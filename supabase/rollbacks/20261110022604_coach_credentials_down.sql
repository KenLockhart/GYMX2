-- Empty the credential-docs bucket in the dashboard first.
delete from storage.buckets where id = 'credential-docs';
drop function if exists public.public_coach_credentials(uuid);
drop function if exists public.verify_credential(uuid, boolean, text, text);
drop function if exists public.request_credential_verification(uuid);
drop table if exists public.credential_events;
drop table if exists public.coach_credentials;
drop function if exists private.credential_changed();
drop function if exists private.credential_added();
