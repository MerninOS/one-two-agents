-- Connector requests (docs/custom-servers.md, slice 3).
--
-- One row per service someone asked for on Find a tool, counted, so what is asked for most is what
-- gets built next. `asks` is the count; `notes` keeps the newest asks (who, what for, when, the
-- proposal it came from), at most 20, trimmed in code (core/connector-rules.ts). The service's
-- Build Board card is made on the first ask and its title carries the count. Adding a server by
-- address counts as an ask too. The owner closes a request when a built-in connector is ready (or
-- not wanted); that moves the card to Done. Server only: RLS on, no policies.

create table connector_requests (
  id uuid primary key default gen_random_uuid(),
  service_key text not null unique check (service_key ~ '^[a-z0-9]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  asks integer not null default 1 check (asks >= 1),
  notes jsonb not null default '[]'::jsonb,
  board_url text check (board_url is null or board_url ~ '^https://'),
  state text not null default 'open' check (state in ('open', 'closed')),
  outcome text check (outcome is null or char_length(outcome) <= 200),
  created_at timestamptz not null default now(),
  last_asked_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table connector_requests enable row level security;

-- The one new-tool proposal already said yes to becomes a request, keeping its Build Board card.
-- It asked for website analytics, which Zak decided will be PostHog (Nov 17), so it's PostHog's.
insert into connector_requests (service_key, name, asks, notes, board_url, created_at, last_asked_at)
select 'posthog', 'PostHog', 1,
  jsonb_build_array(jsonb_build_object('by', 'Avery', 'what', left(payload->>'what', 300), 'at', coalesce(decided_at, created_at), 'proposal', id::text)),
  result_ref, coalesce(decided_at, created_at), coalesce(decided_at, created_at)
from proposals
where id = '619d1746-9264-4705-946e-33fb7db9cfe2' and kind = 'new_tool' and state = 'accepted'
on conflict (service_key) do nothing;
