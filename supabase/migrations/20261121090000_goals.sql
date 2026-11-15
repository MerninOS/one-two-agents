-- Goals and measures (company mode slice 2, docs/company-mode.md).
--
-- A goal belongs to a department. Its measure is a key from the list in code
-- (core/goal-rules.ts MEASURES) and is always counted in code (core/measures.ts), never by a
-- model. A measure code can't count yet is kept, with no target, so the goal says what's missing.
-- Pace and status are worked out in code from the reading, target, start_value and dates.
-- A goal grants nothing: it is what Zak wants, shown on Crew and read by heads (goal_progress).

create table goals (
  id uuid primary key default gen_random_uuid(),
  department_id text not null references departments (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 120),
  measure text check (measure is null or measure ~ '^[a-z][a-z0-9_]{1,40}$'),
  target numeric check (target is null or (target > 0 and target <= 1000000000)),
  -- where a total measure stood when pace started, so pace counts from there
  start_value numeric,
  due_on date,
  state text not null default 'active' check (state in ('active', 'paused', 'done', 'dropped')),
  -- when pace starts: the day it was set, or the day its measure last changed
  paced_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index goals_department on goals (department_id, state, created_at);

alter table goals enable row level security;
