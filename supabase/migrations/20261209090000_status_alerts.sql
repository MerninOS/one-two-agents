-- Status and alerts (docs/usage.md, Open core 6 slice 4): when the owner was last emailed about each
-- problem on the Status page, so an alert goes out once and again at most once a day while the
-- problem lasts. A row per org and problem key (dead_jobs, overdue_jobs, paused:<connection>).
create table status_alerts (
  org_id uuid not null references orgs(id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,30}(:[a-z0-9_]{1,40})?$'),
  sent_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table status_alerts enable row level security;
create policy org_rows on status_alerts for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
