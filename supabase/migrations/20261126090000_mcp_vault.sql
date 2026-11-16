-- The token vault (docs/mcp-everywhere.md, slice 2).
--
-- paused_at: a sign-in that stopped working (refresh refused, server said 401/403) is paused, so it
-- isn't retried on every call; signing in again clears it.
--
-- mcp_connection_events: the sign-in log. What happened and when, never a token value (the app
-- scrubs every detail before it is written). Kept after a disconnect, so there is no foreign key.
-- Server only: RLS on, no policies.

alter table mcp_connections add column paused_at timestamptz;

create table mcp_connection_events (
  id bigint generated always as identity primary key,
  connection_id text not null check (connection_id ~ '^[a-z][a-z0-9_]{1,30}$'),
  event text not null check (event in ('connected', 'refreshed', 'refresh_failed', 'refused', 'revoked', 'revoke_failed', 'disconnected', 'resealed')),
  detail text check (char_length(detail) <= 300),
  at timestamptz not null default now()
);

create index mcp_connection_events_by_connection on mcp_connection_events (connection_id, at desc);

alter table mcp_connection_events enable row level security;
