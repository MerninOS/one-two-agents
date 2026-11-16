"use server";
// MCP connection actions (docs/company-mode.md, slice 6). Each checks the login again. Disconnect
// forgets the token; the email list is a choice for the Email list size measure. Neither grants a
// tool: that stays a builder step.
import { revalidatePath } from "next/cache";
import { isMcpId } from "@/core/mcp-rules";
import { disconnectMcp, resealAll, saveMcpKey, saveMcpSetting } from "@/integrations/mcp";
import { klaviyoLists } from "@/integrations/klaviyo";
import type { ActionResult } from "./actions";
import { requireSession } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function mcpDisconnect(id: string): Promise<ActionResult> {
  await requireSession();
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  try {
    const r = await disconnectMcp(id);
    return done(r.revoked ? "Disconnected, and the server cancelled the sign-in. Agents can’t read it until you connect again." : `Disconnected here. ${r.note ?? ""}`.trim());
  } catch (e) { return fail(e); }
}

/** Locks a pasted key in the vault, after the service says whose it is. The key is never sent back. */
export async function mcpSaveKey(id: string, key: string): Promise<ActionResult> {
  await requireSession();
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    const who = await saveMcpKey(id, key);
    return done(`Key locked in the vault. It belongs to “${who.name}”${who.workspace ? ` in ${who.workspace}` : ""}. Agents see only the pages shared with it.`);
  } catch (e) { return fail(e); }
}

/** Re-seals every saved sign-in with MCP_SECRET_KEY (after a new key is put in). */
export async function vaultReseal(): Promise<ActionResult> {
  await requireSession();
  try {
    const r = await resealAll();
    const bad = r.unreadable.length ? ` ${r.unreadable.join(", ")} couldn’t be unlocked with either key: sign in to ${r.unreadable.length === 1 ? "it" : "them"} again.` : "";
    return done(`${r.moved} sign-in${r.moved === 1 ? "" : "s"} moved onto the current key.${bad}${r.unreadable.length ? "" : " You can remove MCP_SECRET_KEY_OLD now."}`);
  } catch (e) { return fail(e); }
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
