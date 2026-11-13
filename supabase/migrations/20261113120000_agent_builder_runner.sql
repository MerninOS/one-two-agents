-- Agent builder, slice 1 (docs/agent-builder.md): the runner's two tables and a scratch agent to
-- test it on. Nothing here runs on its own: the scratch agent is off duty and has no chain, and a
-- Preview (the only way to run it in this slice) needs DASHBOARD_CONTROLS=on.

-- An agent built in the app is a saved spec, versioned like agent_setup: one row per version,
-- one active per agent. The spec only picks from the tool list in code (core/tools), so it can
-- never grant an ability the code doesn't have.
create table agent_defs (
  agent_id text not null references agents (id),
  version integer not null,
  spec jsonb not null,
  note text,
  created_by text not null default 'zak',
  created_at timestamptz not null default now(),
  active boolean not null default false,
  primary key (agent_id, version)
);
create unique index agent_defs_one_active on agent_defs (agent_id) where active;
alter table agent_defs enable row level security;

-- Every step a runner run took: each model turn and each tool call, in order, so Replay can show
-- what the agent did and the playbook (slice 4) can be drafted from it.
create table run_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references agent_runs (id) on delete cascade,
  idx integer not null,
  kind text not null check (kind in ('model', 'tool', 'stop')),
  tool text,
  input jsonb,
  -- what came back, cut to a few thousand characters; tool data, never instructions
  output text,
  ok boolean not null default true,
  -- numbers a tool computed in code (outputs may only carry numbers from here, slice 3)
  numbers jsonb,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  ms integer not null default 0,
  at timestamptz not null default now(),
  unique (run_id, idx)
);
create index run_steps_run on run_steps (run_id, idx);
alter table run_steps enable row level security;

-- A scratch agent for trying the runner before the builder screen exists. Off duty, $1 a day.
insert into agents (id, name, model, schedule, enabled, daily_budget_usd)
values ('scratch', 'Scratch (runner test)', 'claude-haiku-5-5', null, false, 1.00)
on conflict (id) do nothing;

insert into agent_defs (agent_id, version, spec, note, active)
values ('scratch', 1, '{
  "name": "Green cover check",
  "mandate": "Checks green coffee cover and says which lots to reorder",
  "directive": "Check green cover for every listed lot. If a lot will drop under 21 days of cover, say which lot, about when it runs out, and how much to reorder to get back to 60 days of cover. If nothing is close, say so in one line.",
  "goodResult": "Three lines or fewer per lot, most urgent first. Every number comes from a tool.",
  "model": "claude-haiku-5-5",
  "effort": "low",
  "tools": ["shopify_green_lots", "calc_green_use", "calc_green_cover", "calc_reorder_amount", "kpi_snapshots"],
  "notionPages": [],
  "limits": { "maxSteps": 12, "maxCostUsd": 0.5 }
}'::jsonb, 'Scratch agent for testing the runner (slice 1)', true)
on conflict do nothing;
