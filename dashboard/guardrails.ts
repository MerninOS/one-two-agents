import "server-only";
// The crew-wide money and email caps (policies), shown and edited on Settings: lower any time,
// raise with a confirm and DASHBOARD_CONTROLS=on, never past the limit in code (setCap in
// dashboard/actions.ts checks every change again). Each agent's own limits are its cost and step
// caps in the builder flow and its daily budget.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { CAPS, CAP_KEYS, fmtCap, type CapDef, type CapKey } from "@/core/gateway/policy";
import { emailsSentToday, loadCaps, monthSpentUsd } from "@/core/gateway";
import { requireSession } from "./data";

export interface CapLine extends CapDef { key: CapKey; value: number; missing: boolean; used: string }
export interface CapLog { key: string; from: number | null; to: number; by: string; at: string }

/** The crew-wide caps with what is used; null with a problem when the policies can't be read. */
export async function capLines(now = new Date()): Promise<{ caps: CapLine[] | null; problem?: string; log: CapLog[] }> {
  await requireSession();
  if (!env.supabaseUrl || !env.supabaseServiceKey) return { caps: null, log: [], problem: "Supabase isn’t set up, so the caps can’t be read." };
  try {
    const [caps, spent, sent, log] = await Promise.all([
      loadCaps(), monthSpentUsd(now).catch(() => null), emailsSentToday(now).catch(() => null),
      db().from("policy_log").select("key, old_value, new_value, changed_by, created_at").order("created_at", { ascending: false }).limit(10),
    ]);
    const used: Record<CapKey, string> = {
      max_purchase_usd: "No payment action exists yet, so nothing has been paid",
      max_monthly_spend_usd: spent == null ? "Can’t read payments" : `${fmtCap("max_monthly_spend_usd", spent)} sent this month`,
      max_emails_per_day: sent == null ? "Can’t read emails" : `${sent} sent today${sent === 0 ? " (no email action exists yet)" : ""}`,
      undo_window_minutes: "Used once an action type reaches the middle trust level. None has yet",
    };
    return {
      caps: CAP_KEYS.map((k) => ({ key: k, ...CAPS[k], value: caps[k].value, missing: caps[k].raw == null, used: used[k] })),
      log: (log.data ?? []).map((r) => ({ key: r.key, from: r.old_value == null ? null : Number(r.old_value), to: Number(r.new_value), by: r.changed_by, at: r.created_at })),
    };
  } catch (e) {
    return { caps: null, log: [], problem: e instanceof Error ? e.message : String(e) };
  }
}
