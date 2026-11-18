-- Audit log (docs/usage.md, Open core 6 slice 2): one row for each thing a person did that changes
-- what agents may do, spend or reach: approvals, the org switch and duty, caps and vendors,
-- Connections, people and roles, specs, playbooks and chains. Append-only: the app can add a row
-- and read its own org's rows, never change or delete one.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  at timestamptz not null default now(),
  -- who: the signed-in member's email
  actor text not null check (length(actor) between 3 and 254),
  -- what, as the action's name in code (dashboard/*Actions.ts), e.g. approve, set_cap
  action text not null check (action ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- on what: an approval id, an agent id, a connection, a cap key, an email ...
  target text check (target is null or length(target) <= 200),
  -- a few plain facts about it; never a secret (core/audit.ts scrubs it)
  detail jsonb check (detail is null or (jsonb_typeof(detail) = 'object' and length(detail::text) <= 2000))
);
create index audit_log_org_at on audit_log (org_id, at desc);
alter table audit_log enable row level security;
create policy org_rows on audit_log for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
revoke update, delete, truncate on audit_log from authenticated, anon, service_role;
