# Contributing to OPERATOR

OPERATOR runs AI agents for small businesses behind hard limits: they read through one tool path,
and anything that sends, pays or posts waits for a person's approval. Contributions are welcome,
inside those limits.

## Before your first pull request

- **Sign the CLA.** CLA Assistant comments on your first pull request with a link; it takes a
  minute (`CLA.md`).
- **Read the hard rules** in `CLAUDE.md`. A pull request that relaxes one is closed, however useful
  it is: no send, pay or post outside the gateway; Shopify stays read-only; tokens live only in the
  vault; every query is scoped to its org.
- `ee/` (the paid layer) takes no outside pull requests.

## Set up

1. Node 22, then `npm ci` and `npm run schemas` once.
2. For a running app, follow `docs/self-host.md` (Supabase locally with `npx supabase start`).
3. Tests need no real accounts: the `check:*` scripts are pure, and the self-host guide's local
   Supabase takes the migrations.

## Checks

Run before you push; CI runs the same on every pull request:

```
npm run check       # typecheck, lint, GraphQL (read-only) validation
npm run check:all   # every check:* script (policy, MCP, tenancy, roles, audit, traces, ...)
npm run build
```

## What helps most

- **Connectors.** A new integration is an MCP server with a profile: see `docs/build-a-connector.md`.
- **Template packs.** A business's crew, tools and tables in one folder: see `docs/templates.md`.
- Issues labelled **good first issue**.

## Review

`CODEOWNERS` names who must review the parts that hold the rules: the gateway, policy, the vault,
the MCP host and the database's row-level security. Keep pull requests small, one change each, with
what you tested in the description.

## Conduct and security

Be kind (`CODE_OF_CONDUCT.md`). Report a vulnerability privately, never in an issue (`SECURITY.md`).
