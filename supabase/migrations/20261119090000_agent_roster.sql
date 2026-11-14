-- Agents built in the app work like the crew (Build Board card 57, docs/agent-roster.md).
--
-- Who an agent is (role, avatar, since when, whether it runs only by hand) moves from the
-- hand-written list in code (dashboard/crew.ts, agents/registry.ts) to the agents row, so an agent
-- built in the app is the same as the four that started in code. dashboard/crew.ts keeps only the
-- planned seats that have no agent yet.

alter table agents
  -- blank: the Control Room shows the agent's seat on the org chart, or "Built in the app"
  add column role text not null default '' check (char_length(role) <= 60),
  -- a lucide icon name the Control Room knows; anything else shows a plain icon
  add column icon text check (icon is null or icon ~ '^[a-z0-9-]{1,40}$'),
  -- avatar colour; null picks one from the agent id
  add column hue text check (hue is null or hue ~ '^#[0-9A-Fa-f]{6}$'),
  -- runs only from the Run button, or in a chain started with Run chain. A new agent starts this way
  -- until Zak turns it off on its profile (Controls on), so building one never schedules it.
  add column manual_only boolean not null default true,
  add column created_at timestamptz not null default now();

update agents set role = 'Chief of Staff', icon = 'clipboard-list', hue = '#F2884B', manual_only = false, created_at = '2026-10-29T12:00:00-05:00' where id = 'chief_of_staff';
update agents set role = 'CFO', icon = 'calculator', hue = '#6CC69A', manual_only = false, created_at = '2026-10-29T12:00:00-05:00' where id = 'cfo';
-- about $1 of Claude a run, so it never runs on its own
update agents set role = 'Wholesale Hunter', icon = 'compass', hue = '#F5D35C', manual_only = true, created_at = '2026-10-29T12:00:00-05:00' where id = 'wholesale_hunter';
-- proposes Mercury changes; by hand until launch
update agents set role = 'Bookkeeper', icon = 'receipt', hue = '#F6B8C9', manual_only = true, created_at = '2026-11-09T12:00:00-06:00' where id = 'bookkeeper';
update agents set icon = 'handshake', hue = '#8FB8F2', created_at = '2026-11-14T09:40:00-06:00' where id = 'b_reese';
update agents set icon = 'coffee', hue = '#C9A27A', created_at = '2026-11-14T09:40:00-06:00' where id = 'b_marlow';
update agents set icon = 'megaphone', hue = '#B9A3F0', created_at = '2026-11-14T09:40:00-06:00' where id = 'b_sloane';
