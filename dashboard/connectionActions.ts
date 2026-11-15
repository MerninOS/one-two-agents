"use server";
// MCP connection actions (docs/company-mode.md, slice 6). Each checks the login again. Disconnect
// forgets the token; the email list is a choice for the Email list size measure. Neither grants a
// tool: that stays a builder step.
import { revalidatePath } from "next/cache";
import { isMcpId } from "@/core/mcp-rules";
import { disconnectMcp, saveMcpSetting } from "@/integrations/mcp";
import { klaviyoLists } from "@/integrations/klaviyo";
import type { ActionResult } from "./actions";
import { requireSession } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function mcpDisconnect(id: string): Promise<ActionResult> {
  await requireSession();
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  try { await disconnectMcp(id); return done("Disconnected. Agents can’t read it until you connect again."); } catch (e) { return fail(e); }
}

/** The list the Email list size measure counts, checked against Klaviyo's own lists. */
export async function klaviyoPickList(listId: string): Promise<ActionResult> {
  await requireSession();
  try {
    const lists = await klaviyoLists();
    const l = lists.find((x) => x.id === String(listId));
    if (!l) return { ok: false, text: "That list isn’t in Klaviyo any more." };
    await saveMcpSetting("klaviyo", "emailListId", l.id);
    await saveMcpSetting("klaviyo", "emailListName", l.name);
    return done(`Email list size now counts “${l.name}”.`);
  } catch (e) { return fail(e); }
}
