-- Heads plan, review and set focus (company mode slice 4, docs/company-mode.md).
--
-- A plan is a head's week for its department: its words (the run's result) and up to 8 lines,
-- each a teammate's focus, a seat nobody holds yet, or a person's job for Zak. One plan per
-- department per week (the Chicago Monday). The review is the head's words after its team runs.
-- Everything here is words: a plan grants nothing, and a focus is a 7-day memory note for the
-- teammate (agent_memory grp 'focus'), never authority.

create table plans (
  id uuid primary key default gen_random_uuid(),
  department_id text not null references departments (id) on delete cascade,
  head_agent text references agents (id) on delete set null,
  week_of date not null,
  summary text check (summary is null or char_length(summary) <= 2000),
  -- [{n, title, kind: 'agent'|'seat'|'zak', agentId?, seatId?, who, words, memoryId?, doneAt?}]
  items jsonb not null default '[]'::jsonb,
  run_id uuid,
  review text check (review is null or char_length(review) <= 2000),
  review_run_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, week_of)
);
create index plans_week on plans (week_of desc);

alter table plans enable row level security;

-- a head's focus for a teammate: a note that expires in 7 days
alter table agent_memory drop constraint agent_memory_grp_check;
alter table agent_memory add constraint agent_memory_grp_check check (grp in ('crew', 'department', 'standing_order', 'lesson', 'note', 'working', 'focus'));
alter table agent_memory drop constraint agent_memory_keep_check;
alter table agent_memory add constraint agent_memory_keep_check check (keep in ('next_run', 'days_7', 'days_30', 'always'));
