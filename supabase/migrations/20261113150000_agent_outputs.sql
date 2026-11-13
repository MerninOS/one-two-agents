-- Agent builder, slice 3 (docs/agent-builder.md): outputs as sources. Every run of an agent built
-- in the app saves one named output, which other agents can pick as a source (the agent_output
-- tool). The numbers in an output were copied by code from a tool result in the same run, never
-- typed by the model, so "numbers are computed in code" holds down a chain of agents.
create table agent_outputs (
  run_id uuid primary key references agent_runs (id) on delete cascade,
  agent_id text not null references agents (id),
  -- the output name from the spec, e.g. "green status"
  name text not null,
  -- the model's words; another agent reads them as untrusted data
  summary text not null,
  -- [{ label, value, tool, step, key }], every value copied from run_steps.numbers
  numbers jsonb not null default '[]',
  -- false when a limit stopped the run; readers take only finished outputs
  finished boolean not null default false,
  created_at timestamptz not null default now()
);
create index agent_outputs_latest on agent_outputs (agent_id, created_at desc);
alter table agent_outputs enable row level security;
