-- Spending caps, email cap, undo window, the vendors list and suppressed addresses.
-- Build Board: "Gateway: spending caps, email cap and vendors list" and "Customizable agents 6:
-- Guardrails box and caps". The checks are in core/gateway/policy.ts (checkPurchase, checkEmail)
-- with a limit in code for each cap (CAPS), so no row here can go past what code allows.
-- Nothing new can send, pay or post: no payment or email action type exists yet. These are
-- the fences those action types will have to pass.

-- Zak's starting values (Nov 11). Changed only from the Control Room (signed in), never by an agent.
insert into policies (key, value_json) values
  ('max_purchase_usd', '500'),
  ('max_monthly_spend_usd', '1500'),
  ('max_emails_per_day', '20'),
  ('undo_window_minutes', '30')
  on conflict (key) do nothing;

-- Approved payees. Only Zak adds rows (Control Room, DASHBOARD_CONTROLS=on); no agent code
-- path inserts here. A payment's payee must be a row here, and a first payment to a vendor is
-- always an approval.
create table vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null default 'other' check (kind in ('importer', 'packaging', 'other')),
  mercury_recipient_id text unique,
  contact_email text,
  added_by text not null,
  added_at timestamptz not null default now()
);
alter table vendors enable row level security;

-- People who asked not to be emailed (unsubscribe, "stop" reply, or added by Zak). checkEmail
-- refuses every message to an address here.
create table email_suppressions (
  email text primary key check (email = lower(email)),
  reason text,
  source text not null default 'zak',
  created_at timestamptz not null default now()
);
alter table email_suppressions enable row level security;

-- Every change to a cap from the Control Room: who, when, from what to what.
create table policy_log (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_by text not null,
  created_at timestamptz not null default now()
);
alter table policy_log enable row level security;
