# Tenancy: one database, many businesses

Design: OPERATOR architecture https://claude.ai/artifact/8ec8poMoGrDtE3XY1axWrj (approved by Zak,
Nov 17 2026). Build Board: Orders 120 (epic) to 128. This file covers slice 1 (card 121) and grows
with each slice.

OPERATOR will run many businesses on one deployment (Cloud) and one business on a self-hosted box.
A business is an **org** (a row in `orgs`). Every row in every table belongs to exactly one org, and
code can only read or write the rows of the org it is working for.

Words: "org" here means the business that owns the data. It is not the org chart
(`core/org.ts`, departments and seats) or the org switch (`policies.org`, which puts the crew on
duty). Those keep their names; inside one business they still mean what they meant.

Slices: 1 org id on every table, 2 people and roles, 2b row-level security policies, 3 queue and workers,
4 vault keys per org, 5 One Two into a template pack, 6 traces and usage, 7 monorepo and
self-host, 8 paid layer.

## Slice 1: org id on every table

One Two Coffee Lab becomes the first org, the **home org**, with a fixed id
(`HOME_ORG_ID` in `core/tenancy.ts`). Nothing changes for One Two: every agent, page and approval
works as before.

### Database (`20261202090000_orgs.sql`)

| Change | Detail |
|---|---|
| `orgs` | `id` uuid, `slug` (unique), `name`, `created_at`. RLS on, like every table. One row: One Two Coffee Lab, the home org. |
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
  everything runs as One Two, exactly as today. Slice 2 sets it from the signed-in member, slice 3
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
pass, and One Two's dry runs, pages and approvals behave as before.

### Not in this slice

Sign-in per person and row-level security policies (slice 2), passing the org through the queue
(slice 3), vault keys and file paths per org (slice 4), moving One Two's coffee code out (slice 5).

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

### Setup (Zak, once)

1. Vercel: add `SESSION_SECRET` (`openssl rand -base64 32`) and `OPERATOR_OWNER_EMAIL` (your email).
   Delete `DASHBOARD_PASSWORD`.
2. Supabase, Authentication > URL Configuration: Site URL `https://one-two-agents.vercel.app`;
   Redirect URLs `https://one-two-agents.vercel.app/auth/confirm` and
   `https://one-two-agents-*-astromall.vercel.app/auth/confirm` (previews).
3. Supabase, Authentication > Emails > Magic Link: the link must carry the one-time code to our
   page: `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Sign in to the Control Room</a>`.

### Rolling it out

Order matters, or nobody can sign in: apply the migration, do the setup above, then merge. The first
sign-in after the deploy makes `OPERATOR_OWNER_EMAIL` the owner. The old password cookie stops
working on deploy (new cookie name and secret). The migration was run on the local Postgres built
from every migration (unique email per org, lowercase only, roles checked, org required).

Supabase's built-in mailer sends a few emails an hour, enough for a handful of people. A custom
sender (Resend SMTP in Supabase) can come later.

### Not in this slice

Row-level security policies and reading as the signed-in person (slice 2b), choosing between
several orgs (when a second org exists), SSO (paid layer).
