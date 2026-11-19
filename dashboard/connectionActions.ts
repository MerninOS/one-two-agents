"use server";
// MCP connection actions (docs/company-mode.md, slice 6). Each checks the login again. Disconnect
// forgets the token; the email list is a choice for the Email list size measure. Neither grants a
// tool: that stays a builder step.
import { audit } from "@/core/audit";
import { planBlock } from "@/core/extensions";
import { revalidatePath } from "next/cache";
import { isMcpId } from "@/core/mcp-rules";
import { addCustomServer, checkCustomServer, disconnectMcp, removeClaudeKey, saveClaudeKey, pauseCustom, removeCustomServer, resealAll, saveCustomKey, setCustomNumber, saveCustomScopes, saveMcpKey, saveMcpSetting, setCustomTool } from "@/integrations/mcp";
import { isCustomId } from "@/core/custom-mcp-rules";
import { knownByAddress } from "@/core/connector-rules";
import { askFor, closeRequest } from "@/core/connector-requests";
import { controlsOn } from "./session";
import { klaviyoLists } from "@/integrations/klaviyo";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function mcpDisconnect(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  try {
    const r = await disconnectMcp(id);
    await audit(me, "disconnect", id);
    return done(r.revoked ? "Disconnected, and the server cancelled the sign-in. Agents can’t read it until you connect again." : `Disconnected here. ${r.note ?? ""}`.trim());
  } catch (e) { return fail(e); }
}

/** Locks a pasted key in the vault, after the service says whose it is. The key is never sent back. */
export async function mcpSaveKey(id: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    const who = await saveMcpKey(id, key);
    await audit(me, "save_key", id);
    return done(`Key locked in the vault. It belongs to “${who.name}”${who.workspace ? ` in ${who.workspace}` : ""}. Agents see only the pages shared with it.`);
  } catch (e) { return fail(e); }
}

/** The business's own Claude key (Connections > Claude API): locked in the vault after Anthropic accepts it. */
export async function claudeSaveKey(key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    await saveClaudeKey(key);
    await audit(me, "save_key", "anthropic_key");
    return done("Claude key locked in the vault. Agents’ model calls are billed to it from their next run.");
  } catch (e) { return fail(e); }
}

export async function claudeRemoveKey(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    await removeClaudeKey();
    await audit(me, "disconnect", "anthropic_key");
    return done("Claude key forgotten here. Delete it in the Claude Console too if it shouldn’t work anywhere.");
  } catch (e) { return fail(e); }
}

/** Re-seals every saved sign-in with MCP_SECRET_KEY (after a new key is put in). */
export async function vaultReseal(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const r = await resealAll();
    const bad = r.unreadable.length ? ` ${r.unreadable.join(", ")} couldn’t be unlocked with either key: sign in to ${r.unreadable.length === 1 ? "it" : "them"} again.` : "";
    await audit(me, "vault_reseal", null, { moved: r.moved, unreadable: r.unreadable.length });
    return done(`${r.moved} sign-in${r.moved === 1 ? "" : "s"} moved onto the current key.${bad}${r.unreadable.length ? "" : " You can remove MCP_SECRET_KEY_OLD now."}`);
  } catch (e) { return fail(e); }
}

/** The list the Email list size measure counts, checked against Klaviyo's own lists. */
export async function klaviyoPickList(listId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const lists = await klaviyoLists();
    const l = lists.find((x) => x.id === String(listId));
    if (!l) return { ok: false, text: "That list isn’t in Klaviyo any more." };
    await saveMcpSetting("klaviyo", "emailListId", l.id);
    await saveMcpSetting("klaviyo", "emailListName", l.name);
    await audit(me, "pick_klaviyo_list", listId);
    return done(`Email list size now counts “${l.name}”.`);
  } catch (e) { return fail(e); }
}

// ---- Custom servers (docs/custom-servers.md, slice 1). Adding a server, connecting it and turning a
// tool on need Controls on; turning a tool off, pausing and removing never do, so the owner can
// always stop a server. None of these grants a tool to an agent: that stays a builder step.

const CONTROLS_OFF: ActionResult = { ok: false, text: "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to add or change custom servers." };
const unknown: ActionResult = { ok: false, text: "Unknown server." };

/** Adds a server by address, all tools off. The text carries its id for the page to open. */
export async function customAdd(name: string, url: string, auth: string): Promise<ActionResult & { id?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  const plan = await planBlock({ kind: "custom_server" }); if (plan) return { ok: false, text: plan };
  try {
    const id = await addCustomServer({ name: String(name ?? ""), url: String(url ?? ""), auth: String(auth ?? "") });
    // adding a server counts as an ask for that service, so the most wanted get built in (never stops the add)
    await askFor({ name: knownByAddress(String(url))?.name ?? String(name), what: "Added its server by address on Connections.", by: me.email }).catch(() => undefined);
    revalidatePath("/", "layout");
    await audit(me, "custom_add", id);
    return { ok: true, text: auth === "oauth" ? "Added. Tick the scopes it should ask for, then connect." : "Added. Paste its key to connect.", id };
  } catch (e) { return fail(e); }
}

/** Saves the ticked scopes; the page then goes to the server's own sign-in page. */
export async function customScopes(id: string, scopes: string[]): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (!Array.isArray(scopes) || scopes.length > 30) return { ok: false, text: "Pick fewer scopes." };
  try { await saveCustomScopes(id, scopes.map(String)); await audit(me, "custom_scopes", id, { scopes: scopes.length }); return { ok: true, text: "Saved." }; } catch (e) { return fail(e); }
}

export async function customKey(id: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof key !== "string" || key.length > 900) return { ok: false, text: "That isn’t a key." };
  try {
    const r = await saveCustomKey(id, key);
    await audit(me, "custom_key", id);
    return done(`Key locked in the vault. The server lists ${r.tools} tool${r.tools === 1 ? "" : "s"}, all off.`);
  } catch (e) { return fail(e); }
}

/** Checks the turned-on tools against the server's list now, or (accept) takes the server's tools as they are now. */
export async function customCheck(id: string, accept: boolean): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  if (accept && !controlsOn()) return CONTROLS_OFF;
  try {
    const r = await checkCustomServer(id, !!accept);
    if (!r.ok) return { ok: false, text: `Paused: ${r.note}. Look at the change below, then accept it if it’s fine.` };
    revalidatePath("/", "layout");
    return { ok: true, text: accept ? `Accepted.${r.turnedOff.length ? ` Turned off ${r.turnedOff.join(", ")}: gone, or no longer read-only.` : ""}` : `Tools checked: the turned-on ones are as you accepted them. ${r.tools} listed.` };
  } catch (e) { return fail(e); }
}

export async function customToolOn(id: string, tool: string, label: string, line: string, pins: Record<string, string>): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof tool !== "string" || tool.length > 120 || !pins || typeof pins !== "object") return { ok: false, text: "That isn’t a tool." };
  try { await setCustomTool(id, tool, { label: String(label ?? ""), line: String(line ?? ""), pins }); await audit(me, "custom_tool_on", id, { tool }); return done("On. No agent can use it yet: giving custom tools to agents comes in the next update."); } catch (e) { return fail(e); }
}

/** Uses a turned-on tool as a goal number, or stops (`f` null). Owner, Controls on to set one; stopping is always allowed. */
export async function customNumber(id: string, tool: string, f: { field: string; label: string; unit: string; shape: string; brief?: boolean } | null): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (f && !controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof tool !== "string" || tool.length > 120 || (f != null && typeof f !== "object")) return { ok: false, text: "That isn’t a tool." };
  try {
    await setCustomNumber(id, tool, f ? { field: f.field, label: f.label, unit: f.unit, shape: f.shape, brief: f.brief === true } : null);
    await audit(me, f ? "custom_goal_number" : "custom_goal_number_off", id, { tool, ...(f ? { field: String(f.field).slice(0, 80) } : {}) });
    return done(f ? "Saved. It shows in the goal picker under From your own tools." : "No longer a goal number. Goals on it show No measure yet.");
  } catch (e) { return fail(e); }
}

export async function customToolOff(id: string, tool: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  try { await setCustomTool(id, String(tool), null); await audit(me, "custom_tool_off", id, { tool }); return done("Off."); } catch (e) { return fail(e); }
}

export async function customPause(id: string, paused: boolean): Promise<ActionResult> {
  // pausing a server is a stop, so approvers may; running it again is the owner's
  const { me, no } = await asRole(paused ? "approver" : "owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  if (!paused && !controlsOn()) return CONTROLS_OFF;
  try { await pauseCustom(id, !!paused); await audit(me, paused ? "custom_pause" : "custom_resume", id); return done(paused ? "Paused for every agent." : "Running again."); } catch (e) { return fail(e); }
}

export async function customRemove(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  try {
    const r = await removeCustomServer(id);
    await audit(me, "custom_remove", id);
    return done(r.revoked ? "Removed, and the server cancelled the sign-in." : `Removed here. ${r.note ?? ""}`.trim());
  } catch (e) { return fail(e); }
}

// ---- Find a tool (docs/custom-servers.md, slice 3). Asking for a connector and closing a request
// change no agent and reach no service but the business's own Build Board, so neither needs Controls on.

const PROPOSAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ask for a built-in connector, in the owner's own words. */
export async function connectorAsk(name: string, what: string, proposalId: string | null): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const pid = typeof proposalId === "string" && PROPOSAL_ID.test(proposalId) ? proposalId : null;
  try { return done(await askFor({ name: String(name ?? ""), what: String(what ?? ""), by: me.email, proposalId: pid })); } catch (e) { return fail(e); }
}

/** Closes a request: a built-in connector is ready, or it isn't needed. */
export async function connectorClose(id: string, why: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (why !== "ready" && why !== "not_needed") return { ok: false, text: "Unknown choice." };
  try { return done(await closeRequest(String(id), why)); } catch (e) { return fail(e); }
}
