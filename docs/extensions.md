# Extension slots: how the paid layer plugs in

OPERATOR is one app with two editions. The **open edition** is the AGPL-3.0 code on its own, what
self-hosters build. The **cloud edition** is the same app built with the paid layer in `ee/` (its own
license, `ee/LICENSE`): billing, seats, managed credits, SAML/SCIM and the support console (Build
Board card 128).

The app never imports `ee/` (check:open-core refuses it). Instead it has a short list of slots, and
each slot has a do-nothing default in core:

| Slot | Asked when | Open edition |
| --- | --- | --- |
| `planBlock({ kind: "run" })` | before every run, after the on-duty and budget checks (`core/runs.ts`) | never blocks |
| `planBlock({ kind: "invite" })` | an owner adds a person on Settings > People | never blocks |
| `planBlock({ kind: "agent_on" })` | putting an agent back on duty, or turning on the org | never blocks |
| `planBlock({ kind: "custom_server" })` | adding a custom MCP server on Connections | never blocks |
| `SettingsCards` | extra cards at the bottom of Settings | none |
| `SignupPage` | the page at `/signup` | none, so `/signup` is not found |
| `edition` | for anything that needs to say which edition it is | `"open"` |

## How the swap works

- `core/extension-types.ts` names the slots (`SLOTS`) and their types.
- `core/extensions/none.ts` is the open edition's answer to every slot.
- `ee/index.ts` is the cloud edition's answer to every slot.
- `core/extensions.ts` is the only file that imports them, by the name `operator-extensions`.
  `tsconfig.json` maps that name to `core/extensions/none.ts`, so typecheck, scripts and a plain
  `npm run build` get the open edition.
- With `OPERATOR_EDITION=cloud` set, `next.config.ts` adds a Turbopack alias that maps
  `operator-extensions` to `ee/index.ts` instead. That setting is the only switch between editions.
  Without `ee/index.ts` (the public repo) the cloud build stops with a clear error.

## What a slot may do

A slot can only add a "no" or add a page. It can never turn off something core checks: roles,
the hard rules in CLAUDE.md, caps, budgets and the gateway run whatever a slot answers, and a plan
check that throws counts as a "no". A new slot needs a pull request to core with its default in
`none.ts` (check:open-core fails until every edition fills every slot).

## The public repo

The export to the public repo keeps `ee/LICENSE` and `ee/README.md` and leaves out the rest of
`ee/`, so the public tree builds the open edition.
