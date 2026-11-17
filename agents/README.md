# Agents

Every agent is a saved spec that runs on the shared engine (`core/runner.ts`, `core/built.ts`):
its active version and its approved routine. Building or changing one is the builder flow in the
Control Room (Crew, then New agent or an agent's Edit tab; `docs/builder-flow.md`). When it runs
is the crew flow (Crew > Schedule).

`registry.ts` lists the agents that can run on a schedule, in a chain or by hand through
`/api/agents/<id>`; the route handles auth, the run log, the on-duty switch and the daily budget.

The code One Two's tools call (Morgan's numbers, Avery's brief, Quinn's books sync, Rowan's
wholesale offer) lives in One Two's template pack, `templates/one-two` (docs/templates.md).

Adding an agent is done in the builder, not here. A new kind of read, calculation, report or
action is a new tool: in `core/tools/catalog.ts` when any business can use it, or in a template
pack's `tools.ts` when it belongs to one kind of business (actions only through `core/gateway`).
