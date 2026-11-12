-- Agent setup slice 7 (docs/agent-setup.md): menus for Rowan, Quinn and Morgan.
-- v1 for each holds the values it ran with before setups existed, so nothing changes until Zak
-- saves a v2 on the Setup tab. No table changes. Saving a setup never turns an agent on:
-- agents.enabled is not touched here.
insert into agent_setup (agent_id, version, setup, note, created_by, active)
select v.agent_id, 1, v.setup, v.note, 'migration', true
from (values
  ('wholesale_hunter',
   '{"thinking": {"model": "claude-opus-5-5", "effort": "medium", "fallback": null}, "numbers": {"leads_per_run": 5, "max_searches": 10, "max_fetches": 20, "max_turns": 6}, "choices": {"areas": ["austin", "lakeway", "bee_cave"]}}'::jsonb,
   'The values Rowan ran with before setups existed.'),
  ('bookkeeper',
   '{"thinking": {"model": "claude-haiku-5-5", "effort": "low", "fallback": null, "steps": {"pick_category": {"model": "claude-haiku-5-5", "effort": "low", "fallback": null}}}, "numbers": {"lookback_days": 45, "max_searches": 25, "per_charge": 3}}'::jsonb,
   'The values Quinn ran with before setups existed.'),
  ('cfo', '{"numbers": {}}'::jsonb, 'Morgan computes everything in code; nothing to choose yet.')
) as v(agent_id, setup, note)
where exists (select 1 from agents a where a.id = v.agent_id)
  and not exists (select 1 from agent_setup s where s.agent_id = v.agent_id)
on conflict (agent_id, version) do nothing;
