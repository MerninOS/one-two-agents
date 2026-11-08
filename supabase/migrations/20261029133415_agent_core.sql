-- Agent system, week 1: the registry, run log, daily numbers and policies.
-- Green lots are not copied here: they already live in Shopify (products tagged
-- blended-green, stock in grams) and agents read them through lib/catalog.ts.
-- Only the worker touches these tables, with the service role; RLS is on with
-- no policies so the anon and authenticated roles see nothing.

create table agents (
  id text primary key,                       -- "cfo", "chief_of_staff"
  name text not null,
  model text not null,
  schedule text,                             -- human-readable; the cron lives in vercel.json
  enabled boolean not null default true,
  daily_budget_usd numeric(8, 2) not null default 3
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents (id),
  trigger text not null,                     -- "cron" | "manual"
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed', 'skipped')),
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  summary text,
  error text
);
create index agent_runs_agent_started on agent_runs (agent_id, started_at desc);

-- One row per business day (America/Chicago), written by the CFO snapshot.
create table kpi_snapshots (
  date date primary key,
  revenue numeric(12, 2) not null,           -- order totals, cancelled orders excluded
  goods numeric(12, 2) not null,             -- order subtotals: line items after discounts, before shipping and tax
  orders integer not null,
  aov numeric(10, 2),
  repeat_rate numeric(5, 4),                 -- share of orders from customers with an earlier order
  green_cost numeric(12, 2),                 -- green coffee those orders used, at lot cost
  green_margin numeric(5, 4),                -- (goods - green_cost) / goods; bags, labour and shipping not included
  cash_usd numeric(14, 2),                   -- Mercury available balance across accounts; null when not connected
  detail jsonb not null default '{}'::jsonb, -- per-channel split, unlinked lines, sources that failed
  created_at timestamptz not null default now()
);

create table policies (
  key text primary key,
  value_json jsonb not null,
  updated_at timestamptz not null default now()
);

alter table agents enable row level security;
alter table agent_runs enable row level security;
alter table kpi_snapshots enable row level security;
alter table policies enable row level security;

insert into agents (id, name, model, schedule, daily_budget_usd) values
  ('cfo', 'CFO', 'none (daily snapshot is plain code)', 'daily 5:30 AM CT', 1),
  ('chief_of_staff', 'Chief of Staff', 'claude-sonnet-5-5', 'weekdays 6:45 AM CT', 3);

-- Starting values from the tech spec; Zak still owes the per-bag price floors.
insert into policies (key, value_json) values
  ('max_discount_pct', '10'),
  ('max_refund_usd', '0'),
  ('max_writes_per_run', '20'),
  ('price_floor', '{}');
