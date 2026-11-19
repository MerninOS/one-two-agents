-- One Two's coffee tools leave the app (card 133, docs/custom-servers.md "Goal numbers"): green
-- lots, green use, days of cover and reorder amounts now come from One Two's own server, which the
-- owner adds on Connections and grants on the builder's Tools step (custom tools are never granted
-- by a migration or a proposal). The pack's tools shopify_green_lots, calc_green_use,
-- calc_green_cover and calc_reorder_amount are gone, so every agent whose live spec names them gets a
-- new version without them, and every approved playbook a new approved version without those steps
-- (later playbook updates apply on their own, with what changed shown). No table changes.

create temporary table gone_tools (t text primary key) on commit drop;
insert into gone_tools values ('shopify_green_lots'), ('calc_green_use'), ('calc_green_cover'), ('calc_reorder_amount');

-- specs: a new version without the gone tools, then it goes live (one active version per agent)
create temporary table new_specs on commit drop as
select d.org_id, d.agent_id, d.version + 1 as version,
  jsonb_set(d.spec, '{tools}', coalesce((
    select jsonb_agg(t order by n) from jsonb_array_elements_text(d.spec->'tools') with ordinality as e(t, n)
    where t not in (select t from gone_tools)), '[]'::jsonb)) as spec,
  (select string_agg(t, ', ') from jsonb_array_elements_text(d.spec->'tools') t where t in (select t from gone_tools)) as removed
from agent_defs d
where d.active and exists (select 1 from jsonb_array_elements_text(d.spec->'tools') t where t in (select t from gone_tools));

update agent_defs d set active = false from new_specs n where d.agent_id = n.agent_id and d.org_id = n.org_id and d.active;
insert into agent_defs (org_id, agent_id, version, spec, note, created_by, active)
select org_id, agent_id, (select max(version) from agent_defs x where x.agent_id = n.agent_id) + 1, spec,
  'Removed ' || removed || ': green coffee tools come from One Two''s own server now (card 133). Grant its tools on the Tools step.', 'migration', true
from new_specs n;

-- playbooks: the same steps without the gone tools, as a new approved version
create temporary table new_pbs on commit drop as
select p.org_id, p.agent_id, p.version, coalesce((
    select jsonb_agg(s order by n) from jsonb_array_elements(p.steps) with ordinality as e(s, n)
    where s->>'tool' not in (select t from gone_tools)), '[]'::jsonb) as steps,
  (select string_agg(distinct s->>'tool', ', ') from jsonb_array_elements(p.steps) s where s->>'tool' in (select t from gone_tools)) as removed
from agent_playbooks p
where p.status = 'approved' and exists (select 1 from jsonb_array_elements(p.steps) s where s->>'tool' in (select t from gone_tools));

update agent_playbooks p set status = 'replaced' from new_pbs n where p.agent_id = n.agent_id and p.org_id = n.org_id and p.version = n.version;
insert into agent_playbooks (org_id, agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select org_id, agent_id, (select max(version) from agent_playbooks x where x.agent_id = n.agent_id) + 1, steps,
  'approved', 'Removed: ' || removed || '. Green coffee tools come from One Two''s own server now, called live once granted (card 133).', true, now(), 'migration'
from new_pbs n;

do $$
begin
  if exists (select 1 from agent_defs d, jsonb_array_elements_text(d.spec->'tools') t where d.active and t in ('shopify_green_lots', 'calc_green_use', 'calc_green_cover', 'calc_reorder_amount'))
     or exists (select 1 from agent_playbooks p, jsonb_array_elements(p.steps) s where p.status in ('approved', 'pending') and s->>'tool' in ('shopify_green_lots', 'calc_green_use', 'calc_green_cover', 'calc_reorder_amount')) then
    raise exception 'a live spec or playbook still names a removed coffee tool';
  end if;
  if exists (select 1 from goals where measure = 'lowest_cover_days') then
    raise exception 'a goal still uses lowest_cover_days: repoint it first';
  end if;
end $$;
