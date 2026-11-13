-- Agent builder slice 6 (docs/agent-builder.md): Morgan (cfo) and Avery (chief_of_staff) as
-- specs on the runner, each with a starting playbook written from what its code does today, and
-- a switch per agent. The switch starts off: scheduled and chain runs keep using the old code
-- until Zak compares the two side by side and presses Switch on the builder screen.

alter table agents add column if not exists on_runner boolean not null default false;
comment on column agents.on_runner is 'Agent builder: when true, runs (schedule, chain, manual) use the runner with the active spec and approved playbook instead of the agent''s own code.';

insert into agent_defs (agent_id, version, spec, note, created_by, active)
select 'cfo', coalesce((select max(version) from agent_defs where agent_id = 'cfo'), 0) + 1, jsonb_build_object(
  'name', 'Morgan',
  'mandate', 'Yesterday''s numbers in code, saved to kpi_snapshots, and a line on burn rate',
  'directive', 'Each morning, write one or two short plain sentences for Zak on the burn rate and runway and what is driving them, using only the numbers from Burn rate and runway and the Daily numbers snapshot. Do not restate every number; say what matters. Then list the key numbers in finish: revenue, orders, cash, net burn per 30 days and runway months when there is one.',
  'goodResult', 'Two sentences at most. Every number exactly as a tool gave it.',
  'model', 'claude-haiku-5-5',
  'effort', 'low',
  'tools', jsonb_build_array('calc_daily_snapshot', 'calc_burn_rate', 'report_kpi_snapshot'),
  'notionPages', '[]'::jsonb,
  'limits', jsonb_build_object('maxSteps', 4, 'maxCostUsd', 0.1),
  'outputName', 'daily numbers',
  'readsFrom', '[]'::jsonb,
  'reportPage', null
), 'Rebuilt from agents/cfo (slice 6)', 'migration', false
where not exists (select 1 from agent_defs where agent_id = 'cfo');

insert into agent_defs (agent_id, version, spec, note, created_by, active)
select 'chief_of_staff', 1, jsonb_build_object(
  'name', 'Avery',
  'mandate', 'One morning brief for Zak: today''s focus, what is waiting, the numbers, what to watch',
  'directive', E'You are the Chief of Staff for One Two Coffee, a small Austin roaster that sells custom blends and its own coffees online, roasted to order, plus private label wholesale. Each weekday morning, read today''s facts with your tools and write the Watch list and one recommended focus for Zak, the owner.\n\n- Watch items are things that need attention or could go wrong soon: green lots running low, orders waiting too long, an agent run that failed, a sharp change in a number. At most five, one short plain sentence each. None is fine on a quiet day.\n- The focus is the single most useful thing Zak could do today, with the reason in one sentence. Prefer revenue and anything that blocks customers'' orders.\n- Plain, direct words. No flattery, no exclamation marks.\n\nHand in your result in exactly this shape, one item per line:\nFocus: <the one action>. <why, in one sentence>\n- <a watch item>\n- <another watch item>\n\nCode builds the brief email and the Briefs row from your Focus and Watch lines plus the numbers it works out itself.',
  'goodResult', 'A Focus line, then up to five lines starting with "- ". Every number exactly as a tool gave it.',
  'model', 'claude-sonnet-5-5',
  'effort', 'medium',
  'tools', jsonb_build_array('kpi_snapshots', 'shopify_open_orders', 'calc_green_cover', 'agent_runs_recent', 'approvals_waiting', 'report_morning_brief'),
  'notionPages', '[]'::jsonb,
  'limits', jsonb_build_object('maxSteps', 8, 'maxCostUsd', 0.3),
  'outputName', 'morning brief',
  'readsFrom', '[]'::jsonb,
  'reportPage', null
), 'Rebuilt from agents/chief-of-staff (slice 6)', 'migration', false
where not exists (select 1 from agent_defs where agent_id = 'chief_of_staff');

update agent_defs set active = true where agent_id in ('cfo', 'chief_of_staff') and created_by = 'migration'
  and not exists (select 1 from agent_defs d2 where d2.agent_id = agent_defs.agent_id and d2.active);

-- starting playbooks, approved: written from what the code does today, so neither needs an explore run
insert into agent_playbooks (agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select 'cfo', 1, '[{"tool":"calc_daily_snapshot","input":{"days":1}},{"tool":"calc_burn_rate","input":{"days":90}}]'::jsonb,
  'approved', 'Starting playbook, written from agents/cfo', false, now(), 'migration'
where not exists (select 1 from agent_playbooks where agent_id = 'cfo');

insert into agent_playbooks (agent_id, version, steps, status, changes, auto, decided_at, decided_by)
select 'chief_of_staff', 1, '[{"tool":"kpi_snapshots","input":{"days":8}},{"tool":"shopify_open_orders","input":{}},{"tool":"calc_green_cover","input":{"days":30}},{"tool":"agent_runs_recent","input":{}},{"tool":"approvals_waiting","input":{}}]'::jsonb,
  'approved', 'Starting playbook, written from agents/chief-of-staff', false, now(), 'migration'
where not exists (select 1 from agent_playbooks where agent_id = 'chief_of_staff');
