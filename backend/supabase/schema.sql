-- Ejecuta en el SQL Editor del proyecto Supabase de Forja.
create table if not exists public.forja_vault (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.forja_vault enable row level security;
revoke all on public.forja_vault from anon;
grant select, insert, update, delete on public.forja_vault to authenticated;
drop policy if exists "forja_vault_read_own" on public.forja_vault;
drop policy if exists "forja_vault_insert_own" on public.forja_vault;
drop policy if exists "forja_vault_update_own" on public.forja_vault;
drop policy if exists "forja_vault_delete_own" on public.forja_vault;
create policy "forja_vault_read_own" on public.forja_vault for select to authenticated using ((select auth.uid()) = user_id);
create policy "forja_vault_insert_own" on public.forja_vault for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "forja_vault_update_own" on public.forja_vault for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "forja_vault_delete_own" on public.forja_vault for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  schedule jsonb not null default '{"time":"18:00","days":[1,3,5]}'::jsonb,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  last_sent date,
  updated_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
drop policy if exists "push_subscriptions_read_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_read_own" on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "push_subscriptions_insert_own" on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "push_subscriptions_update_own" on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);
