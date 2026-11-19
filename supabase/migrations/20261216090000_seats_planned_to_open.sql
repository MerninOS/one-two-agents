-- Planned agents leave the code (card 134, docs/templates.md). A seat held for an agent that was
-- never built becomes an open seat, keeping its title and line, so the org chart shows the same
-- jobs and the builder can fill them later.
update seats set holder = 'open', agent_id = null
where holder = 'agent'
  and agent_id is not null
  and not exists (select 1 from agents a where a.id = seats.agent_id and a.org_id = seats.org_id);
