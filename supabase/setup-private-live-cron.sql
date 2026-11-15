-- Operator-run setup after approval. Do not add this file to migrations or run it as part of tests.
-- It uses a short-lived HMAC signature so pg_net never queues the raw cleanup secret.
begin;

do $$
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'gymx2_live_cleanup_secret'
      and nullif(decrypted_secret, '') is not null
  ) then
    raise exception 'Vault secret gymx2_live_cleanup_secret must exist before cron setup';
  end if;
end;
$$;

create schema if not exists extensions;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
declare
  crypto_schema text;
  cleanup_command text;
  existing_job record;
begin
  select n.nspname into crypto_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if crypto_schema is null then
    raise exception 'pgcrypto must be installed for cleanup request signing';
  end if;

  cleanup_command := format($job$
    with signing as (
      select extract(epoch from clock_timestamp())::bigint::text as request_timestamp,
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'gymx2_live_cleanup_secret') as signing_secret
    )
    select net.http_get(
      url := 'https://gymx2.com/api/cron/live-cleanup',
      headers := jsonb_build_object(
        'x-gymx2-cleanup-timestamp', request_timestamp,
        'x-gymx2-cleanup-signature', encode(
          %I.hmac(
            convert_to(request_timestamp || '.GET./api/cron/live-cleanup', 'UTF8'),
            convert_to(signing_secret, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
      ),
      timeout_milliseconds := 10000
    )
    from signing
    where nullif(signing_secret, '') is not null;
  $job$, crypto_schema);

  for existing_job in
    select jobid, username
    from cron.job
    where jobname = 'gymx2-private-live-cleanup'
  loop
    if existing_job.username <> current_user then
      raise exception 'Cron job name gymx2-private-live-cleanup is owned by another role';
    end if;
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'gymx2-private-live-cleanup',
    '* * * * *',
    cleanup_command
  );
end;
$$;

commit;
