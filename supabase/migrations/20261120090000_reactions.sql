-- Teach by reacting (company mode slice 1, docs/company-mode.md).
--
-- Zak reacts to an agent's work where he sees it: Good or Not this on a run, on one item of a run
-- (a lead), or Not this on an approval card (Reject). One row per thing he reacted to; reacting
-- again changes the row. "Not this" with words also saves a rule in his words in agent_memory
-- (memory_id points at it); the reaction row is only the signal, for the agent's scorecard and for
-- the head that reads its team. Nothing here grants, sends or spends anything.

create table reactions (
  id uuid primary key default gen_random_uuid(),
  agent_id text not null references agents (id),
  run_id uuid references agent_runs (id),
  approval_id uuid references approvals (id),
  -- one item of the run, e.g. a lead in wholesale_leads; its label is copied for the journal
  item_id uuid,
  item_label text check (item_label is null or char_length(item_label) <= 120),
  verdict text not null check (verdict in ('good', 'not')),
  -- Zak's words, when he gave any
  text text check (text is null or char_length(text) <= 280),
  -- the rule his words became, when they became one
  memory_id uuid references agent_memory (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (run_id is not null or approval_id is not null)
);

-- one reaction per thing reacted to
create unique index reactions_one_per_target on reactions (
  coalesce(run_id, approval_id),
  coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
create index reactions_agent on reactions (agent_id, created_at desc);

alter table reactions enable row level security;
