-- Departments slice 3 (docs/org-chart.md): Avery reads each department's head report instead of
-- every agent's runs. The tool agent_runs_recent is gone from the tool list; department_reports
-- replaces it, and the brief's "What ran" section becomes "Departments", one line each.
--
-- A new spec version for Avery, copied from the live one (its model and limits stay), with that
-- tool swapped and the directive asking for one line per department. Its playbook gets the same
-- swap as a new approved version, which Zak's rule allows for an agent whose first playbook he
-- already approved: later updates apply on their own, with what changed shown.

insert into agent_defs (agent_id, version, spec, note, created_by, active)
select 'chief_of_staff', d.version + 1,
  jsonb_set(
    jsonb_set(
      jsonb_set(d.spec, '{tools}', (
        select coalesce(jsonb_agg(case when t = 'agent_runs_recent' then 'department_reports' else t end order by n), '[]'::jsonb)
        from jsonb_array_elements_text(d.spec->'tools') with ordinality as e(t, n)
      ) || (case when d.spec->'tools' ? 'agent_runs_recent' or d.spec->'tools' ? 'department_reports' then '[]'::jsonb else '["department_reports"]'::jsonb end)),
      '{directive}', to_jsonb(replace(
        d.spec->>'directive',
        E'Code builds the brief email',
        E'Then one line per department from Department reports, with no dash in front: the department''s name, a colon, and in one short sentence what its head reported that matters to Zak today, or "No report" when the head seat is open or has nothing. For example:\nFinance: Cash covers about 14 months and burn is flat.\n\nCode builds the brief email'
      ))
    ),
    '{goodResult}', to_jsonb('A Focus line, up to five lines starting with "- ", then one line per department starting with its name and a colon. Every number exactly as a tool gave it.'::text)
  ),
  'Departments slice 3: reads Department reports instead of every agent''s runs, and writes one line per department', 'migration', false
from agent_defs d
where d.agent_id = 'chief_of_staff' and d.active
  and not exists (select 1 from agent_defs x where x.agent_id = 'chief_of_staff' and x.spec->'tools' ? 'department_reports');

-- one active version per agent (a unique index), so the old one goes off before the new one goes on
update agent_defs set active = false
where agent_id = 'chief_of_staff' and active and not (spec->'tools' ? 'department_reports')
  and exists (select 1 from agent_defs x where x.agent_id = 'chief_of_staff' and x.spec->'tools' ? 'department_reports');
update agent_defs set active = true
where agent_id = 'chief_of_staff' and version = (select max(version) from agent_defs where agent_id = 'chief_of_staff' and spec->'tools' ? 'department_reports')
  and not exists (select 1 from agent_defs x where x.agent_id = 'chief_of_staff' and x.active);

-- the playbook: the same steps, with Other agents' runs swapped for Department reports. One
-- approved playbook per agent (a unique index), so the old one is replaced first.
create temporary table avery_pb on commit drop as
select p.version, (
    select jsonb_agg(case when s->>'tool' = 'agent_runs_recent' then '{"tool":"department_reports","input":{"days":1}}'::jsonb else s end order by n)
    from jsonb_array_elements(p.steps) with ordinality as e(s, n)
  ) as steps
from agent_playbooks p
where p.agent_id = 'chief_of_staff' and p.status = 'approved' and p.steps @> '[{"tool":"agent_runs_recent"}]'::jsonb;

update agent_playbooks set status = 'replaced'
where agent_id = 'chief_of_staff' and status = 'approved' and version in (select version from avery_pb);

insert into agent_playbooks (agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select 'chief_of_staff', (select max(version) from agent_playbooks where agent_id = 'chief_of_staff') + 1, steps,
  'approved', 'Removed: Other agents'' runs. Added: Department reports (days 1). Departments slice 3.', true, now(), 'migration'
from avery_pb;

-- any other spec or playbook that still names the retired tool would be refused at run time
-- ("asks for something code doesn't offer"), so say so here instead of failing silently later
do $$
begin
  if exists (select 1 from agent_defs where active and spec->'tools' ? 'agent_runs_recent') then
    raise notice 'An active spec still uses agent_runs_recent: edit it in the builder and pick Department reports or Your team.';
  end if;
end $$;
