-- Agent memory: short notes each agent carries into every run, which Zak reads and corrects
-- in the Control Room. Spec: docs/agent-memory.md.
--
-- Memory is notes, never authority. Nothing that decides what an agent may do (the gateway,
-- policies, vendors, caps, recipients) reads these tables. A model writes only its own
-- working memory; everything else is Zak's words or proposed and waits for his Keep.
-- Facts it may claim and "don't repeat" are worked out from Shopify and the agent's own
-- tables at run time and are never stored here.

create table agent_memory (
  id uuid primary key default gen_random_uuid(),
  agent_id text references agents (id),        -- null = shared crew memory, loaded by every agent
  grp text not null check (grp in ('crew', 'standing_order', 'lesson', 'note', 'working')),
  text text not null check (char_length(text) between 1 and 280),
  source text not null check (source in ('zak', 'approval', 'agent')),
  source_tag text,                             -- "approval:<id>", "run:<id>"
  notion_page_id text,                         -- a standing order may point at a Notion page to load each run
  trust text not null default 'note' check (trust in ('note', 'data')), -- data = read from outside, shown to the model as data
  state text not null default 'kept' check (state in ('proposed', 'kept', 'discarded', 'expired', 'forgotten')),
  keep text not null default 'always' check (keep in ('next_run', 'days_30', 'always')),
  runs_left integer,                           -- 1 for a next-run note; counted down by the run that loads it
  expires_at timestamptz,                      -- for a 30-day note
  tokens integer not null default 0,           -- the line's size, counted in code when saved
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  check ((agent_id is null) = (grp = 'crew'))
);
create index agent_memory_agent on agent_memory (agent_id, state, grp);

-- The timeline. Nothing in agent_memory is ever deleted; every change lands here.
create table memory_events (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid references agent_memory (id),  -- null for a working-memory rewrite (several lines at once)
  agent_id text references agents (id),         -- null = crew memory
  kind text not null check (kind in ('proposed', 'kept', 'edited', 'discarded', 'forgotten', 'expired', 'rewritten', 'added')),
  before text,
  after text,
  by text not null,                             -- "zak (control room)", "agent run <id>"
  at timestamptz not null default now()
);
create index memory_events_agent_at on memory_events (agent_id, at desc);

-- What each run loaded: rows and tokens per group, and the budget.
alter table agent_runs add column memory_json jsonb;

alter table agent_memory enable row level security;
alter table memory_events enable row level security;

insert into policies (key, value_json) values
  ('memory_budget_tokens', '2000'),
  ('working_memory_max_lines', '5')
  on conflict (key) do nothing;
