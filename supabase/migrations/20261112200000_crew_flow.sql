-- Crew flow: which agents run when, and which agent starts after another (chains).
-- Spec: docs/agent-setup.md (slice 5). Built in core/flow.ts and core/chain.ts.
--
-- A flow only picks from the palette in code (triggers, agents, checks computed in code).
-- It can't give an agent an ability, and every run it starts still goes through withRun, so
-- an agent that is off duty or over budget is skipped and the chain stops there. Saving or
-- turning on a chain never turns an agent on.

create table crew_flow (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique check (version >= 1),
  flow jsonb not null default '{"chains": []}'::jsonb,
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  active boolean not null default false
);
-- at most one active version
create unique index crew_flow_active on crew_flow ((true)) where active;
alter table crew_flow enable row level security;

-- Which chain a run belongs to. chain_id is one id per chain run (every step shares it).
alter table agent_runs add column chain_id uuid;
alter table agent_runs add column chain_key text;
alter table agent_runs add column chain_step integer;
alter table agent_runs add column parent_run_id uuid;
-- Numbers a run reports, computed in code (new leads, changes proposed), for chain checks and hand-offs.
alter table agent_runs add column metrics jsonb;
create index agent_runs_chain on agent_runs (chain_id) where chain_id is not null;

-- One row per scheduled firing, so the dispatcher never starts the same firing twice
-- (two overlapping calls, a retry). The primary key does the work.
create table chain_fires (
  chain_key text not null,
  fire_at timestamptz not null,
  chain_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (chain_key, fire_at)
);
alter table chain_fires enable row level security;

-- A step that has to wait ("not before 6:45"): the dispatcher starts it once it is due.
create table chain_waits (
  id uuid primary key default gen_random_uuid(),
  chain_id uuid not null,
  chain_key text not null,
  step integer not null,
  parent_run_id uuid,
  manual boolean not null default false,       -- started with the Run chain button: goes ahead even if the chain is off
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  unique (chain_id, step)
);
create index chain_waits_due on chain_waits (due_at) where started_at is null;
alter table chain_waits enable row level security;

-- Version 1: the two schedules that were in vercel.json, as one chain, OFF.
-- Morgan at 5:30 every day; then Avery on weekdays, not before 6:45, whether Morgan worked or not.
insert into crew_flow (version, flow, note, created_by, active) values (1,
  '{"chains": [{"key": "morning", "name": "Morning", "on": false,
     "start": {"type": "schedule", "days": "daily", "time": "05:30"},
     "steps": [
       {"agent": "cfo"},
       {"agent": "chief_of_staff", "when": "any", "days": "weekdays", "notBefore": "06:45", "passAlong": true}
     ]}]}'::jsonb,
  'The cfo and chief-of-staff schedules from vercel.json, as one chain. Off until launch.', 'migration', true)
  on conflict (version) do nothing;
