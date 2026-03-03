-- Ledger cloud persistence setup
-- Run this in Supabase SQL Editor for project: yeiwludpviidmlfxeuid

create table if not exists public.ledger_states (
  username text primary key,
  state_json jsonb not null,
  updated_at timestamptz not null default now()
);

-- If you are not using Supabase Auth in this app, you need anon access.
-- This is appropriate only for personal/single-user usage.
alter table public.ledger_states disable row level security;

grant select, insert, update on table public.ledger_states to anon;
grant select, insert, update on table public.ledger_states to authenticated;
grant select, insert, update on table public.ledger_states to service_role;
