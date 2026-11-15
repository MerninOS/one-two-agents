-- Proposals (company mode slice 3, docs/company-mode.md).
--
-- What a department head (or Claude, or Zak) hands Zak to decide: hire an agent, grant a teammate a
-- read tool, build a new tool, or retire an agent or close a seat. Checked in code when filed
-- (core/proposal-rules.ts) and again at Zak's tap (core/proposals.ts). A proposal does nothing by
-- itself: a yes goes through the app's own paths (a hire starts off duty with no actions; a tool
-- becomes a draft version that still needs Try it and Go live; a new tool goes on the build list).
-- payload holds the checked plan with names resolved to seats and agents when it was filed.

create table proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hire', 'grant_tool', 'new_tool', 'retire')),
  title text not null check (char_length(title) between 3 and 160),
  source text not null check (source in ('agent', 'claude', 'zak')),
  from_agent text references agents (id) on delete set null,
  department_id text references departments (id) on delete set null,
  run_id uuid,
  payload jsonb not null,
  why text not null check (char_length(why) between 10 and 600),
  state text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'built', 'failed')),
  -- what Zak's tap did, in words, and what it made (an agent id)
  outcome text,
  result_ref text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index proposals_state on proposals (state, created_at desc);
create index proposals_from on proposals (from_agent, state);

alter table proposals enable row level security;
