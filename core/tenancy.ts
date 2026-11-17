// Tenancy (docs/tenancy.md, slice 1): every row belongs to an org, and code reads and writes only
// the rows of the org it is working for. Pure apart from AsyncLocalStorage: no database, no env,
// so `npm run check:tenancy` can test it with a fake client.
//
// "Org" here is the business that owns the data, not the org chart (core/org.ts) or the org
// switch (core/org-switch.ts).
import { AsyncLocalStorage } from "node:async_hooks";

/** One Two Coffee Lab, the first org (supabase/migrations/20261202090000_orgs.sql). */
export const HOME_ORG_ID = "0e1a7c4e-0001-4000-8000-000000000001";

/**
 * Every table that holds a business's data. Each has `org_id uuid not null`. A table missing
 * here can't be reached through db(); `check:tenancy` fails when a migration creates a table
 * that isn't listed.
 */
export const TENANT_TABLES = [
  "agent_actions", "agent_defs", "agent_memory", "agent_outputs", "agent_playbook_holds", "agent_playbooks",
  "agent_runs", "agents", "approvals", "avery_chat", "chain_fires", "connector_requests",
  "crew_flow", "departments", "email_suppressions", "expense_docs", "goals", "home_office", "jobs", "kpi_snapshots",
  "mcp_connection_events", "mcp_connections", "mcp_custom_servers", "members", "memory_events", "plans", "policies",
  "policy_log", "proposals", "reactions", "run_steps", "seats", "tax_packets", "trips", "vendors", "wholesale_leads",
] as const;
/** The orgs themselves: readable (only the current one), never written through db(). */
export const ORGS_TABLE = "orgs";

const tenant = new Set<string>(TENANT_TABLES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const store = new AsyncLocalStorage<string>();

/** Runs `fn` as the given org: every db() call inside it, sync or async, is scoped to that org. */
export function withOrg<T>(orgId: string, fn: () => T): T {
  if (!UUID.test(orgId)) throw new Error("withOrg needs an org id (a uuid).");
  return store.run(orgId, fn);
}

/** The org the current work is for: set by withOrg, else the home org (one business per deployment until slice 2). */
export const currentOrgId = (): string => store.getStore() ?? HOME_ORG_ID;

/** An upsert's conflict columns with org_id in front, since every key that names a row is unique per org. */
export function conflictColumns(onConflict: string | undefined): string | undefined {
  if (onConflict === undefined) return undefined;
  const cols = onConflict.split(",").map((c) => c.trim()).filter(Boolean);
  return cols.includes("org_id") ? cols.join(",") : ["org_id", ...cols].join(",");
}

type Row = Record<string, unknown>;

/** A row with the org set. A row naming another org is refused, never moved. */
export function stampRow(row: unknown, orgId: string): Row {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Rows must be objects.");
  const r = row as Row;
  if ("org_id" in r && r.org_id !== orgId) throw new Error("Refused: a row for another org.");
  return { ...r, org_id: orgId };
}

export function stampRows(rows: unknown, orgId: string): Row | Row[] {
  return Array.isArray(rows) ? rows.map((r) => stampRow(r, orgId)) : stampRow(rows, orgId);
}

/**
 * An update's values without org_id: a row read back and saved again carries its own org, which
 * is dropped; any other org is refused, since a row's org never changes.
 */
export function updateValues(values: unknown, orgId: string): Row {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Update values must be an object.");
  const { org_id, ...rest } = values as Row;
  if (org_id !== undefined && org_id !== orgId) throw new Error("Refused: a row's org can't be changed.");
  return rest;
}

/** The shape of the parts of a Supabase client the scoping touches. */
interface FilterLike { eq(column: string, value: unknown): unknown }
type Fn = (...args: unknown[]) => unknown;

/**
 * Wraps one table's query builder: select, update and delete get `org_id = org`; insert and
 * upsert stamp each row; upsert conflict columns start with org_id. Anything else (none is used
 * today) passes through unchanged.
 */
function scopeTable<Q extends object>(qb: Q, table: string, orgId: string): Q {
  const isOrgs = table === ORGS_TABLE;
  return new Proxy(qb, {
    get(target, prop, receiver) {
      const call = (name: string) => (Reflect.get(target, name, receiver) as Fn).bind(target);
      switch (prop) {
        case "select":
          return (...args: unknown[]) => (call("select")(...args) as FilterLike).eq(isOrgs ? "id" : "org_id", orgId);
        case "insert":
        case "upsert":
        case "update":
        case "delete":
          if (isOrgs) return () => { throw new Error("Refused: orgs are not written through db()."); };
      }
      switch (prop) {
        case "insert":
          return (rows: unknown, opts?: unknown) => call("insert")(stampRows(rows, orgId), opts);
        case "upsert":
          return (rows: unknown, opts?: { onConflict?: string } & Row) =>
            call("upsert")(stampRows(rows, orgId), { ...opts, onConflict: conflictColumns(opts?.onConflict) });
        case "update":
          return (values: unknown, opts?: unknown) => (call("update")(updateValues(values, orgId), opts) as FilterLike).eq("org_id", orgId);
        case "delete":
          return (opts?: unknown) => (call("delete")(opts) as FilterLike).eq("org_id", orgId);
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as Fn).bind(target) : v;
    },
  });
}

/**
 * The client db() hands out: `from(table)` is scoped to the current org (read when `from` is
 * called) and, given `tablesFor`, goes through that org's own client; a table outside TENANT_TABLES and orgs is refused, and `rpc` is refused (no database
 * functions exist; one would skip the scoping). Storage and the rest pass through.
 */
export function scopeClient<C extends object>(client: C, orgOf: () => string = currentOrgId, tablesFor?: (orgId: string) => C): C {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) => {
          if (!tenant.has(table) && table !== ORGS_TABLE) throw new Error(`Refused: "${table}" isn't a tenant table (core/tenancy.ts TENANT_TABLES).`);
          const org = orgOf();
          // slice 2b: tables through the org's own client (a token the database holds to that org) when there is one
          const via = tablesFor ? tablesFor(org) : target;
          const qb = (Reflect.get(via, "from") as Fn).call(via, table) as object;
          return scopeTable(qb, table, org);
        };
      }
      if (prop === "rpc" || prop === "schema") return () => { throw new Error(`Refused: ${String(prop)}() skips org scoping.`); };
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? (v as Fn).bind(target) : v;
    },
  });
}
