-- OneNet Custom Auth (NO Supabase Auth users required)
-- Run in Supabase SQL Editor (public schema)

-- 1) Extensions
create extension if not exists pgcrypto;

-- 2) Tables
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  role text not null default 'viewer',
  perms jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text,
  device text
);

create table if not exists public.login_logs (
  id bigserial primary key,
  user_id uuid references public.app_users(id) on delete set null,
  token uuid,
  created_at timestamptz not null default now(),
  user_agent text,
  device text
);

-- 3) Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
before update on public.app_users
for each row execute function public.set_updated_at();

-- 4) Helper: check token -> user
create or replace function public._user_by_token(p_token uuid)
returns table(user_id uuid, username text, role text, perms jsonb, is_active boolean)
language sql stable as $$
  select u.id, u.username, u.role, u.perms, u.is_active
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token
$$;

-- 5) RPC: login
drop function if exists public.app_login(text, text, text, text);
create or replace function public.app_login(
  p_username text,
  p_password text,
  p_user_agent text default null,
  p_device text default null
)
returns table(
  token uuid,
  user_id uuid,
  username text,
  role text,
  perms jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.app_users%rowtype;
  t uuid;
begin
  select * into u
  from public.app_users
  where lower(username) = lower(p_username)
  limit 1;

  if not found then
    return;
  end if;

  if u.is_active is false then
    return;
  end if;

  -- verify password (bcrypt via pgcrypto crypt)
  if u.password_hash <> crypt(p_password, u.password_hash) then
    return;
  end if;

  insert into public.app_sessions(user_id, user_agent, device)
  values (u.id, p_user_agent, p_device)
  returning token into t;

  insert into public.login_logs(user_id, token, user_agent, device)
  values (u.id, t, p_user_agent, p_device);

  return query
  select t, u.id, u.username, u.role, u.perms;
end $$;

-- 6) RPC: me (validate session + update last_seen)
drop function if exists public.app_me(uuid);
create or replace function public.app_me(p_token uuid)
returns table(
  user_id uuid,
  username text,
  role text,
  perms jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.app_sessions
  set last_seen_at = now()
  where token = p_token;

  return query
  select u.id, u.username, u.role, u.perms
  from public.app_sessions s
  join public.app_users u on u.id = s.user_id
  where s.token = p_token
    and u.is_active is true
  limit 1;
end $$;

-- 7) RPC: logout
drop function if exists public.app_logout(uuid);
create or replace function public.app_logout(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.app_sessions where token = p_token;
$$;

-- 8) Admin-only: list users
drop function if exists public.app_users_list(uuid);
create or replace function public.app_users_list(p_token uuid)
returns table(
  id uuid,
  username text,
  role text,
  perms jsonb,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me record;
begin
  select * into me from public._user_by_token(p_token) limit 1;
  if not found then return; end if;
  if me.role <> 'admin' and me.role <> 'super_admin' then return; end if;

  return query
  select u.id, u.username, u.role, u.perms, u.is_active, u.created_at, u.updated_at
  from public.app_users u
  order by u.created_at asc;
end $$;

-- 9) Admin-only: upsert user
drop function if exists public.app_users_upsert(uuid, uuid, text, text, jsonb, boolean, text);
create or replace function public.app_users_upsert(
  p_token uuid,
  p_user_id uuid,
  p_username text,
  p_role text,
  p_perms jsonb,
  p_is_active boolean,
  p_password text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me record;
  uid uuid;
begin
  select * into me from public._user_by_token(p_token) limit 1;
  if not found then raise exception 'not logged in'; end if;
  if me.role <> 'admin' and me.role <> 'super_admin' then raise exception 'not allowed'; end if;

  if p_user_id is null then
    insert into public.app_users(username, password_hash, role, perms, is_active)
    values (
      lower(p_username),
      crypt(coalesce(p_password,'1234'), gen_salt('bf')),
      coalesce(p_role,'viewer'),
      coalesce(p_perms,'{}'::jsonb),
      coalesce(p_is_active,true)
    )
    returning id into uid;
    return uid;
  else
    update public.app_users
    set
      username = lower(p_username),
      role = coalesce(p_role, role),
      perms = coalesce(p_perms, perms),
      is_active = coalesce(p_is_active, is_active),
      password_hash = case when p_password is null or p_password = '' then password_hash
                           else crypt(p_password, gen_salt('bf')) end
    where id = p_user_id;
    return p_user_id;
  end if;
end $$;

-- 10) Admin-only: delete user
drop function if exists public.app_users_delete(uuid, uuid);
create or replace function public.app_users_delete(
  p_token uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me record;
begin
  select * into me from public._user_by_token(p_token) limit 1;
  if not found then return; end if;
  if me.role <> 'admin' and me.role <> 'super_admin' then return; end if;

  delete from public.app_users where id = p_user_id;
end $$;

-- 11) Bootstrap admin (run once)
-- IMPORTANT: change the password after first login
insert into public.app_users(username, password_hash, role, perms, is_active)
values (
  'admin',
  crypt('admin123', gen_salt('bf')),
  'admin',
  jsonb_build_object(
    'inventory_view', true,
    'customers_view', true,
    'invoices_view', true,
    'payments_view', true,
    'expenses_view', true,
    'reports_view', true,
    'settings_view', true
  ),
  true
)
on conflict (username) do nothing;

-- 12) Security: do NOT expose tables directly
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.login_logs enable row level security;

-- No direct policies (functions handle access). This keeps tables private.
-- If you already created policies, you can remove them.
export async function loginWithUsername(username, password, remember) {
  // ... الكود اللي يتحقق من جدول app_users
}
