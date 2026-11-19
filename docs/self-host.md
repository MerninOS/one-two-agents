# Self-hosting OPERATOR

Build Board: Order 127 (Open core 7), slice 1 (licenses and contributor docs: slice 2). Decided (the owner, 2026-11-17): self-host is our app plus
Supabase's own open-source stack, not a rewrite onto bare Postgres. The app uses Supabase for every
table read (PostgREST through `core/db.ts`), email sign-in (Supabase Auth, `dashboard/authActions.ts`)
and receipt files (Supabase Storage), and Supabase's stack is open source and runs anywhere.

## What runs

`docker compose up` (`docker-compose.yml`) runs three of ours against a Supabase project:

| Service | What it is |
| --- | --- |
| `migrate` | Applies `supabase/migrations` in order, each once (`selfhost/migrate.sh`, recorded in `operator_migrations`), then exits. `web` waits for it. |
| `web` | The app image (`Dockerfile`, Next.js standalone): the Control Room, the agent API and the job worker (`/api/jobs/<id>`). |
| `scheduler` | Calls `/api/dispatch` every 15 minutes with `CRON_SECRET` (`selfhost/scheduler.sh`): what Vercel Schedules does on Vercel. |

Supabase itself is either its official self-host stack on your machine
(https://supabase.com/docs/guides/self-hosting/docker) or a Supabase Cloud project.

## Steps

1. **Start Supabase.** Follow Supabase's self-hosting guide (clone their `docker` folder, set its
   `.env`, `docker compose up -d`). Note its API address, service role key and database connection
   string. For trying it out on one machine, the Supabase CLI does the same in one command:
   `npx supabase start`, which prints `API_URL`, `SERVICE_ROLE_KEY` and `DB_URL`.
2. **Settings.** Copy `.env.example` to `.env` and fill in at least:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, from step 1;
   - `DATABASE_URL`, the database connection string from step 1;
   - `CRON_SECRET`, `SESSION_SECRET` and `MCP_SECRET_KEY`: long random strings
     (`openssl rand -base64 32` each); `MCP_SECRET_KEY` wraps every org's vault key, so keep it safe;
   - `APP_URL`, the address people open (default `http://localhost:3000`);
   - for email sign-in, Supabase Auth's SMTP settings in Supabase, and its Site URL set to `APP_URL`.
   Each integration's sign-in is made on Connections later (the token vault), with your own OAuth
   apps where one is needed (Google's client id and secret in `.env`).
3. **Run** `docker compose up -d --build`. The first run applies every migration; later runs apply
   only new ones.
4. **First owner.** Set `OPERATOR_OWNER_EMAIL` to your address: while the org has no members, that
   address becomes its first owner the first time it signs in. Open `APP_URL` and sign in with the
   emailed link.
5. **Name the business and pick a crew.** On Settings, "The business" holds the name, a line about
   it and the owner's name that every agent is told. The Desk of an empty org offers the department
   templates (installed off duty) or an empty start.

## Tested

On 2026-11-17 against a fresh local Supabase stack (CLI 2.122): every migration applied in order
on an empty database and a second run applied none; the app image served the sign-in page, answered
`/api/health` and ran `/api/dispatch`; the scheduler's call went through with the right secret and
reported a failure with a wrong one.

## The starting migration

This repo's `supabase/migrations` are its history and create the business's rows. The public repo
ships one squashed migration instead, `supabase/baseline/operator_baseline.sql`: the same schema
(tables, checks, row level security, policies, grants, functions), the private receipts bucket and
an empty first business called "My business", and no business's rows. `scripts/baseline.mjs` makes it from
a schema-only dump of a database with every migration applied (the steps are in the script), and
`npm run check:baseline` fails when a migration adds or drops a table it doesn't have. 
In the public repo the baseline is the first file in `supabase/migrations`, and later migrations
follow it. Checks that read one file of this repo's history (`check:jobs`, `check:mcp`,
`check:audit`, `check:status`, the history part of `check:tenancy`) skip it there, and
`check:baseline` checks the same things in the baseline (`scripts/lib/schema.ts`).

Tested 2026-11-18: a fresh Supabase database built from the baseline alone dumps byte for byte the
same public schema as one built from every migration, and a starting crew installed into its
empty first business (all off duty) and refused a second install. Since card 134 a new business picks
department templates on the Desk (docs/templates.md).

## Not yet

- Building the image needs network access to npm from inside Docker.
- Alert emails go to each business's owner email (Settings > Where things go).
