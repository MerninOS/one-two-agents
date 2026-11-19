-- The paid layer's tables (ee/, docs/extensions.md), after the starting migration. An open-edition
-- install has them empty and never reads them; the cloud edition keeps billing state and sign-up
-- codes here. Same rules as every table: org_id, row level security and the org_rows policy.

-- One row per business on the hosted edition, kept by sign-up and Stripe's webhook. "comped" is set
-- by us for a business that is never billed; the webhook never writes over it (card 135).
create table ee_subscriptions (
  org_id uuid not null references orgs(id) primary key,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'comped')),
  trial_ends_at timestamptz,
  past_due_since timestamptz,
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,64}$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{6,64}$'),
  seats integer not null default 1 check (seats between 1 and 1000),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table ee_subscriptions enable row level security;
create policy org_rows on ee_subscriptions for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

-- Sign-up codes: sign-up is invite-only, one code makes one business. The codes belong to the admin
-- business (OPERATOR_ADMIN_ORG_ID, ee/admin.ts). Only a hash is kept; a used or ended code stays as a
-- record, never deleted.
create table ee_signup_codes (
  org_id uuid not null references orgs(id),
  id uuid not null default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  note text not null default '' check (length(note) <= 120),
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_org_id uuid references orgs(id),
  primary key (org_id, id)
);
alter table ee_signup_codes enable row level security;
create policy org_rows on ee_signup_codes for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
