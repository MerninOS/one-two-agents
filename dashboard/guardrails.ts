import "server-only";
// The Guardrails box (docs/agent-setup.md, slice 6): everything code enforces for one agent, in
// three bands. Crew hard rules (locked), limits for this agent (in code; the daily budget is
// adjustable up to a ceiling), and the crew-wide money and email caps (policies: lower any time,
// raise with a confirm, never past the limit in code). Instructions and standing orders are
// guidance, so they are never here: they live in Thinking and Memory.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { DEFAULT_BUDGET } from "@/core/memory";
import { MAX_INSTRUCTIONS } from "@/core/setup";
import { CAPS, CAP_KEYS, TOOLS, fmtCap, type CapKey } from "@/core/gateway/policy";
import { emailsSentToday, loadCaps, monthSpentUsd } from "@/core/gateway";
import { CANDIDATES, LOOKBACK_DAYS, MAX_PDF_BYTES, MAX_SEARCHES as QUINN_SEARCHES, MAX_SEARCHES_PER_CHARGE } from "@/agents/bookkeeper";
import { MAX_FETCHES, MAX_SEARCHES as ROWAN_SEARCHES, MAX_TURNS } from "@/agents/wholesale-hunter";
import { PER_RUN } from "@/agents/wholesale-hunter/prompt";
import type { CapLine, GuardLine, GuardrailsData } from "./components/GuardrailsEditor";
import { BY_ID, HARD_RULES } from "./crew";
import { requireSession } from "./data";
import { controlsOn } from "./session";

/** The daily budget's ceiling in code (setBudget in dashboard/actions.ts refuses above it). */
export const MAX_DAILY_BUDGET = 50;

const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Per-agent limits enforced in code. Each line names the file or row that enforces it. */
function agentLimits(id: string, p: Record<string, unknown>): GuardLine[] {
  const out: GuardLine[] = [
    { label: "Before every run", value: "Off duty or over today’s budget means the run is skipped and logged at $0", where: "withRun in core/runs.ts" },
    { label: "Memory loaded per run", value: `At most ${num(p.memory_budget_tokens, DEFAULT_BUDGET).toLocaleString("en-US")} tokens`, where: "policies.memory_budget_tokens, every agent" },
  ];
  if (id === "chief_of_staff") out.push(
    { label: "Watch list", value: "At most 5 items in the email", where: "agents/chief-of-staff/email.ts" },
    { label: "Instructions", value: `At most ${MAX_INSTRUCTIONS.toLocaleString("en-US")} characters, after the locked safety block`, where: "MAX_INSTRUCTIONS in core/setup.ts" },
    { label: "Email recipient", value: "One fixed address. The email code has no recipient field", where: "integrations/email.ts, BRIEF_TO in Vercel" },
  );
  if (id === "wholesale_hunter") out.push(
    { label: "Leads per run", value: `At most ${PER_RUN}. The setup can pick fewer (Writes)`, where: "PER_RUN in agents/wholesale-hunter/prompt.ts, the highest the menu offers" },
    { label: "Web searches per run", value: `At most ${ROWAN_SEARCHES}. The setup can pick fewer (Thinking)`, where: "MAX_SEARCHES in agents/wholesale-hunter/menu.ts" },
    { label: "Pages read per run", value: `At most ${MAX_FETCHES}. The setup can pick fewer (Thinking)`, where: "MAX_FETCHES in agents/wholesale-hunter/menu.ts" },
    { label: "Model turns per run", value: `At most ${MAX_TURNS}. The setup can pick fewer (Thinking)`, where: "MAX_TURNS in agents/wholesale-hunter/menu.ts" },
    { label: "Areas and kinds of business", value: "Picked from fixed lists. A web page can’t add one", where: "agents/wholesale-hunter/menu.ts" },
    { label: "Email", value: "Gmail drafts only. Nothing is sent; a first email to a new person always waits for you", where: "integrations/gmail.ts has no send" },
  );
  if (id === "bookkeeper") out.push(
    { label: "Gmail searches per run", value: `At most ${QUINN_SEARCHES}, ${MAX_SEARCHES_PER_CHARGE} per charge, ${CANDIDATES} candidates each. The setup can pick fewer (Reads)`, where: "agents/bookkeeper/menu.ts" },
    { label: "Receipt PDFs", value: `Up to ${(MAX_PDF_BYTES / 1e6).toFixed(0)} MB`, where: "MAX_PDF_BYTES in agents/bookkeeper/index.ts" },
    { label: "Charges looked at", value: `At most the last ${LOOKBACK_DAYS} days. The setup can pick fewer (Reads)`, where: "LOOKBACK_DAYS in agents/bookkeeper/menu.ts" },
  );
  if (id === "cfo") out.push({ label: "Method", value: "Plain code. No model is called, so nothing is estimated", where: "agents/cfo/index.ts" });
  const tools = Object.entries(TOOLS).filter(([, t]) => (t.agents as readonly string[]).includes(id));
  if (tools.length) out.push(
    { label: "Gateway actions", value: tools.map(([k, t]) => `${k}, ${t.tier}: every one waits for your approval`).join("; "), where: "TOOLS in core/gateway/policy.ts. Trust levels aren’t editable here" },
    { label: "Mercury writes per apply", value: `At most ${num(p.max_mercury_writes_per_run, 20)}`, where: "policies.max_mercury_writes_per_run, read by the gateway" },
    { label: "Memo length", value: `At most ${num(p.mercury_memo_max_chars, 200)} characters, no links`, where: "policies.mercury_memo_max_chars, refuseProposal in core/gateway/policy.ts" },
    { label: "Approvals expire", value: `After ${num(p.approval_expiry_hours, 72)} hours unreviewed`, where: "policies.approval_expiry_hours" },
  );
  return out;
}

/** The crew-wide caps with what is used; null with a problem when the policies can't be read. */
export async function capLines(now = new Date()): Promise<{ caps: CapLine[] | null; problem?: string; log: GuardrailsData["log"] }> {
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

/** The Guardrails box for one built agent. */
export async function getGuardrails(agentId: string, dailyBudget: number | null): Promise<GuardrailsData> {
  await requireSession();
  const { data } = await db().from("policies").select("key, value_json").in("key", ["memory_budget_tokens", "max_mercury_writes_per_run", "mercury_memo_max_chars", "approval_expiry_hours"]);
  const p = Object.fromEntries((data ?? []).map((r) => [r.key, r.value_json]));
  const c = await capLines();
  return {
    agentId, agentName: BY_ID[agentId]?.name ?? agentId, hardRules: HARD_RULES, limits: agentLimits(agentId, p),
    budget: dailyBudget == null ? null : { current: dailyBudget, max: MAX_DAILY_BUDGET },
    caps: c.caps, capsProblem: c.problem && /policy_log|relation/.test(c.problem) ? "The caps migration (20261112230000_caps_and_vendors.sql) isn’t applied yet." : c.problem,
    log: c.log, controls: controlsOn(),
  };
}
