-- The org chart: departments and the seats in them. Spec: docs/org-chart.md (slice 1).
-- Built in core/org.ts and core/org-rules.ts, shown on Crew > Org chart.
--
-- A seat is one box on the chart. It sits in a department, under a parent seat (the head of a
-- department has no parent), and is held by an agent, by Zak, or nobody yet (open). One seat
-- sits above every department: Avery's, the company seat (no department).
--
-- Where an agent sits gives it nothing: what it can read or do is still its saved setup, checked
-- in code. Nothing here runs or spends anything.

create table departments (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 60),
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
alter table departments enable row level security;

create table seats (
  id uuid primary key default gen_random_uuid(),
  department_id text references departments(id) on delete restrict,   -- null: the company seat
  parent_id uuid references seats(id) on delete restrict,              -- null: the head of a department, or the company seat
  title text not null check (char_length(title) between 1 and 60),
  sub text not null default '' check (char_length(sub) <= 120),
  holder text not null default 'open' check (holder in ('open', 'zak', 'agent')),
  -- an agent built in the app, one of the crew in code, or a planned one (checked in code)
  agent_id text check (agent_id is null or agent_id ~ '^[a-z][a-z0-9_]{1,62}$'),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((holder = 'agent') = (agent_id is not null)),
  check (parent_id is null or parent_id <> id),
  check (department_id is not null or parent_id is null)
);
-- an agent sits in one seat at most
create unique index seats_agent on seats (agent_id) where agent_id is not null;
-- one head per department
create unique index seats_head on seats (department_id) where parent_id is null and department_id is not null;
-- one company seat
create unique index seats_company on seats ((true)) where department_id is null;
create index seats_parent on seats (parent_id);
alter table seats enable row level security;

-- The chart Zak sketched on 2026-11-13: Avery on top, Finance, Sales, Coffee and Marketing.
insert into departments (id, name, sort) values
  ('finance', 'Finance', 1),
  ('sales', 'Sales', 2),
  ('coffee', 'Coffee', 3),
  ('marketing', 'Marketing', 4)
on conflict (id) do nothing;

insert into seats (id, department_id, parent_id, title, sub, holder, agent_id, sort) values
  ('e6b4de7a-004f-453a-b04a-a26e39dcea56', null, null, 'Chief of Staff', 'Reads each department, writes your brief', 'agent', 'chief_of_staff', 0),

  ('b821fc94-6ddf-42fc-bf59-05b8959eb5ef', 'finance', null, 'CFO', 'Numbers, runway', 'agent', 'cfo', 0),
  ('68a01354-823f-4600-845d-e5e02b5b9ffd', 'finance', 'b821fc94-6ddf-42fc-bf59-05b8959eb5ef', 'Bookkeeper', 'Receipts, categories', 'agent', 'bookkeeper', 1),

  ('a4efeb0e-ec08-485e-b8ba-e1bd2c90d79d', 'sales', null, 'Head of sales', 'Wholesale leads', 'agent', 'wholesale_hunter', 0),
  ('015df051-584c-454f-9866-c2f65d988147', 'sales', 'a4efeb0e-ec08-485e-b8ba-e1bd2c90d79d', 'Follow-ups', 'Replies on open threads', 'open', null, 1),

  ('53f5b29a-81f5-4dc7-9960-63ae8d87b333', 'coffee', null, 'Head of coffee', 'Roasting, green coffee, the shop', 'open', null, 0),
  ('cd5e59ef-88b7-4cbf-a07e-a6ce21c55eca', 'coffee', '53f5b29a-81f5-4dc7-9960-63ae8d87b333', 'Roast planner', 'Roast schedule, days of cover', 'agent', 'roast_planner', 1),
  ('ce2177cd-9968-4a4e-9807-54609359e4fd', 'coffee', '53f5b29a-81f5-4dc7-9960-63ae8d87b333', 'Green buyer', 'Offers, market, what to buy', 'agent', 'green_buyer', 2),
  ('97f65119-201a-4342-abf3-f5134abce4c8', 'coffee', '53f5b29a-81f5-4dc7-9960-63ae8d87b333', 'Merchandiser', 'Sold-out lots, lot pages', 'agent', 'merchandiser', 3),

  ('2a12877f-96f8-4f47-9d39-742bd0b85526', 'marketing', null, 'Head of marketing', 'Strategy, budget, targets', 'open', null, 0),
  ('1676fe2f-890b-46aa-9ca9-3c4de1ddcb5d', 'marketing', '2a12877f-96f8-4f47-9d39-742bd0b85526', 'Acquisition lead', 'New customers', 'open', null, 1),
  ('fe69cb3f-7fc0-40b4-a4a7-eef0caed1435', 'marketing', '2a12877f-96f8-4f47-9d39-742bd0b85526', 'Retention lead', 'Repeat purchase', 'open', null, 2),
  ('8b95af0e-3c43-4b56-8782-8d5e5f3f886f', 'marketing', '2a12877f-96f8-4f47-9d39-742bd0b85526', 'Brand lead', 'Voice, content', 'open', null, 3),
  ('cda89d78-511d-4e3b-a67e-bb08751eef20', 'marketing', '2a12877f-96f8-4f47-9d39-742bd0b85526', 'Growth ops lead', 'Site and data', 'open', null, 4),

  ('0d3cc461-6e1a-4541-bb30-7aa5ebabbc7d', 'marketing', '1676fe2f-890b-46aa-9ca9-3c4de1ddcb5d', 'Paid social', 'Meta, TikTok ads', 'open', null, 1),
  ('b0db2626-3e1d-4d53-ac30-edcf9d3c9b28', 'marketing', '1676fe2f-890b-46aa-9ca9-3c4de1ddcb5d', 'Search and SEO', 'Google, organic', 'open', null, 2),
  ('727cd5db-8100-4afa-a5b8-04fd930315a7', 'marketing', '1676fe2f-890b-46aa-9ca9-3c4de1ddcb5d', 'Creators', 'Influencers, UGC', 'open', null, 3),

  ('943b2f2d-49be-47a9-b3eb-619ca53ef0de', 'marketing', 'fe69cb3f-7fc0-40b4-a4a7-eef0caed1435', 'Email and SMS', 'Klaviyo flows', 'agent', 'blend_coach', 1),
  ('d775f1b6-48bf-4d24-b0e7-98e8c1dfacc7', 'marketing', 'fe69cb3f-7fc0-40b4-a4a7-eef0caed1435', 'Subscriptions', 'Churn, winback', 'open', null, 2),
  ('348ae364-b2ce-4f9f-9fed-d633a78c5bc3', 'marketing', 'fe69cb3f-7fc0-40b4-a4a7-eef0caed1435', 'Insights', 'Surveys, reviews', 'open', null, 3),

  ('c9bf43bc-d814-47ed-b5b3-deae776d7793', 'marketing', '8b95af0e-3c43-4b56-8782-8d5e5f3f886f', 'Trend scout', 'Social trends', 'agent', 'content_scout', 1),
  ('33f2ecaf-a8ee-4574-820a-4fc236c2872e', 'marketing', '8b95af0e-3c43-4b56-8782-8d5e5f3f886f', 'Content', 'Shoots, edits', 'zak', null, 2),
  ('68faa12e-a79a-4aa3-96dc-b839bbdca0cc', 'marketing', '8b95af0e-3c43-4b56-8782-8d5e5f3f886f', 'Community', 'Comments, DMs', 'agent', 'concierge', 3),

  ('3712ab40-c259-43d5-8a44-1e39dc7d83d2', 'marketing', 'cda89d78-511d-4e3b-a67e-bb08751eef20', 'Site and CRO', 'Conversion tests', 'agent', 'conversion_optimizer', 1),
  ('4a9d4253-c1ae-451e-837f-be9df8ae5d38', 'marketing', 'cda89d78-511d-4e3b-a67e-bb08751eef20', 'Analytics', 'Reporting, data', 'open', null, 2),
  ('b47ac809-7b36-4db7-b217-8d3ef9ecd64d', 'marketing', 'cda89d78-511d-4e3b-a67e-bb08751eef20', 'Project ops', 'Calendar, briefs', 'open', null, 3)
on conflict (id) do nothing;
