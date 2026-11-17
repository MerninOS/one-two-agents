-- Tenancy slice 3 (docs/tenancy.md): a job queue. Work that runs on its own (a chain's steps today)
-- is a row here, picked up by a worker request that runs it as the job's org. A plain table, not
-- pgmq: it carries org_id and the org_rows policy like every table, and runs on any Postgres.
-- A step waiting for its "not before" time is a job with a later run_after, so chain_waits goes
-- (it has no rows: no chain is on yet).

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('chain_step')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 4000),
  -- one job per key per org: a step of a chain is enqueued once
  dedupe_key text check (length(dedupe_key) <= 200),
  run_after timestamptz not null default now(),
  attempts int not null default 0 check (attempts between 0 and 10),
  claimed_at timestamptz,
  run_id uuid,
  done_at timestamptz,
  failed_at timestamptz,
  -- what happened, in words: the run's end, a skip, or why it failed
  outcome text check (length(outcome) <= 1000),
  created_at timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
alter table jobs enable row level security;
create index jobs_org_id_idx on jobs (org_id);
-- what the scheduler looks for: waiting jobs that are due, and claimed ones that never finished
create index jobs_waiting on jobs (org_id, run_after) where claimed_at is null and done_at is null and failed_at is null;
create index jobs_claimed on jobs (org_id, claimed_at) where claimed_at is not null and done_at is null and failed_at is null;

create policy org_rows on jobs for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

drop table chain_waits;
