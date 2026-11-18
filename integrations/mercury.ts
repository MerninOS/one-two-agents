import "server-only";
// Mercury reads (docs/mcp-everywhere.md, slice 5), through Mercury's own MCP server, signed in on
// Connections with the `read` scope only. Agents never move money: this sign-in can't use a write
// tool, and core/mcp-rules.ts names only read tools for it. Amounts are added up in code
// (core/mercury-rules.ts), never by a model.
import { settings } from "@/core/settings";
import { callMcpTool, mcpStatus } from "@/integrations/mcp";
import { MERCURY_UUID, cashOf, readAccounts, readCategories, readOneTxn, readOrgName, readTxnPage, type MercuryCategory, type MercuryTxn } from "@/core/mercury-rules";

export type { MercuryCategory, MercuryTxn } from "@/core/mercury-rules";

/** Whether Mercury is signed in and not paused. */
export async function hasMercury(): Promise<boolean> {
  const s = await mcpStatus("mercury");
  return !!s?.connected && !s.paused;
}

/** Available balance across the accounts Settings names ("all" = every non-credit account); null when not set up. */
export async function mercuryCash(): Promise<number | null> {
  const ids = (await settings()).mercuryAccountIds;
  if (!ids.length || !(await hasMercury())) return null;
  return cashOf(readAccounts(await callMcpTool("mercury", "getAccounts", { limit: 1000 })), ids);
}

const PAGE = 300;

/** Every settled transaction posted between two dates (YYYY-MM-DD), across all accounts the sign-in sees. */
export async function mercuryTransactions(postedStart: string, postedEnd: string): Promise<MercuryTxn[]> {
  const out: MercuryTxn[] = [];
  let after: string | null = null, limit = PAGE;
  for (let call = 0; call < 40; call++) {
    const args: Record<string, unknown> = { postedStart, postedEnd, limit, order: "asc", status: ["sent"], ...(after ? { start_after: after } : {}) };
    const page = readTxnPage(await callMcpTool("mercury", "listTransactions", args));
    // the server matched nothing and dropped the dates: none of these rows are for the asked days
    if (page.datesDropped) return out;
    // the server cut the page: ask again from the same place with what it could send
    if (page.truncatedAt) { limit = page.truncatedAt; continue; }
    out.push(...page.transactions);
    if (!page.next) return out;
    after = page.next;
  }
  throw new Error("Mercury: too many pages of transactions; ask for fewer days");
}

/** the business's custom expense categories in Mercury: the chart of accounts until there is a QuickBooks company. */
export async function mercuryCategories(): Promise<MercuryCategory[]> {
  const out: MercuryCategory[] = [];
  let after: string | null = null;
  for (let call = 0; call < 10; call++) {
    const page = readCategories(await callMcpTool("mercury", "listCategories", { limit: 1000, ...(after ? { start_after: after } : {}) }));
    out.push(...page.categories);
    if (!page.next) break;
    after = page.next;
  }
  return out;
}

/** One transaction by id, live; null when Mercury doesn't know it. The gateway re-checks against this before any write. */
export async function mercuryTransaction(id: string): Promise<MercuryTxn | null> {
  if (!MERCURY_UUID.test(id)) return null;
  try {
    return readOneTxn(await callMcpTool("mercury", "getTransactionById", { transactionId: id }));
  } catch (e) {
    if (/\b404\b|not found/i.test(e instanceof Error ? e.message : String(e))) return null;
    throw e;
  }
}

/** The signed-in organization's name, so Connections shows whether it's the business or another org. */
export async function mercuryOrgName(): Promise<string | null> {
  return readOrgName(await callMcpTool("mercury", "getOrganization", {}));
}
