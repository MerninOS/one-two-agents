# OPERATOR

Run a small business with a crew of AI agents that can't go rogue. Each agent has one narrow job, a
budget and a seat on an org chart. It reads your business through tools you connect, and it can only
*propose* anything that leaves the building. A person you trust approves each proposal in the Control
Room. Every run is logged, every number comes from code, and the rules that keep agents safe live in
code, not in prompts.

- **Agents are data.** Build one in the Control Room, one question at a time: its job, what it reads,
  what it hands you, its model and budget. Every agent runs on one shared engine (`core/runner.ts`).
- **Proposals, not actions.** Sending, paying and posting exist only as gateway action types
  (`core/gateway`). Each starts at Draft (an approval card) and earns its way up from a track record;
  some never do (a first email to a stranger, a first payment to a vendor).
- **Every integration is an MCP server** with a profile written in code: the exact scopes it asks for
  and each tool it may use. Credentials live in a per-business vault (`core/vault.ts`).
- **Many businesses, one database.** Every row carries its business's id, and Postgres row level
  security holds each business to its own rows (`docs/tenancy.md`).
- **Company mode.** Departments with heads who plan the week around goals you set, a chief of staff you
  can talk to, and a morning report (`docs/company-mode.md`).

The rules every agent lives under are in `CLAUDE.md` ("Hard rules"). They hold for every business and
a pull request can't loosen them without a maintainer's review (`.github/CODEOWNERS`).

## Run it

- **Self-host:** `docker compose up` runs the app, its scheduler and the migrations against a Supabase
  project (Supabase's open-source stack or Supabase Cloud). See `docs/self-host.md`.
- **Develop:** `npm install`, `cp .env.example .env.local` and fill it in, `npm run schemas` once,
  then `npm run dev`. The first person to sign in with `OPERATOR_OWNER_EMAIL` becomes the owner.

## Layout

```
app/(room)/          the Control Room (sign-in in app/login, guarded by proxy.ts)
app/api/             agent runs, the dispatcher (/api/dispatch), job workers (/api/jobs), health
core/                the runner, agent specs, the tool list (core/tools), the tool gateway, tenancy,
                     the vault, memory, jobs, traces, usage and the audit log
dashboard/           Control Room data, server actions (each checks the member's role) and components
integrations/        mcp.ts (the one MCP client) and our own MCP servers (Notion, Gmail, Shopify,
                     Mercury receipt files)
templates/           template packs: a kind of business's tools, tables and starting crew
supabase/migrations/ the schema, starting from one squashed migration
ee/                  the commercial layer (its own license; see ee/README.md), plugged in through
                     the extension slots in core/extensions.ts (docs/extensions.md)
```

## Docs

`docs/` holds a spec per part: the agent builder and builder flow, agent memory, company mode, the
org chart and schedule, every integration over MCP, custom MCP servers, building a connector,
template packs, tenancy, usage and traces, self-hosting, and the extension slots the paid layer fills.

## Checks

```bash
npm run check       # typecheck, lint, GraphQL validation (run npm run schemas once first)
npm run check:all   # every check:* script: the hard rules, tenancy, roles, the gateway, traces...
npm run build
```

## License

AGPL-3.0 outside `ee/` (`LICENSE`); `ee/` has its own commercial license (`ee/LICENSE`).
Contributions need the CLA (`CONTRIBUTING.md`, `CLA.md`).
