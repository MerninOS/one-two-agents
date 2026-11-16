-- The tool check (docs/mcp-everywhere.md, slice 3).
--
-- tools_seen: a fingerprint of each read tool's inputs, as the server listed them when Zak last
-- signed in (or the last check passed). tools_checked_at: when the server's tools were last
-- compared with the profile in code. A tool that's gone or whose inputs changed pauses the server
-- until Zak signs in again. The log gains two events for it.

alter table mcp_connections
  add column tools_seen jsonb,
  add column tools_checked_at timestamptz;

alter table mcp_connection_events drop constraint mcp_connection_events_event_check;
alter table mcp_connection_events add constraint mcp_connection_events_event_check
  check (event in ('connected', 'refreshed', 'refresh_failed', 'refused', 'revoked', 'revoke_failed', 'disconnected', 'resealed', 'tools_changed', 'tools_checked'));
