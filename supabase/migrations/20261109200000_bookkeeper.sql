-- Bookkeeper (Quinn): evidence for every business charge, mileage, home office and
-- the yearly tax packet. Mercury stays read-only here: a proposed receipt, category
-- or memo is stored on the row (proposal_*) and is only applied to Mercury once the
-- tool gateway exists and Zak approves it. Ships switched off (agents.enabled = false).

create table expense_docs (
  id uuid primary key default gen_random_uuid(),
  mercury_txn_id text unique,                -- the charge, from Mercury (business org)
  qbo_expense_id text,                       -- once One Two has a QuickBooks company
  account_id text,
  date date not null,                        -- posted date, America/Chicago
  merchant text not null,                    -- Mercury counterparty name
  amount_usd numeric(12, 2) not null,        -- positive: money out
  mercury_kind text,
  mercury_category text,                     -- Mercury's merchant type, for context only
  category_id text,                          -- category set in Mercury (by Zak or Mercury rules)
  category text,
  business_purpose text,                     -- Zak's words; never written by a model
  status text not null default 'open'
    check (status in ('open', 'matched', 'needs_photo', 'bank_record_only', 'personal', 'not_needed')),
  status_note text,
  receipt_path text,                         -- object in the private "receipts" bucket
  source text,                               -- mercury | gmail | photo | manual
  gmail_message_id text,
  receipt_json jsonb,                        -- what was read off the receipt: merchant, total, date
  matched_at timestamptz,
  photo_asked_at timestamptz,
  search_count smallint not null default 0,  -- Gmail searches so far; stops after 3
  last_searched_at timestamptz,
  -- Proposed Mercury writes (Draft tier). Nothing here is applied until the gateway exists.
  proposal_category_id text,
  proposal_category text,
  proposal_memo text,
  proposal_attach boolean not null default false,
  proposal_status text check (proposal_status in ('proposed', 'approved', 'rejected', 'applied')),
  run_id uuid references agent_runs (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expense_docs_status on expense_docs (status, date desc);
create index expense_docs_date on expense_docs (date desc);

create table trips (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  from_place text not null,
  to_place text not null,
  miles numeric(8, 1) not null check (miles > 0),
  purpose text not null,
  source text not null default 'manual',     -- manual | quickbooks | app_export | notion
  linked_txn_id text,
  created_at timestamptz not null default now()
);
create index trips_date on trips (date desc);

create table home_office (
  tax_year smallint primary key,
  office_sqft numeric(8, 1),
  home_sqft numeric(8, 1),
  own_or_rent text check (own_or_rent in ('own', 'rent')),
  costs_json jsonb not null default '{}'::jsonb, -- yearly rent or mortgage interest, utilities, insurance, repairs
  simplified_usd numeric(12, 2),             -- computed in code
  actual_usd numeric(12, 2),                 -- computed in code
  updated_at timestamptz not null default now()
);

create table tax_packets (
  tax_year smallint primary key,
  built_at timestamptz,
  receipt_coverage_pct numeric(5, 2),
  total_miles numeric(10, 1),
  mileage_usd numeric(12, 2),
  files_json jsonb not null default '[]'::jsonb
);

alter table expense_docs enable row level security;
alter table trips enable row level security;
alter table home_office enable row level security;
alter table tax_packets enable row level security;

-- Receipt files, private, kept seven years. Only the service role reads or writes them.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

insert into agents (id, name, model, schedule, enabled, daily_budget_usd) values
  ('bookkeeper', 'Bookkeeper', 'claude-haiku-5-5', 'manual until launch (planned daily 6:00 AM CT)', false, 1);

insert into policies (key, value_json) values
  ('receipt_match_window_days', '3'),
  ('receipt_photo_min_usd', '75'),
  ('receipt_mixed_merchants', '["costco", "walmart", "target", "amazon", "h-e-b", "heb", "sam''s club", "sams club"]'),
  ('bank_record_after_days', '30'),
  ('irs_mileage_rate', '{"2025": 0.70}')
  on conflict (key) do nothing;
