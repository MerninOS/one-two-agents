import "server-only";
// Burn rate and runway in plain code, from Mercury's read-only API. Shared by the tool list
// (calc_burn_rate) and the goal measure "Months of runway" (core/measures.ts).
import { round2 } from "@/core/num";
import { chicagoDate } from "@/core/time";
import { mercuryCash, mercuryTransactions } from "@/integrations/mercury";

export interface Burn {
  windowDays: number; transactions: number;
  spendPer30dUsd: number; incomePer30dUsd: number; netBurnPer30dUsd: number;
  cashUsd: number | null;
  /** Months of cash left at the net burn; null when cash isn't set up or nothing is burning. */
  runwayMonths: number | null;
}

export async function burnRate(days: number): Promise<Burn> {
  const [txns, cash] = await Promise.all([mercuryTransactions(chicagoDate(days), chicagoDate(0)), mercuryCash()]);
  // money moving between the business's own accounts is neither spend nor income
  const real = txns.filter((t) => !/internal|treasury/i.test(t.kind ?? ""));
  const out = real.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const inn = real.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const per30 = (x: number) => round2((x / days) * 30);
  const net = per30(out - inn);
  const runway = cash != null && net > 0 ? Math.round((cash / net) * 10) / 10 : null;
  return { windowDays: days, transactions: real.length, spendPer30dUsd: per30(out), incomePer30dUsd: per30(inn), netBurnPer30dUsd: net, cashUsd: cash, runwayMonths: runway };
}
