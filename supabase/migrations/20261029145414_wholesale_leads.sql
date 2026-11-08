-- Wholesale Hunter: the prospect pipeline. The agent writes new leads and their
-- first-touch drafts; Zak sends (or bins) the drafts himself, so nothing here
-- ever sends email.

create table wholesale_leads (
  id uuid primary key default gen_random_uuid(),
  business text not null,
  city text,
  type text,                                 -- cafe | restaurant | office | grocery | other
  website text,
  domain text unique,                        -- website host without www., the dedupe key
  contact_name text,
  email text,                                -- only an address published on the business's own pages
  contact_route text,                        -- how to reach them when there is no email (form, Instagram, phone)
  sources jsonb not null default '[]'::jsonb, -- pages the agent read about this business
  fit_score smallint check (fit_score between 1 and 5),
  fit_reason text,
  stage text not null default 'new'
    check (stage in ('new', 'drafted', 'contacted', 'replied', 'tasting', 'won', 'lost', 'skip')),
  draft_subject text,
  draft_body text,
  gmail_draft_id text,
  run_id uuid references agent_runs (id),
  last_touch_at timestamptz,
  next_touch_at timestamptz,
  created_at timestamptz not null default now()
);
create index wholesale_leads_stage on wholesale_leads (stage, created_at desc);

alter table wholesale_leads enable row level security;

insert into agents (id, name, model, schedule, daily_budget_usd) values
  ('wholesale_hunter', 'Wholesale Hunter', 'claude-opus-5-5', 'Tue and Thu 8 AM CT', 3);
