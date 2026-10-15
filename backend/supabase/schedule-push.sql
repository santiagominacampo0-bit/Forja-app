-- Ejecuta después de activar pg_cron, pg_net y Vault en Supabase.
-- Sustituye los valores de ejemplo por tu URL del proyecto y un secreto largo al azar.
select vault.create_secret('https://TU-PROYECTO.supabase.co', 'forja_project_url');
select vault.create_secret('TU-CLAVE-PUBLICA-SUPABASE', 'forja_publishable_key');
select vault.create_secret('CAMBIA-ESTE-SECRETO-LARGO-ALEATORIO', 'forja_cron_secret');

select cron.schedule(
  'forja-push-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'forja_project_url') || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'forja_publishable_key'),
      'x-forja-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'forja_cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
