-- No home business (card 135, docs/tenancy.md): the first business is no longer exempt from billing
-- by a line of code. A plan row can say "comped" instead: no charge and no limits, for any business.
-- The Stripe webhook never writes over a comped row (ee/billing.ts). The first business gets one, so
-- nothing changes for it.
alter table ee_subscriptions drop constraint if exists ee_subscriptions_status_check;
alter table ee_subscriptions add constraint ee_subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'comped'));

insert into ee_subscriptions (org_id, status, seats)
select id, 'comped', 1 from orgs where id = '0e1a7c4e-0001-4000-8000-000000000001'
on conflict (org_id) do update set status = 'comped', trial_ends_at = null, past_due_since = null, updated_at = now();
