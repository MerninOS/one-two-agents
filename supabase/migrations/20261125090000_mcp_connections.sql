-- MCP connections (company mode slice 6, docs/company-mode.md).
--
-- One row per MCP server the runner may call (Klaviyo first). secret holds the sign-in (client id,
-- token endpoint, access and refresh tokens), encrypted by the app with a key made from the service
-- role key; nothing here is readable without it. settings holds Zak's choices for the connection
-- (the email list a goal counts). Which tools may be called is in code (core/mcp-rules.ts), never
-- here. Server only: RLS on, no policies.

create table mcp_connections (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,30}$'),
  secret text,
  settings jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table mcp_connections enable row level security;
