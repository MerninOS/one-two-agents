-- Agent builder, slice 4 (docs/agent-builder.md): playbooks. Code drafts a playbook from the tool
-- calls of an explore run; Zak approves an agent's first one; later runs follow it (code makes the
-- calls, the model writes the result) and fall back to exploring when a step fails.
create table agent_playbooks (
  id bigint generated always as identity primary key,
  agent_id text not null references agents (id),
  version integer not null,
  -- [{ tool, input }], tools from the tool list; checked against the spec and inputs again every run
  steps jsonb not null,
  status text not null check (status in ('proposed', 'approved', 'rejected', 'replaced')),
  -- the explore run it was drafted from
  from_run uuid references agent_runs (id) on delete set null,
  -- what changed from the playbook before, in plain words
  changes text,
  -- true when it applied on its own (after the first approval, with no hold)
  auto boolean not null default false,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  unique (agent_id, version)
);
create unique index agent_playbooks_one_approved on agent_playbooks (agent_id) where status = 'approved';
alter table agent_playbooks enable row level security;

-- An agent on hold: its next playbook waits for Zak. Set when a playbook run falls back or a run
-- doesn't finish (and, from slice 5, when an action is rejected); cleared when Zak approves one.
create table agent_playbook_holds (
  agent_id text primary key references agents (id),
  reason text not null,
  at timestamptz not null default now()
);
alter table agent_playbook_holds enable row level security;
