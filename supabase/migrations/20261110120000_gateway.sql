-- Tool gateway, first slice: every write an agent wants to make outside its own tables is
-- an agent_actions row, and every Draft-tier action waits in approvals until Zak decides.
-- The only write tool so far is "mercury.annotate_transaction" (receipt, category, memo on
-- an existing Mercury transaction), used by the Bookkeeper. The allow-list lives in code
-- (core/gateway/policy.ts); these tables are the record.

create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents (id),
  run_id uuid references agent_runs (id),    -- the run that proposed it
  tool text not null,                        -- "mercury.annotate_transaction"
  action_type text not null,                 -- what the approval is for, e.g. "receipt+category+memo"
  target text not null,                      -- the Mercury transaction id
  args_json jsonb not null,                  -- only allow-listed fields: attach, receipt_path, category_id, category, note
  diff_json jsonb,                           -- before and after, written at execution
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'executing', 'applied', 'partial', 'failed', 'rejected', 'expired', 'refused')),
  reason text,                               -- why it was refused, skipped or failed
  undo_json jsonb,                           -- the values it replaced, so a change can be put back
  result_json jsonb,
  exec_run_id uuid references agent_runs (id), -- the run that applied it
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  claimed_at timestamptz,                    -- when an apply started on it
  executed_at timestamptz
);
create index agent_actions_status on agent_actions (status, created_at desc);
create index agent_actions_target on agent_actions (target, created_at desc);
-- one open action per transaction and tool
create unique index agent_actions_one_open on agent_actions (tool, target)
  where status in ('proposed', 'approved', 'executing');

create table approvals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references agent_actions (id),
  agent_id text not null references agents (id),
  title text not null,
  reasoning text,
  preview jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'edited', 'rejected', 'expired')),
  reject_reason text,
  decided_at timestamptz,
  decided_by text,                           -- "zak (control room)"
  edit_diff jsonb,
  notion_page_id text,
  created_at timestamptz not null default now()
);
create index approvals_status on approvals (status, created_at desc);

alter table expense_docs add column proposal_action_id uuid references agent_actions (id);

alter table agent_actions enable row level security;
alter table approvals enable row level security;

insert into policies (key, value_json) values
  ('approval_expiry_hours', '72'),
  ('max_mercury_writes_per_run', '20'),
  ('mercury_memo_max_chars', '200')
  on conflict (key) do nothing;
