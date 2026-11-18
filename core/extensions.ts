import "server-only";
// The one place the app reaches the paid layer's slots (docs/extensions.md). "operator-extensions"
// is core/extensions/none.ts in the open edition and ee/index.ts in the cloud edition; only this
// file imports it (check:open-core).
import ext from "operator-extensions";
import type { Extensions, PlanAsk } from "@/core/extension-types";

export type { PlanAsk };
export const extensions: Extensions = ext;
export const edition = () => extensions.edition;

/**
 * Why the plan says no, or null. A plan check that throws says no too, since the ask can't be
 * shown to be allowed; the open edition never throws.
 */
export async function planBlock(ask: PlanAsk): Promise<string | null> {
  try { return await extensions.planBlock(ask); }
  catch (e) { return `Couldn’t check the plan: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}.`; }
}

/** Tells the paid layer People changed (the seat count on the bill). Never stops or fails the change. */
export async function membersChanged(): Promise<void> {
  try { await extensions.afterMembersChange(); } catch { /* the bill catches up on the next change or the next webhook */ }
}
