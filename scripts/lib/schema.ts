// Where the checks find the schema. This repo keeps its whole migration history in
// supabase/migrations; the public repo ships only the starting migration (docs/self-host.md), so a
// check that reads one history file skips it there, and check:baseline checks the same thing in the
// baseline instead. Pack tables (templates/<pack>/index.ts) are a pack's own and stay out of the baseline.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/** The paid layer's tables (ee/, docs/extensions.md): named ee_*, never in the public baseline. */
export const isEeTable = (t: string) => t.startsWith("ee_");

/** Every template pack folder (one with an index.ts). There may be none. */
export const packDirs = (): string[] =>
  readdirSync("templates").filter((d) => statSync(join("templates", d)).isDirectory() && existsSync(join("templates", d, "index.ts")));

/** A pack's own tables, from its index.ts. */
export const packTables = (dir: string): string[] =>
  [...readFileSync(join("templates", dir, "index.ts"), "utf8").matchAll(/tables: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]));
