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
