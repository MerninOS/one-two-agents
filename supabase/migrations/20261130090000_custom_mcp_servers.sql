-- Custom MCP servers (docs/custom-servers.md, slice 1).
--
-- A server the owner adds by its address, for a tool the built-in connectors don't have. This row
-- is its profile, which the owner edits: its address, how it signs in, the scopes ticked, the
-- server's tool list as last accepted (its words are untrusted), and the tools turned on with the
-- label, line and pinned inputs agents get. The limits on all of it are in code
-- (core/custom-mcp-rules.ts). Its sign-in lives in mcp_connections under the same id, sealed in the
-- vault like every other. Server only: RLS on, no policies.

create table mcp_custom_servers (
  id text primary key check (id ~ '^c_[a-z0-9]{8}$'),
  name text not null check (char_length(name) between 1 and 60),
  url text not null check (url ~ '^https://' and char_length(url) <= 300),
  auth text not null check (auth in ('oauth', 'key')),
  scopes text[] not null default '{}',
  scopes_offered text[] not null default '{}',
  tools jsonb not null default '[]'::jsonb,
  tools_on jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table mcp_custom_servers enable row level security;

-- The sign-in log gains what happens to a custom server: added, a tool turned on or off, paused or
-- resumed by the owner, and changed tools accepted.
alter table mcp_connection_events drop constraint mcp_connection_events_event_check;
alter table mcp_connection_events add constraint mcp_connection_events_event_check
  check (event in ('connected', 'refreshed', 'refresh_failed', 'refused', 'revoked', 'revoke_failed', 'disconnected', 'resealed', 'tools_changed', 'tools_checked',
    'added', 'tool_on', 'tool_off', 'paused', 'resumed', 'tools_accepted'));
