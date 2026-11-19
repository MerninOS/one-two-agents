// Where the checks find the schema. This repo keeps its whole migration history in
// supabase/migrations; an exported copy ships only the starting migrations (docs/self-host.md), so a
// check that reads one history file skips it there, and check:baseline checks the same thing in the
// baseline instead.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS = "supabase/migrations";
/** True when supabase/migrations holds the history (the tenancy migration is the marker). */
export const hasHistory = existsSync(join(MIGRATIONS, "20261202090000_orgs.sql"));
/** One history file's SQL, or null in a repo with no history. */
export const migration = (file: string): string | null => (hasHistory ? readFileSync(join(MIGRATIONS, file), "utf8") : null);

/** The starting migration: supabase/baseline here, the first migration in the public repo. */
export const BASELINE = existsSync("supabase/baseline/operator_baseline.sql")
  ? "supabase/baseline/operator_baseline.sql"
  : join(MIGRATIONS, readdirSync(MIGRATIONS).filter((f) => f.endsWith("_operator_baseline.sql")).sort()[0] ?? "missing_operator_baseline.sql");

/** The paid layer's tables (ee/, docs/extensions.md): named ee_*, made by their own file after the baseline. */
export const isEeTable = (t: string) => t.startsWith("ee_");

/** The paid layer's tables: supabase/baseline here, the second migration in the public repo (card 136). */
export const EE_TABLES = existsSync("supabase/baseline/ee_tables.sql")
  ? "supabase/baseline/ee_tables.sql"
  : join(MIGRATIONS, readdirSync(MIGRATIONS).filter((f) => f.endsWith("_ee_tables.sql")).sort()[0] ?? "missing_ee_tables.sql");
