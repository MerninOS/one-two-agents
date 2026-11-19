# Tenancy: one database, many businesses

Design: OPERATOR architecture https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj (approved by the owner,
Nov 17 2026). Build Board: Orders 120 (epic) to 128. This file covers slice 1 (card 121) and grows
with each slice.

OPERATOR will run many businesses on one deployment (Cloud) and one business on a self-hosted box.
A business is an **org** (a row in `orgs`). Every row in every table belongs to exactly one org, and
code can only read or write the rows of the org it is working for.

Words: "org" here means the business that owns the data. It is not the org chart
(`core/org.ts`, departments and seats) or the org switch (`policies.org`, which puts the crew on
duty). Those keep their names; inside one business they still mean what they meant.

Slices: 1 org id on every table, 2 people and roles, 2b the database refuses other orgs' rows, 3 queue and workers,
4 vault keys per org, 5 the business into a template pack, 6 traces and usage, 7 monorepo and
self-host, 8 paid layer.

## Slice 1: org id on every table

The business becomes the first org, the **home org**, with a fixed id
(`HOME_ORG_ID` in `core/tenancy.ts`). Nothing changes for the business: every agent, page and approval
works as before.

### Database (`20261202090000_orgs.sql`)

| Change | Detail |
|---|---|
| `orgs` | `id` uuid, `slug` (unique), `name`, `created_at`. RLS on, like every table. One row: the business, the home org. |
| `org_id` on every table | `uuid not null references orgs`, backfilled to the home org, then the default is dropped, so an insert that forgets the org fails instead of landing in the wrong business. Indexed. |
| Keys that were names | Ids that people or code choose (agent ids like `cfo`, department ids, connection ids like `mercury`, custom server ids, policy keys, chain firings, KPI dates, tax years, suppressed emails) become unique per org: the primary key now starts with `org_id`. |
| Unique rules | Per org: one active spec and one approved playbook per agent, one active crew flow, one open action per tool and target, one company seat, one head per department, one seat per agent, a lead's domain, a Mercury transaction, a vendor's Mercury recipient, a plan per department and week, a connector request per service. |
| Links to agents and departments | Every foreign key to `agents` or `departments` now includes `org_id`, so a row can never point at another business's agent or department. "Set null" links clear only the agent or department column, never the org. |
| Left as they are | Links to rows with random uuid ids (runs, actions, approvals, memories) stay single-column; uuids don't collide, and slice 2 adds row-level security on top. Receipt files keep their paths for now; per-org file paths come with slice 4. |

### Code

- **One scoped client.** `db()` (`core/db.ts`) returns the Supabase client wrapped by
  `scopeClient` (`core/tenancy.ts`). For every table it adds `org_id = <current org>` to each
  select, update and delete, sets `org_id` on each inserted or upserted row, and puts `org_id` in
  front of an upsert's conflict columns. It refuses a row or update naming a different org, a
  table that isn't in `TENANT_TABLES`, and `rpc`. `orgs` reads only the current org's row and can't
  be written through it. Call sites didn't change: they already went through `db()`.
- **Current org.** `currentOrgId()` is the org set by `withOrg(id, fn)` for the work inside `fn`
  (async-safe), or the home org when none is set. In slice 1 nothing calls `withOrg` yet, so
  everything runs as the business, exactly as today. Slice 2 sets it from the signed-in member, slice 3
  from each job.
- **Only one place makes a client.** Lint refuses `@supabase/supabase-js` anywhere but
  `core/db.ts`, so nothing can skip the scoping.
- **`npm run check:tenancy`** tests the scoping with a fake client (each verb, refusals, conflict
  columns, `withOrg` nesting), checks that every table created in `supabase/migrations` is in
  `TENANT_TABLES` (or is `orgs`), and fails on any migration after this one that creates a table
  without an `org_id` column.

### Rolling it out

The new code writes `org_id` and the migration makes it required, so they go out together while
the org switch is off: apply the migration, then merge right away. In the minutes between, the old
code still reads fine but its writes fail (no `org_id`), and nothing runs on its own while the org is
off. The migration was run on a fresh Postgres built from every migration in this folder, including
a check that a second org can have its own `cfo` and that a run can't point at another org's agent.

### Rules that apply

Every hard rule in CLAUDE.md is unchanged. New one: every table has `org_id`, and every query goes
through the scoped `db()`.

### Done when

The migration is applied, every table has a non-null `org_id`, `check:tenancy`, `check` and `build`
pass, and the business's dry runs, pages and approvals behave as before.

### Not in this slice

Sign-in per person and row-level security policies (slice 2), passing the org through the queue
(slice 3), vault keys and file paths per org (slice 4), moving the business's coffee code out (slice 5).

## Slice 2: people and roles

The shared password goes. Each person signs in as themselves with a link emailed to them, belongs
to an org as a **member**, and has a role. What they can do follows from the role, checked on the
server for every page and every action. Approvals, cap changes and the org switch record who did
them. Row-level security policies come in slice 2b, so this slice doesn't change how queries run.

### Roles

| Role | Can |
|---|---|
| Viewer | See every page. Change nothing. |
| Approver | Everything a viewer can, plus: approve or reject cards, apply approved actions, react and teach (memory lines), dry runs and previews, chat with Avery, mark a plan job done, and every stop: take an agent off duty, turn the org off, pause a server, add an address that gets no email. |
| Owner | Everything: real runs, schedules and the crew flow, turning the org on, caps, vendors, the builder, Connections, goals, the org chart, proposals, and People. At least one owner always remains. |

`DASHBOARD_CONTROLS` still gates what it gated (real runs, raising budgets and caps, turning the
org on): a role says who may, Controls says whether this deployment allows it at all.

### Sign-in

1. **Sign in** asks for an email. If it belongs to a member, Supabase Auth emails a one-time link;
   the page says "Check your email" either way, so it never tells anyone who is a member.
2. The link opens `/auth/confirm`, a page with one button. The tap checks the one-time code with
   Supabase, finds the member, sets a signed session cookie (30 days, `SESSION_SECRET`, at least 32
   characters) and opens the page they asked for. A button rather than the link itself, so a mail
   scanner that opens links can't use up the code.
3. Every page and action reads the member again from the cookie, so a removed member or a changed
   role takes effect on their next click.

**First owner.** When the org has no members yet, the address in `OPERATOR_OWNER_EMAIL` becomes its
owner on first sign-in. After that, owners add people on Settings > People.

Only invited emails get a link: an auth user is created when a member first signs in, never for an
unknown address. The Supabase client used for sign-in is separate from `db()`, so a sign-in can
never swap the service key for a person's token.

### Code

- `core/roles.ts` (pure): the roles, `atLeast`, the last-owner rule, safe redirects after sign-in.
- `core/members.ts`: the current org's members through `db()`, including the first-owner rule.
- `dashboard/session.ts`: the cookie names a member id, signed with `SESSION_SECRET`.
- `dashboard/data.ts`: `requireSession()` returns the signed-in member (read again every request);
  `asRole("approver" | "owner")` is the first line of every server action and returns a refusal for
  a lower role. The connect and callback routes on Connections check for an owner.
- `core/actor.ts`: `withActor(email, fn)` so memory changes, playbook approvals and Avery's saved
  rules record who did them. Approvals, caps, the org switch, flow versions and vendors take the
  member's email directly.
- `core/db.ts` `authApi()`: Supabase Auth only, a fresh client each call, apart from `db()`.
- `npm run check:roles` tests the rules and the session cookie, and fails if any server action
  doesn't check a role.

### Database (`20261203090000_members.sql`)

`members`: `id`, `org_id`, `email` (lowercase, unique per org), `user_id` (the Supabase Auth user,
unique per org, set on first sign-in), `role` (owner, approver, viewer), `added_by`, `created_at`,
`last_sign_in_at`. A tenant table like every other.

### Setup (the owner, once)

1. Vercel: add `SESSION_SECRET` (`openssl rand -base64 32`) and `OPERATOR_OWNER_EMAIL` (your email).
   Delete `DASHBOARD_PASSWORD`.
2. Supabase, Authentication > URL Configuration: Site URL `https://<your app>`;
   Redirect URLs `https://<your app>/auth/confirm` and
   `https://<project>-*-<team>.vercel.app/auth/confirm` (previews).
3. Supabase needs custom SMTP before its email templates can be edited. Use Resend (already used
   for the brief): a Resend API key with sending access only; Supabase, Authentication > Emails >
   SMTP Settings: host `smtp.resend.com`, port 465, username `resend`, password the key, sender on
   the brief's verified domain.
4. Supabase, Authentication > Emails > Magic Link: the link must carry the one-time code to our
   page: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in to the Control Room</a>`.

### Rolling it out

Order matters, or nobody can sign in: apply the migration, do the setup above, then merge. The first
sign-in after the deploy makes `OPERATOR_OWNER_EMAIL` the owner. The old password cookie stops
working on deploy (new cookie name and secret). The migration was run on the local Postgres built
from every migration (unique email per org, lowercase only, roles checked, org required).

Sign-in emails go through Resend SMTP; Supabase's own rate limit (Authentication > Rate Limits) still applies.

### Not in this slice

Row-level security policies and reading as the signed-in person (slice 2b), choosing between
several orgs (when a second org exists), SSO (paid layer).

## Slice 2b: the database refuses other orgs' rows

Slice 1 keeps each org to its rows in code (`db()`). This slice adds a second lock in the database:
even a bug in app code can't read or write another business's rows.

### How

- **Policies** (`20261204090000_org_policies.sql`): every tenant table gets `org_rows`, for role
  `authenticated`: a row is visible and writable only when its `org_id` equals the `org_id` claim of
  the request's token (`public.jwt_org_id()`). `orgs` gets `org_self` (read your own row only). A
  token without the claim, such as a person's own Supabase session or the anon key, reaches nothing.
- **Org tokens** (`core/org-token.ts`): for each org, a token (ES256, 1 hour, role
  `authenticated`, `org_id` and `sub` set to the org) signed with our own key, which is imported into
  Supabase as its signing key. A fresh one is made 5 minutes before the old one expires.
- **`db()`**: when `SUPABASE_SIGNING_KEY` and `SUPABASE_PUBLISHABLE_KEY` are set, `from(table)` goes
  through the current org's own client, which sends that org's token. The code's scoping still
  applies on top. Files (storage) and sign-in (`authApi()`) stay on the service role; per-org file
  paths come with slice 4.
- **Off until set.** Without the two settings, tables use the service role exactly as before, so
  merging changes nothing. Settings shows **Database lock: On / Off**.
- **`npm run check:tenancy`** also checks that every tenant table has a policy holding it to
  `jwt_org_id()` (a new table needs one in its own migration), that org tokens verify and carry
  the right claims, and that tables go through the org's client while storage doesn't.

Tested on a local Postgres built from every migration: with org B's token, org A's rows can't be
read, inserted, updated, moved to another org or deleted; no claim or a malformed claim reads
nothing; the home org's token sees exactly its own rows. The live database already grants
`authenticated` the table privileges the policies need.

### Setup (the owner, once)

1. Make the key: in Terminal, `npx supabase gen signing-key --algorithm ES256`. It prints a JSON
   key with a `kid`. Keep it secret.
2. Supabase, Project Settings > JWT Keys: create a standby key by importing that JSON, then
   **Rotate keys** so it becomes the current key. Existing sign-ins keep working.
3. Vercel: add `SUPABASE_SIGNING_KEY` (the whole JSON) and `SUPABASE_PUBLISHABLE_KEY` (Project
   Settings > API Keys, the publishable key). Redeploy.
4. Settings in the Control Room shows **Database lock: On**.

To turn it off, delete the two Vercel settings and redeploy. The policies stay; the service role
ignores them.

### Not in this slice

Reading as the signed-in person (pages use the org token, and the role check in code decides what
a person may do); per-org storage paths (slice 4).

## Slice 3: a job queue, a scheduler and workers

Work that runs on its own (a chain's steps today) is a job: a row in `jobs`, picked up by a worker
request that runs it as the job's org. One scheduler serves every org.

### How

- **Jobs** (`20261205090000_jobs.sql`): `org_id`, `kind` (only `chain_step` so far), `payload`
  (a chain step names a chain and a step of the saved flow, nothing else), `dedupe_key` (one job
  per step of a chain), `run_after` (a step waiting for "not before 6:45" is a job due then),
  `claimed_at`, `done_at` or `failed_at`, `outcome` in words, and the `run_id`. A plain table, not
  pgmq: it carries `org_id` and the `org_rows` policy like every table and runs on any Postgres.
  `chain_waits` is gone (it never had a row).
- **Enqueue** (`core/jobs.ts`, `startStep` in `core/chain.ts`): a chain step is enqueued as the
  current org and, unless it waits for a time, kicked straight away.
- **Kick**: a signed request to `/api/jobs/<id>?org=<org>` (`CRON_SECRET` bearer). It resolves in
  seconds, not when the work ends.
- **Worker** (`app/api/jobs/[id]`): runs as `?org`, so the job is read through `db()` scoped to
  that org and, with the database lock on, with that org's token: a job of another org can't be
  claimed whatever the request says. It claims the job with a conditional update (a job runs once
  however often it is kicked), answers, then runs it after the answer in its own 300 s limit:
  reads the saved flow, checks the chain and the org are on (or the chain was started with Run
  chain), runs the agent through `withRun`, enqueues the next step, and records the outcome.
- **Scheduler** (`app/api/dispatch`, Vercel Schedule `dispatch`, every 15 minutes as before (this Vercel plan runs schedules up to 15 minutes late, so it can't be more often; a step that starts now is kicked straight away, so only a step waiting for a time waits on it)): for each org in
  turn (`allOrgIds()` in `core/db.ts`, the only read across orgs: ids only), as that org: starts the
  chains whose time came (`chain_fires`, unchanged), marks failed the jobs claimed more than 6
  minutes ago that never finished (not retried: a run may have half happened), and kicks the jobs
  that are due (a waiting step whose time came, or one whose kick was lost).
- **Unchanged**: the Run button and Try still run inline; chains still never turn an agent on; the
  agent route now refuses `trigger=chain`, so steps run only as jobs.
- **`npm run check:jobs`** checks the payload rules (only a chain's own fields survive), the dedupe
  key, that a job is called stale only after the worker's limit, and that the table's kinds match
  the code.

Tested on a local Postgres: a second job with the same key in an org is refused, a bad kind or a
non-object payload is refused, a job is claimed once, and an org's token can't see, claim or update
another org's job.

### Setup (the owner, once)

Apply `20261205090000_jobs.sql` (Supabase SQL editor) before merging. While the org is off nothing starts on its own, so the
scheduler finds nothing to do.

### Not in this slice

Retries with backoff, a Jobs view in the Control Room, other kinds of job (agent schedules that
aren't chains, inbound email), per-org concurrency limits, and workers outside Vercel functions.

## Slice 4: each org's own vault key

One `MCP_SECRET_KEY` used to seal every sign-in. Now each org has its own data key, so one org's
key opening can't open another org's sign-ins, and an org can be removed cleanly.

### How

- **Data key** (`newDataKey` in `core/vault.ts`): 32 random bytes per org, made the first time the
  org saves a sign-in. Never made from another secret.
- **Kept wrapped** (`20261206090000_org_keys.sql`): `org_keys` holds one row per org with the data
  key wrapped, its short id and which wrapping key wrapped it. The table has `org_id` and the
  `org_rows` policy like every table. The wrapping key never lives in the database.
- **Wrapping key** (`KeyWrapper`): `envWrapper` makes it from `MCP_SECRET_KEY` under its own label,
  so it is never the key a sign-in is sealed with. The interface is async so a cloud KMS key can
  stand in later (ee). The wrapped key is bound to its org: org 2 can't unwrap org 1's.
- **Sign-ins** (`integrations/mcp.ts`): sealed with the org's data key and bound to the org
  (`v3.<key id>.…`, the org id checked by AES-GCM), so a row copied to another org opens for
  nobody. Sign-ins sealed before this slice (`v2`, under `MCP_SECRET_KEY`) still open, and move onto
  the org's key the next time they are read, or all at once with **Re-lock now** on Connections.
  The short-lived sign-in cookie stays on `MCP_SECRET_KEY` (it never reaches the database).
- **Changing `MCP_SECRET_KEY`**: same steps as before (docs/mcp-everywhere.md). The data key is
  rewrapped with the new key when read or on Re-lock; the sign-ins don't need re-sealing.
- **Removing an org**: delete its `org_keys` row and every sign-in it saved is unreadable.
- **`npm run check:mcp`** checks that another org's data key, or the right key used for another
  org, opens nothing; that a wrapped key unwraps only for its org and only with its wrapping key;
  that the plain data key is never stored; and that every place `integrations/mcp.ts` stores a
  sign-in seals it with the org's key.

Tested on a local Postgres: one data key per org, a plain (unwrapped) key is refused, and org 2's
token can't see, change or add org 1's key.

### Setup (the owner, once)

Apply `20261206090000_org_keys.sql` (Supabase SQL editor) before merging. After the deploy, open
Connections and tap **Re-lock now** once: every sign-in moves onto the business's own key. Nothing to
change in Vercel.

### Not in this slice

A cloud KMS wrapper (ee, when Cloud picks one), rotating an org's data key itself, deleting an
org from the Control Room.

## Slice 8.1: every org signs in as itself

Design: OPERATOR paid layer (ee) https://claude.ai/artifact/SnFw9BuTseFBXToakPsGBU, slice 1 (core,
open source). Until now only the home org could sign in: the Control Room ran every page as the
home org. Now a member of any org signs in to their own org, and a person in several orgs picks one.

### The session names the org

The session cookie (`core/session.ts`) is `v3.<member id>.<org id>.<expiry>`, signed with
`SESSION_SECRET`. A `v2` cookie from before (member id only) still works and means the home org, so
nobody is signed out by the change. Every page and action reads the member again inside the org
the cookie names (`memberFromCookie` runs `memberById` in `withOrg`), so a member removed from that
org is out on their next click.

### A request's org

`orgId()` (`core/tenancy.ts`) is the org the current work is for: the one `withOrg` set; else, in a
Control Room request, the org the session cookie names (`core/request-org.ts`, registered by
`core/db.ts`); else the home org (the scheduler's own calls, scripts, signed-out pages, as before).
It is async because the cookie is read with `cookies()`. There is no synchronous guess any more:
`currentOrgId()` is gone, since outside `withOrg` it would have been the home org for another org's
member. `check:tenancy` fails if one of the files that used it reads the org another way.

`db()` reads the org when `from()` is called. Inside `withOrg` it scopes at once, as before. Inside a
request without one, the query is recorded and scoped when it is awaited, after the org is read
from the cookie, so call sites keep writing `await db().from(...)...`. Work that outlives the
request (a real run started from the Control Room, chains after an approval) captures
`await orgId()` and runs inside `withOrg`, never reading the cookie later.

### Signing in

1. **Email link**, as before, but for a member of any org: `membershipsOf(email)` (`core/db.ts`) is
   the one read across orgs at sign-in, on the service role, and returns only member ids, org ids,
   roles and org names. The page still says "check your email" either way.
2. **Sign in with Google**, when Google is turned on as a provider in the Supabase project
   (the login page asks Supabase's public settings). `/auth/google` sends the person to Google
   through Supabase Auth (PKCE, the verifier in a 10-minute httpOnly cookie);
   `/auth/google/callback` trades the code for the verified address. Google only proves the
   address: who may sign in is still the members list.
3. Both end in `finishSignIn` (`dashboard/signin.ts`): each membership is tied to the person's auth
   user, then one org signs in at once, or several go to `/auth/pick` (a signed 10-minute cookie
   listing the memberships; picking checks the choice is in it). `finishSignIn` takes a verified
   address, so it is deliberately not in a `"use server"` file; `check:roles` checks
   `dashboard/authActions.ts` exports only the four sign-in actions.

The first owner (`OPERATOR_OWNER_EMAIL`) is still made only for the home org, while it has no members.

### Setting up Sign in with Google (once per Supabase project)

In Google Cloud, on the app's OAuth client, add the redirect URI
`https://<project>.supabase.co/auth/v1/callback`. In Supabase, Authentication > Sign In / Providers >
Google: turn it on with that client's id and secret. In Authentication > URL Configuration, add
`https://<your Control Room>/auth/google/callback` to Redirect URLs. Keep "Allow new users to sign up"
off: invited members' auth users are made by the app.

### Not in this slice

A switcher between orgs inside the Control Room (sign out and in again for now).

## Slice 8.1b: each org's own settings

Some settings were one value in Vercel for the whole app, though they belong to a business: where
the brief and alerts are emailed (`BRIEF_TO`), the website (`SITE_URL`), the Shopify store and app
client id (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`), the Mercury cash accounts
(`MERCURY_ACCOUNT_IDS`) and the Notion pages reports go under (`NOTION_BRIEF_PARENT_ID`,
`NOTION_BRIEFS_DB_ID`, `NOTION_LEADS_PARENT_ID`, `NOTION_BOOKS_PARENT_ID`). Each org now keeps
its own on **Settings > Where things go** (owners only), stored as the `business_settings` row in
`policies`, so no migration.

- `core/settings-rules.ts` (pure) reads and checks them: an https website, a `.myshopify.com`
  store, Mercury account ids or "all", Notion ids or links (Notion's own links only).
- **The owner email is always one of the org's owners' sign-in addresses**, picked from a list.
  The brief and alerts can never be pointed at someone who couldn't sign in as an owner.
  `integrations/email.ts` still has no recipient argument; it reads the current org's owner email.
- `core/settings.ts` gives the current org's settings. **The Vercel values count only for the
  home org**, as its starting values where it saved none, and never for another org. Code reads
  these settings only through `settings()`; `check:settings` fails on any other file reading
  them from the environment.
- **Alerts for every org.** The scheduler emails each org's alerts to its own owner email; an org
  without one sees them on Status only.

App infrastructure stays in Vercel: Supabase, Claude, Resend and its sender (`BRIEF_FROM`), the
vault key, the app's Google OAuth client, `SHOPIFY_API_VERSION`. The Build Board's
`NOTION_BUILD_BOARD_DB_ID` stays app-wide too.

## Slice 8.1c: each org's own Claude key

Every model call used the app's one `ANTHROPIC_API_KEY`, so every org's agents would have billed
to whoever runs the deployment. Now an owner pastes the business's own Claude API key on
**Connections > Claude API**. It is checked with Anthropic (a read of the model list, no redirects),
sealed in the vault with the org's data key on its own connection row (`anthropic_key`), and
never shown, logged or put in a prompt.

`claude()` (`integrations/anthropic.ts`) is async: it uses the org's own key when there is one;
without one, **only the home org** falls back to the app's key, and any other org's run stops with
a note to paste a key. Managed credits (card 128, slice 4) will let an org with credits use the
app's key, metered. Only `integrations/anthropic.ts` opens the key (`check:mcp`).

## Card 135: no home business

The first org was special in seven places. Each is replaced by something that works the same for
every business, so the first business (and the one this deployment was built for) is an ordinary
customer.

| Before | After |
| --- | --- |
| Settings fell back to `BRIEF_TO`, `SITE_URL`, `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `MERCURY_ACCOUNT_IDS` and the `NOTION_*` page ids for the first org (slice 8.1b). | Every business uses only what it saved on Settings. Those settings are gone from `core/env.ts` and `.env.example`; `check:settings` fails if one comes back. Lead and books run pages still fall back to the briefs page, for every business. |
| The first org's runs fell back to the app's `ANTHROPIC_API_KEY` (slice 8.1c). | Every business uses its own key from the vault, or the run is refused with the same note. The app has no Claude key; managed credits (card 128 slice 4) will add one, metered, through the paid layer. |
| The first org was never billed, by a line in `ee/plan.ts`. | A plan row can be `comped` (migration `20261217090000_comped_plan.sql`): no charge, no limits, and the webhook never writes over it. Any business can be comped. |
| The first org's owners made sign-up codes. | The admin business makes them: `OPERATOR_ADMIN_ORG_ID` (`ee/admin.ts`). Unset, sign-up is closed. |
| A `v2` cookie (slice 8.1) meant the first org. | `v2` cookies are refused; people sign in again. |
| Work with no business named (a script, a call with the cron secret, a signed-out page) ran as the first org. | It is refused: `orgId()` throws `NO_ORG`, and a query outside `withOrg` with nobody signed in never reaches the database. `/api/agents/<id>` and `/api/health` take `?org=<org id>`. Checks run as `TEST_ORG` (`scripts/lib/test-org.ts`). |

`HOME_ORG_ID` is now only the fresh install's first business: the baseline makes its row, and while
an address belongs to no business, `OPERATOR_OWNER_EMAIL` becomes its first owner
(`dashboard/signin.ts`). `check:tenancy` fails on any other use.
