"use server";
// Proposal actions (docs/company-mode.md, slice 3). Each checks the login again. None of them runs,
// sends or spends: a yes creates an agent off duty, saves a draft version, or opens Find a tool,
// through the same code paths as the builder and the org chart.
import { revalidatePath } from "next/cache";
import { acceptProposal, declineProposal, getProposal } from "@/core/proposals";
import { addSeat, loadOrg, setHolder } from "@/core/org";
import { createBuilt, type ActionResult } from "./actions";
import { requireSession } from "./data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function proposalAccept(id: string): Promise<ActionResult & { href?: string }> {
  await requireSession();
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown proposal." };
  try { const r = await acceptProposal(id); return { ...done(r.text), href: r.href ?? undefined }; } catch (e) { return fail(e); }
}

/** Not now, with the reason Zak typed (optional). */
export async function proposalDecline(id: string, reason: string): Promise<ActionResult> {
  await requireSession();
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown proposal." };
  try { return done(await declineProposal(id, String(reason ?? ""))); } catch (e) { return fail(e); }
}

/**
 * Change it first: the builder, filled in from a hire, creates the agent off duty (createBuilt's
 * checks), then the proposal closes as accepted. A hire for a new seat gets that seat under the
 * proposer when the builder picked none.
 */
export async function proposalCreate(id: string, draft: unknown, seatId?: string | null): Promise<ActionResult & { id?: string }> {
  await requireSession();
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown proposal." };
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending" || pr.payload.kind !== "hire") return { ok: false, text: "That proposal isn’t waiting any more." };
  const made = await createBuilt(draft, seatId);
  if (!made.ok || !made.id) return made;
  let extra = "";
  const p = pr.payload;
  if (!seatId && !p.seatId && p.parentSeatId) {
    try {
      const org = await loadOrg();
      if (org?.seats.some((s) => s.id === p.parentSeatId)) {
        await setHolder(await addSeat(p.parentSeatId, p.seat, p.job.slice(0, 120)), "agent", made.id);
        extra = ` It sits in a new ${p.seat} seat.`;
      }
    } catch (e) { extra = ` It isn’t on the chart yet: ${e instanceof Error ? e.message : e}`; }
  }
  try { await acceptProposal(id, { agentFromBuilder: made.id }); } catch { /* the agent exists either way */ }
  revalidatePath("/", "layout");
  return { ...made, text: `${made.text}${extra}` };
}
