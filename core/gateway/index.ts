import "server-only";
// The tool gateway. Agents never call a write integration themselves: they propose an
// action here, the gateway checks it against the allow-list (policy.ts) and either
// refuses it or queues it for Zak. Approved actions are executed here and nowhere else,
// after a fresh check against Mercury's live state, inside withRun so every apply is in
// agent_runs and respects agents.enabled. Every action, refused or applied, is a row in
// agent_actions.
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { hasMercury, mercuryCategories, mercuryTransaction } from "@/integrations/mercury";
import { attachReceipt, hasMercuryWrite, patchTransaction } from "@/integrations/mercury-write";
import { chicagoDate, offsetOn } from "@/core/time";
import { ANNOTATE, CAP_KEYS, MAX_RECEIPT_BYTES, RECEIPT_TYPES, TOOLS, effectiveCap, planIsEmpty, planWrite, receiptPathOk, refuseProposal, type AnnotateArgs, type CapKey, type ToolName } from "./policy";

export { ANNOTATE } from "./policy";

export interface Proposal {
  agentId: string;
  runId?: string | null;
  tool: ToolName;
  target: string;
  args: AnnotateArgs;
  actionType: string;
  title: string;
  reasoning?: string;
  preview?: Record<string, unknown>;
}

async function numPolicy(key: string, d: number) {
  const { data } = await db().from("policies").select("value_json").eq("key", key).maybeSingle();
  const n = Number(data?.value_json);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/** Queue an action for approval, or record it as refused. Returns what happened. */
export async function propose(p: Proposal): Promise<{ status: "queued" | "refused" | "duplicate"; reason?: string; actionId?: string }> {
  const memoMax = await numPolicy("mercury_memo_max_chars", 200);
  const refused = refuseProposal(p.agentId, p.tool, p.target, p.args as Record<string, unknown>, memoMax);
  const base = { agent_id: p.agentId, run_id: p.runId ?? null, tool: p.tool, action_type: p.actionType, target: p.target, args_json: p.args };
  if (refused) {
    await db().from("agent_actions").insert({ ...base, status: "refused", reason: refused });
    return { status: "refused", reason: refused };
  }
  const { data: action, error } = await db().from("agent_actions").insert({ ...base, status: "proposed" }).select("id").single();
  if (error?.code === "23505") return { status: "duplicate" };
  if (error || !action) throw new Error(`Gateway: could not record the action: ${error?.message}`);
  // Draft tier: always an approval.
  if (TOOLS[p.tool].tier === "Draft") {
    const { error: e2 } = await db().from("approvals").insert({ action_id: action.id, agent_id: p.agentId, title: p.title, reasoning: p.reasoning ?? null, preview: p.preview ?? {} });
    if (e2) { await db().from("agent_actions").delete().eq("id", action.id); throw new Error(`Gateway: could not queue the approval: ${e2.message}`); }
  }
  return { status: "queued", actionId: action.id };
}

// ---- The Bookkeeper's proposals (expense_docs.proposal_*) become actions

interface ProposalRow {
  id: string; mercury_txn_id: string; date: string; merchant: string; amount_usd: number; status: string;
  receipt_path: string | null; source: string | null; receipt_json: { merchant?: string | null; total_usd?: number | null; date?: string | null } | null;
  proposal_attach: boolean; proposal_category_id: string | null; proposal_category: string | null; proposal_memo: string | null;
}

/** Turns every expense_docs proposal that has no open action into one approval per charge. Idempotent. */
export async function queueBookkeeperProposals(runId?: string | null) {
  await expireStale();
  const { data, error } = await db().from("expense_docs")
    .select("id, mercury_txn_id, date, merchant, amount_usd, status, receipt_path, source, receipt_json, proposal_attach, proposal_category_id, proposal_category, proposal_memo")
    .eq("proposal_status", "proposed").not("mercury_txn_id", "is", null).order("date", { ascending: false }).limit(200);
  if (error) throw new Error(`Gateway: could not read proposals: ${error.message}`);
  const rows = (data ?? []) as ProposalRow[];
  if (!rows.length) return { queued: 0, refused: 0 };
  const { data: acts } = await db().from("agent_actions").select("target, status, result_json").eq("tool", ANNOTATE).in("target", rows.map((r) => r.mercury_txn_id));
  const open = new Set((acts ?? []).filter((a) => ["proposed", "approved", "executing"].includes(a.status)).map((a) => a.target));
  const attached = new Set((acts ?? []).filter((a) => (a.result_json as { attached?: boolean } | null)?.attached).map((a) => a.target));
  let queued = 0, refused = 0;
  for (const r of rows) {
    if (open.has(r.mercury_txn_id) || r.status === "personal" || r.status === "not_needed") continue;
    const args: AnnotateArgs = {};
    if (r.proposal_attach && r.receipt_path && !attached.has(r.mercury_txn_id)) { args.attach = true; args.receipt_path = r.receipt_path; }
    if (r.proposal_category_id) { args.category_id = r.proposal_category_id; args.category = r.proposal_category ?? undefined; }
    if (r.proposal_memo) args.note = r.proposal_memo;
    if (!args.attach && !args.category_id && !args.note) continue;
    const parts = [args.attach && "receipt", args.category_id && "category", args.note && "memo"].filter(Boolean) as string[];
    const read = r.receipt_json;
    const res = await propose({
      agentId: "bookkeeper", runId, tool: ANNOTATE, target: r.mercury_txn_id, args,
      actionType: parts.join("+"),
      title: `${r.merchant} · $${Number(r.amount_usd).toFixed(2)} · ${r.date}`,
      reasoning: args.attach && read
        ? `Receipt found in Gmail: ${read.merchant ?? "?"}, $${read.total_usd ?? "?"} on ${read.date ?? "?"}. Matched in code on exact amount, date within the window and merchant name.`
        : args.category_id ? "No category in Mercury yet. Suggested from Mercury's own category list." : undefined,
      preview: { date: r.date, merchant: r.merchant, amount_usd: Number(r.amount_usd), receipt_path: args.attach ? r.receipt_path : null, category: args.category ?? null, note: args.note ?? null },
    });
    if (res.status === "queued") {
      queued++;
      await db().from("expense_docs").update({ proposal_action_id: res.actionId }).eq("id", r.id);
    } else if (res.status === "refused") refused++;
  }
  return { queued, refused };
}

// ---- Decisions

/** Pending items older than approval_expiry_hours expire, so nothing is applied from an old view of the world. */
export async function expireStale() {
  const hours = await numPolicy("approval_expiry_hours", 72);
  const cutoff = new Date(Date.now() - hours * 36e5).toISOString();
  const { data } = await db().from("approvals").update({ status: "expired", decided_at: new Date().toISOString(), reject_reason: "stale" })
    .eq("status", "pending").lt("created_at", cutoff).select("action_id");
  const ids = (data ?? []).map((a) => a.action_id);
  if (!ids.length) return 0;
  await db().from("agent_actions").update({ status: "expired", reason: "stale", decided_at: new Date().toISOString() }).in("id", ids).eq("status", "proposed");
  await db().from("expense_docs").update({ proposal_status: "rejected" }).in("proposal_action_id", ids);
  return ids.length;
}

/** Records Zak's decision on a pending approval. Approving does not write anything by itself. */
export async function decide(approvalId: string, decision: "approve" | "reject", by: string, reason?: string) {
  const now = new Date().toISOString();
  const status = decision === "approve" ? "approved" : "rejected";
  const { data: ap, error } = await db().from("approvals").update({ status, decided_at: now, decided_by: by, reject_reason: decision === "reject" ? (reason ?? "rejected by Zak") : null })
    .eq("id", approvalId).eq("status", "pending").select("action_id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!ap) return null; // already decided or expired
  await db().from("agent_actions").update({ status, decided_at: now, ...(decision === "reject" ? { reason: reason ?? "rejected by Zak" } : {}) }).eq("id", ap.action_id).eq("status", "proposed");
  await db().from("expense_docs").update({ proposal_status: status }).eq("proposal_action_id", ap.action_id);
  return ap.action_id as string;
}

/** A failed action goes back to approved so the next apply tries it again (with a fresh live check). */
export async function retry(actionId: string) {
  const { data } = await db().from("agent_actions").update({ status: "approved", reason: null }).eq("id", actionId).eq("status", "failed").select("id").maybeSingle();
  return !!data;
}

// ---- Execution

/** Why approved actions can't be written to Mercury right now, or null. (agents.enabled is checked by withRun.) */
export function writeBlocker(): string | null {
  if (!hasMercury()) return "MERCURY_API_TOKEN isn't set, so the gateway can't re-check transactions.";
  if (!hasMercuryWrite()) return "MERCURY_WRITE_TOKEN isn't set, so approved changes wait here.";
  return null;
}

interface ActionRow { id: string; agent_id: string; target: string; args_json: AnnotateArgs; status: string }

async function applyOne(a: ActionRow, runId: string, cats: () => Promise<Set<string>>) {
  const now = new Date().toISOString();
  // claim it, so two clicks can't apply it twice
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    // re-check the allow-list at execution time, in case a row was edited by hand
    const refused = refuseProposal(a.agent_id, ANNOTATE, a.target, a.args_json as Record<string, unknown>, Number.MAX_SAFE_INTEGER);
    if (refused) { await done({ status: "refused", reason: refused }); return "refused" as const; }
    const { data: doc } = await db().from("expense_docs").select("id, amount_usd, status").eq("mercury_txn_id", a.target).maybeSingle();
    if (!doc) { await done({ status: "refused", reason: "No expense_docs row for this transaction." }); return "refused" as const; }
    const live = await mercuryTransaction(a.target);
    const plan = planWrite(a.args_json, live, { amountUsd: Number(doc.amount_usd), status: doc.status }, a.args_json.category_id ? await cats() : new Set());
    if (typeof plan === "string") {
      await done({ status: "refused", reason: plan });
      await db().from("expense_docs").update({ proposal_status: "rejected" }).eq("id", doc.id);
      return "refused" as const;
    }
    const before = { note: live!.note ?? null, category_id: live!.categoryData?.id ?? null, attachments: live!.attachments?.length ?? 0 };
    if (planIsEmpty(plan)) {
      await done({ status: "applied", reason: `Nothing left to change: ${plan.skipped.join("; ")}`, result_json: { attached: false, skipped: plan.skipped }, diff_json: { before, after: before } });
      await db().from("expense_docs").update({ proposal_status: "applied", updated_at: now }).eq("id", doc.id);
      return "applied" as const;
    }
    let attachmentId: string | null = null;
    if (plan.attach) {
      const path = a.args_json.receipt_path!;
      if (!receiptPathOk(a.target, path)) throw new Error("Receipt path is not this transaction's file.");
      const { data: blob, error } = await db().storage.from("receipts").download(path);
      if (error || !blob) throw new Error(`Could not read the receipt file: ${error?.message ?? "missing"}`);
      if (blob.size > MAX_RECEIPT_BYTES) throw new Error("Receipt file is over 10 MB.");
      const ext = path.split(".").pop()!;
      attachmentId = await attachReceipt(a.target, { name: `receipt.${ext}`, type: RECEIPT_TYPES[ext], bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (plan.categoryId || plan.note) await patchTransaction(a.target, { categoryId: plan.categoryId, note: plan.note });
    const after = { note: plan.note ?? before.note, category_id: plan.categoryId ?? before.category_id, attachments: before.attachments + (plan.attach ? 1 : 0) };
    await done({
      status: plan.skipped.length ? "partial" : "applied",
      reason: plan.skipped.length ? plan.skipped.join("; ") : null,
      diff_json: { before, after },
      // what to put back: the memo and category it replaced (both were empty), and the attachment it added
      undo_json: { note: plan.note ? before.note : undefined, category_id: plan.categoryId ? before.category_id : undefined, attachment_id: attachmentId },
      result_json: { attached: plan.attach, attachment_id: attachmentId, category_id: plan.categoryId ?? null, note: plan.note ?? null, skipped: plan.skipped },
    });
    await db().from("expense_docs").update({
      proposal_status: "applied", updated_at: now,
      ...(plan.categoryId ? { category_id: plan.categoryId, category: a.args_json.category ?? null } : {}),
    }).eq("id", doc.id);
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/**
 * Applies approved actions (all of them, or the ids given), at most max_mercury_writes_per_run
 * per agent, each inside a withRun for its agent (trigger "approval", $0). A disabled agent's
 * run is skipped and its actions stay approved.
 */
export async function applyApproved(ids?: string[]) {
  const blocked = writeBlocker();
  if (blocked) return { ok: false, text: blocked };
  await expireStale();
  // an apply that died mid-way: mark it failed; a retry re-checks Mercury first, so nothing is written twice
  await db().from("agent_actions").update({ status: "failed", reason: "Interrupted while applying. Retry re-checks Mercury first." })
    .eq("status", "executing").lt("claimed_at", new Date(Date.now() - 10 * 6e4).toISOString());
  let q = db().from("agent_actions").select("id, agent_id, target, args_json, status").eq("status", "approved").eq("tool", ANNOTATE).order("decided_at", { ascending: true });
  if (ids?.length) q = q.in("id", ids);
  const { data, error } = await q.limit(200);
  if (error) return { ok: false, text: error.message };
  const rows = (data ?? []) as ActionRow[];
  if (!rows.length) return { ok: true, text: "Nothing approved is waiting." };
  const cap = await numPolicy("max_mercury_writes_per_run", 20);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    let catSet: Set<string> | null = null;
    const cats = async () => (catSet ??= new Set((await mercuryCategories()).map((c) => c.id)));
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) {
        const r = await applyOne(a, runId, cats);
        if (r !== "skipped") n[r]++;
      }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway applied ${n.applied} approved Mercury change${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved changes are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

// ---- Caps: what checkPurchase and checkEmail need (policy.ts), loaded here.

/** Names the payment and email action types will have. Neither is in TOOLS yet, so nothing can propose one. */
export const PAY_TOOL = "mercury.send_money";
export const EMAIL_TOOL = "email.send";

/** Every cap as code enforces it (the policy row held inside the code limit), plus the raw row. */
export async function loadCaps(): Promise<Record<CapKey, { value: number; raw: unknown }>> {
  const { data, error } = await db().from("policies").select("key, value_json").in("key", CAP_KEYS);
  if (error) throw new Error(`Gateway: could not read caps: ${error.message}`);
  const raw = new Map((data ?? []).map((r) => [r.key as string, r.value_json as unknown]));
  return Object.fromEntries(CAP_KEYS.map((k) => [k, { value: effectiveCap(k, raw.get(k)), raw: raw.has(k) ? raw.get(k) : null }])) as Record<CapKey, { value: number; raw: unknown }>;
}

const chicagoStart = (unit: "day" | "month", now = new Date()) => {
  const d = chicagoDate(0, now);
  const day = unit === "day" ? d : `${d.slice(0, 8)}01`;
  return new Date(`${day}T00:00:00${offsetOn(day)}`).toISOString();
};

/** Money sent this Chicago calendar month, from applied payment actions (computed in code). */
export async function monthSpentUsd(now = new Date()): Promise<number> {
  const { data, error } = await db().from("agent_actions").select("args_json").eq("tool", PAY_TOOL).in("status", ["applied", "executing"]).gte("executed_at", chicagoStart("month", now));
  if (error) throw new Error(error.message);
  const cents = (data ?? []).reduce((s, r) => s + Math.round(Number((r.args_json as { amount_usd?: number } | null)?.amount_usd ?? 0) * 100), 0);
  return cents / 100;
}

/** Outbound emails sent today (Chicago), from applied email actions. Briefs to Zak are reports, not actions, so they don't count. */
export async function emailsSentToday(now = new Date()): Promise<number> {
  const { count, error } = await db().from("agent_actions").select("id", { count: "exact", head: true }).eq("tool", EMAIL_TOOL).in("status", ["applied", "executing"]).gte("executed_at", chicagoStart("day", now));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Vendors that have been paid before, so a first payment always waits for Zak. */
export async function paidVendorIds(): Promise<Set<string>> {
  const { data } = await db().from("agent_actions").select("target").eq("tool", PAY_TOOL).eq("status", "applied");
  return new Set((data ?? []).map((r) => r.target as string));
}

/**
 * A cap was breached (a payment or email refused by checkPurchase or checkEmail). CLAUDE.md:
 * a cap breach drops that action type back to Draft. The trust levels card adds the demotion;
 * until then this records the refusal so it shows in the gateway log.
 */
export async function onBreach(b: { agentId: string; tool: string; target: string; reason: string; runId?: string | null }) {
  await db().from("agent_actions").insert({ agent_id: b.agentId, run_id: b.runId ?? null, tool: b.tool, action_type: "cap breach", target: b.target, args_json: {}, status: "refused", reason: b.reason });
  // TODO(trust levels card): demote b.tool for b.agentId to Draft here.
}
