-- Agent setup: the choices Zak makes for each agent in the Control Room (model, tuning
-- numbers, instructions; later reads, outputs and triggers). Spec: docs/agent-setup.md.
--
-- A setup only picks from the agent's menu, which lives in code (agents/<id>/menu.ts).
-- It can never add an integration, a fact source, an output or a gateway action type, and
-- nothing that decides what an agent may do (the gateway, policies, caps) reads this table.
-- Every change is a new version; one version per agent is active. Old versions are kept so
-- any change can be rolled back.

create table agent_setup (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents (id),
  version integer not null check (version >= 1),
  setup jsonb not null default '{}'::jsonb,    -- only the values that differ from the menu's defaults need to be here
  note text,                                   -- why this version exists, in Zak's words
  created_by text not null,                    -- "zak (control room)", "migration"
  created_at timestamptz not null default now(),
  active boolean not null default false,
  unique (agent_id, version)
);
-- at most one active version per agent
create unique index agent_setup_active on agent_setup (agent_id) where active;

alter table agent_setup enable row level security;

-- Which setup version each run used; null = the menu's built-in defaults.
alter table agent_runs add column setup_version integer;

-- Version 1 for Avery: today's values, written down so the run log can point at them.
-- Instructions are left out on purpose: they stay the built-in text in agents/chief-of-staff/prompt.ts.
insert into agent_setup (agent_id, version, setup, note, created_by, active) values
  ('chief_of_staff', 1,
   '{"thinking": {"model": "claude-sonnet-5-5", "effort": "medium"}, "numbers": {"cover_warn_days": 21}}'::jsonb,
   'The values Avery ran with before setups existed.', 'migration', true)
  on conflict (agent_id, version) do nothing;
