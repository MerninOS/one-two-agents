-- Usage ledger (docs/usage.md, Open core 6 slice 1): what each org spent, one row per thing that
-- cost money, so budgets (and, later, metered billing) read one place. Today a row is a finished
-- run's AI cost; per-call rows come with traces. Rows are written by the database itself, from
-- agent_runs, so no code path can run without its cost landing here. Rows are never edited by
-- the app: only this trigger writes them.

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  kind text not null check (kind in ('run', 'model_call', 'tool_call')),
  -- when the spend counts: a run's start, as budgets have always counted
  at timestamptz not null,
  run_id uuid references agent_runs(id) on delete set null,
  agent_id text not null,
  -- the run's trigger (cron, manual, chain, preview, chat ...)
  source text not null check (length(source) between 1 and 40),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now(),
  unique (org_id, run_id, kind)
);
create index usage_ledger_org_at on usage_ledger (org_id, at);
create index usage_ledger_org_agent_at on usage_ledger (org_id, agent_id, at);
alter table usage_ledger enable row level security;
create policy org_rows on usage_ledger for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
-- the app reads the ledger; only the trigger below writes it
revoke insert, update, delete on usage_ledger from authenticated, anon, service_role;

-- A run's cost lands in the ledger whenever the run row gets one (written once, when it finishes).
create function public.ledger_run_cost() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cost_usd > 0 or new.tokens_in > 0 or new.tokens_out > 0 then
    insert into usage_ledger (org_id, kind, at, run_id, agent_id, source, tokens_in, tokens_out, cost_usd)
    values (new.org_id, 'run', new.started_at, new.id, new.agent_id, left(coalesce(nullif(new.trigger, ''), 'unknown'), 40), new.tokens_in, new.tokens_out, new.cost_usd)
    on conflict (org_id, run_id, kind) do update
      set tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out, cost_usd = excluded.cost_usd;
  end if;
  return new;
end $$;
revoke all on function public.ledger_run_cost() from public;

create trigger agent_runs_ledger after insert or update of cost_usd, tokens_in, tokens_out on agent_runs
  for each row execute function public.ledger_run_cost();

-- Every run that already cost something, so budgets read the same totals the day this lands.
insert into usage_ledger (org_id, kind, at, run_id, agent_id, source, tokens_in, tokens_out, cost_usd)
select org_id, 'run', started_at, id, agent_id, left(coalesce(nullif(trigger, ''), 'unknown'), 40), tokens_in, tokens_out, cost_usd
from agent_runs where cost_usd > 0 or tokens_in > 0 or tokens_out > 0
on conflict (org_id, run_id, kind) do nothing;
