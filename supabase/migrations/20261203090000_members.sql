-- Tenancy slice 2 (docs/tenancy.md): people sign in as themselves and belong to an org as members.
-- A member's role decides what they can do; the app checks it on the server for every page and action.

create table members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  -- the Supabase Auth user, set when the member first signs in
  user_id uuid,
  role text not null check (role in ('owner', 'approver', 'viewer')),
  added_by text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz,
  unique (org_id, email),
  unique (org_id, user_id)
);
alter table members enable row level security;
create index members_org_id_idx on members (org_id);
