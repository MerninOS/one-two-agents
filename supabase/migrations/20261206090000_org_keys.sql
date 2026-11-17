-- Tenancy slice 4 (docs/tenancy.md): each org's own vault key. A sign-in is sealed with its org's
-- data key (core/vault.ts), and the data key is kept here only wrapped, by a wrapping key that never
-- lives in the database (MCP_SECRET_KEY, or a cloud KMS key later). Deleting an org's row makes all
-- of its sign-ins unreadable.

create table org_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  -- the data key's short id, as named in each value it seals; says nothing about the key
  key_id text not null check (length(key_id) between 4 and 40),
  -- the data key, wrapped; never the key itself
  wrapped text not null check (wrapped like 'v3.%' and length(wrapped) <= 1000),
  -- which wrapping key wrapped it, e.g. env:<id>
  wrap_key_id text not null check (length(wrap_key_id) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one data key per org
  unique (org_id)
);
alter table org_keys enable row level security;

create policy org_rows on org_keys for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
