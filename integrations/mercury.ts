import "server-only";
// Mercury, read-only (business org token). Agents never move money: no transfer,
// payment or card endpoint is ever called from this repo.
import { round2 } from "@/domain/coffee";
import { env } from "@/core/env";

/** Available balance across the accounts MERCURY_ACCOUNT_IDS names ("all" = every non-credit account); null when not set up. */
export async function mercuryCash(): Promise<number | null> {
  const ids = env.mercuryAccountIds;
  if (!env.mercuryToken || !ids.length) return null;
  const res = await fetch("https://api.mercury.com/api/v1/accounts", { headers: { Authorization: `Bearer ${env.mercuryToken}`, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Mercury ${res.status}`);
  const j = await res.json() as { accounts: { id: string; availableBalance: number; status: string; kind?: string; isCredit?: boolean }[] };
  const all = ids.length === 1 && ids[0].toLowerCase() === "all";
  const ours = all
    ? j.accounts.filter((a) => a.status !== "archived" && a.status !== "deleted" && !a.isCredit && a.kind !== "creditCard")
    : j.accounts.filter((a) => ids.includes(a.id));
  if (!all && ours.length !== ids.length) throw new Error("Mercury: an account in MERCURY_ACCOUNT_IDS was not found");
  return round2(ours.reduce((s, a) => s + Number(a.availableBalance || 0), 0));
}

// ---- Transactions and categories, for the Bookkeeper. GET only, like everything above.

const mercuryGet = async <T>(path: string): Promise<T> => {
  if (!env.mercuryToken) throw new Error("MERCURY_API_TOKEN is not set");
  const res = await fetch(`https://api.mercury.com/api/v1${path}`, { headers: { Authorization: `Bearer ${env.mercuryToken}`, Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Mercury ${res.status} on ${path.split("?")[0]}`);
  return res.json() as Promise<T>;
};

export const hasMercury = () => !!env.mercuryToken;

export interface MercuryTxn {
  id: string;
  accountId?: string;
  amount: number;                 // negative = money out
  status: string;                 // pending | sent | cancelled | failed | reversed | blocked
  kind?: string;
  postedAt?: string | null;
  createdAt?: string;
  counterpartyName?: string | null;
  counterpartyNickname?: string | null;
  bankDescription?: string | null;
  note?: string | null;
  mercuryCategory?: string | null;
  categoryData?: { id: string; name: string } | null;
  attachments?: { fileName?: string; url?: string; attachmentType?: string }[];
}

/** Every settled transaction posted between two dates (YYYY-MM-DD), across all accounts the token sees. */
export async function mercuryTransactions(postedStart: string, postedEnd: string): Promise<MercuryTxn[]> {
  const out: MercuryTxn[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ postedStart, postedEnd, limit: "500", order: "asc", status: "sent" });
    if (after) q.set("start_after", after);
    const j: { transactions: MercuryTxn[]; page?: { nextPage?: string | null } } = await mercuryGet(`/transactions?${q}`);
    out.push(...(j.transactions ?? []));
    after = j.page?.nextPage ?? null;
    if (!after) break;
  }
  return out;
}

export interface MercuryCategory { id: string; name: string }

/** One Two's custom expense categories in Mercury: the chart of accounts until there is a QuickBooks company. */
export async function mercuryCategories(): Promise<MercuryCategory[]> {
  const j: { categories?: MercuryCategory[] } = await mercuryGet("/categories?limit=1000");
  return (j.categories ?? []).filter((c) => c.id && c.name);
}

/** One transaction by id, live (GET /transaction/{id}); null when Mercury doesn't know it. The gateway re-checks against this before any write. */
export async function mercuryTransaction(id: string): Promise<MercuryTxn | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (!env.mercuryToken) throw new Error("MERCURY_API_TOKEN is not set");
  const res = await fetch(`https://api.mercury.com/api/v1/transaction/${id}`, { headers: { Authorization: `Bearer ${env.mercuryToken}`, Accept: "application/json" }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercury ${res.status} on /transaction`);
  return res.json() as Promise<MercuryTxn>;
}
