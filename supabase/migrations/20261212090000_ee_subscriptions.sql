-- The paid layer's billing state (card 128 slice 3, docs/extensions.md): one row per business on the
-- hosted edition, kept by sign-up and Stripe's webhook. The app reads only this row; Stripe holds the
-- card. The home org needs no row (it is never billed). ee_ tables stay out of the public baseline.
create table ee_subscriptions (
  org_id uuid not null references orgs(id) primary key,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled')),
  trial_ends_at timestamptz,
  past_due_since timestamptz,
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]{6,64}$'),
  stripe_subscription_id text unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]{6,64}$'),
  seats integer not null default 1 check (seats between 1 and 1000),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table ee_subscriptions enable row level security;
create policy org_rows on ee_subscriptions for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
