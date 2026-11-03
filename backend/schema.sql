-- Oddaroa backend schema (Postgres 15+, works on Neon and Supabase)
-- Roles mirror PrimeStake: user / admin / super_admin. The ONLY way to
-- become admin or super_admin is a one-time invite link a super admin
-- creates, or a super admin promoting an existing user.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  password_hash text not null,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin', 'super_admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  vip_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists tips (
  id uuid primary key default gen_random_uuid(),
  match text not null,
  league text,
  market text not null,
  pick text not null,
  odd numeric(6, 2) not null check (odd > 1),
  tier text not null default 'free' check (tier in ('free', 'vip')),
  result text not null default 'pending' check (result in ('pending', 'won', 'lost', 'void')),
  play_date date not null default current_date,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists tips_date_idx on tips (play_date desc, created_at desc);

-- One-time invite links (PrimeStake model): the raw token is shown once
-- when created; only its SHA-256 hash is stored. 48h expiry by default.
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text unique not null,
  role text not null check (role in ('admin', 'super_admin')),
  created_by uuid references users(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists operator_settings (
  key text primary key,
  value text not null
);
insert into operator_settings (key, value) values
  ('vip_price_weekly', '50'),
  ('vip_price_monthly', '150'),
  ('vip_whatsapp', '233539037677'),
  ('tips_enabled', 'true'),
  ('vip_enabled', 'true'),
  ('site_notice', '')
on conflict (key) do nothing;

-- ShinobiPay VIP payments. One attempt row per purchase try; settlement
-- happens only in the webhook handler after signature verification and
-- a re-check against ShinobiPay. plan/plan_days say what was bought.
create table if not exists payment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id),
  provider text not null default 'shinobipay',
  reference text not null unique,
  intent_id text,
  client_secret text,
  amount_ghs numeric(12, 2) not null,
  amount_minor integer not null,
  phone text,
  network text,
  plan text,
  plan_days integer,
  status text not null default 'created',
  fail_reason text,
  last_sequence integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- Webhook idempotency: ShinobiPay delivery is at-least-once, so every
-- event id is recorded and repeats are no-ops.
create table if not exists webhook_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
