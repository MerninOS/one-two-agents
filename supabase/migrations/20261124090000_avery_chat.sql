-- Avery's chat, the front door (company mode slice 5, docs/company-mode.md).
--
-- Both sides of Zak's conversation with the agent in the company seat. Each of her replies is a run
-- (agent_runs, trigger 'chat') and points at it. notes are the lines code added under a reply about
-- what it actually saved (a rule in Zak's words, a proposal filed). Words only: nothing here grants,
-- runs or sends anything.

create table avery_chat (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('zak', 'avery')),
  text text not null check (char_length(text) <= 4000),
  run_id uuid references agent_runs (id) on delete set null,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index avery_chat_at on avery_chat (created_at desc);

alter table avery_chat enable row level security;
