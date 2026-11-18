// The clean starting migration (card 127, docs/self-host.md): reads a schema-only pg_dump of the
// public schema, taken from a database with every migration applied, and writes the one migration
// a fresh install starts from. No rows from any business: only the schema, the private receipts
// bucket and an empty home org that the owner names on Settings.
//
//   npx supabase start   (applies supabase/migrations to a local database)
//   docker exec supabase_db_<project> pg_dump -U postgres --schema-only --schema=public --no-owner --no-comments \
//     -T public.<pack table> ... postgres | node scripts/baseline.mjs > supabase/baseline/operator_baseline.sql
//
// Leave out each template pack's own tables with -T (the `tables` in templates/<pack>/index.ts): they
// are the pack's, not core's. `npm run check:baseline` fails when the baseline has a table core
// doesn't, or misses one it does.
import { readFileSync } from "node:fs";
import { brandWords } from "./lib/brand.mjs";

const raw = readFileSync(0, "utf8");
const body = raw
  .split("\n")
  .filter((l) => !/^\\(un)?restrict /.test(l))
  .filter((l) => !/^SET transaction_timeout/.test(l))
  // Supabase sets its own default privileges; a migration may not change supabase_admin's
  .filter((l) => !/^ALTER DEFAULT PRIVILEGES /.test(l))
  .filter((l) => !/^-- (Dumped|PostgreSQL database dump)/.test(l))
  .join("\n")
  .replace(/^CREATE SCHEMA public;$/m, "CREATE SCHEMA IF NOT EXISTS public;")
  // Supabase's default privileges grant everything on a new table or function first, so clear them
  // before the dump's own grants, which then set each one exactly as the migrations left it
  .replace(/^(GRANT )/m, "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;\nREVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;\nREVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role;\n\n$1")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

if (/^(INSERT INTO|COPY) /m.test(body)) throw new Error("the dump has rows in it: take it with --schema-only");
const named = brandWords().find((re) => re.test(body));
if (named || /0e1a7c4e/.test(body)) throw new Error(`the dump names a business (${named ?? "the home org id"}): check the migrations' defaults and checks`);

const HOME = "0e1a7c4e-0001-4000-8000-000000000001";
process.stdout.write(`-- OPERATOR's starting schema: every migration up to this point, squashed, with no business's rows.
-- Made by scripts/baseline.mjs from a schema-only dump; don't edit by hand. New changes go in new
-- migrations after this one.

${body}

-- Receipt files (private): the Bookkeeper's receipts and the gateway's attachments.
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', false) ON CONFLICT (id) DO NOTHING;

-- The home org (HOME_ORG_ID in core/tenancy.ts), empty: the owner names it on Settings and picks a
-- template pack, or starts from nothing, on the Desk. OPERATOR_OWNER_EMAIL becomes its first owner.
INSERT INTO public.orgs (id, slug, name) VALUES ('${HOME}', 'home', 'My business') ON CONFLICT (id) DO NOTHING;
`);
