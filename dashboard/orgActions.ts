"use server";
// Org chart actions (docs/org-chart.md). Each checks the login again. Seats and departments need
// no Controls: the chart decides where an agent sits, never what it can read or do, and nothing
// here runs. Department limits (slice 2) are like the company caps: tightening is always allowed,
// loosening needs DASHBOARD_CONTROLS=on and a confirm.
import { audit } from "@/core/audit";
import { revalidatePath } from "next/cache";
import { withActor } from "@/core/actor";
import { db } from "@/core/db";
import { loadCaps } from "@/core/gateway";
import { addDepartmentRule, editMemory, forgetMemory } from "@/core/memory";
import { addDepartment, addSeat, deptBudgetChange, deptEmailChange, editSeat, loadOrg, removeDepartment, removeSeat, renameDepartment, setDeptBudget, setDeptEmailCap, setHolder, setLeadChecks, unseat } from "@/core/org";
import type { ActionResult } from "./actions";
import { installTemplates } from "@/core/install";
import { getFloor, asRole } from "./data";
import { controlsOn } from "./session";
import { saveBusiness } from "@/core/business";
import { saveSettings, settings } from "@/core/settings";
import { OFFER_TERMS_MAX, checkSettingsEdit, editOf, type BusinessSettings, type SettingsEdit } from "@/core/settings-rules";
import { listMembers } from "@/core/members";
import { businessProblem } from "@/core/business-rules";
import { ownMeasureDefs } from "@/core/goals";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

/** An agent in the agents table. */
async function knownAgent(id: string): Promise<boolean> {
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(id)) return false;
  const { data } = await db().from("agents").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export async function orgAddDepartment(name: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  try { await addDepartment(String(name ?? "")); return done(`${String(name).trim()} is on the chart, with an open head seat.`); } catch (e) { return fail(e); }
}

export async function orgRenameDepartment(id: string, name: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  try { await renameDepartment(String(id), String(name ?? "")); return done("Renamed."); } catch (e) { return fail(e); }
}

export async function orgRemoveDepartment(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try { await withActor(me.email, () => removeDepartment(String(id))); return done("Department removed."); } catch (e) { return fail(e); }
}

export async function orgAddSeat(parentId: string, title: string, sub: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(parentId))) return { ok: false, text: "Unknown seat." };
  try { await addSeat(parentId, String(title ?? ""), String(sub ?? "")); return done("Seat added. It’s open until you build an agent for it."); } catch (e) { return fail(e); }
}

export async function orgEditSeat(id: string, title: string, sub: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown seat." };
  try { await editSeat(id, String(title ?? ""), String(sub ?? "")); return done("Seat saved."); } catch (e) { return fail(e); }
}

export async function orgRemoveSeat(id: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown seat." };
  try { await removeSeat(id); return done("Seat removed."); } catch (e) { return fail(e); }
}

/** Who sits in a seat: "open", "owner" or "agent:<id>". An agent moves from any seat it had. */
export async function orgSetHolder(seatId: string, who: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(seatId))) return { ok: false, text: "Unknown seat." };
  const w = String(who ?? "");
  try {
    if (w === "open" || w === "owner") { await setHolder(seatId, w, null); await audit(me, "set_seat_holder", seatId, { who }); return done(w === "open" ? "The seat is open." : "That seat is yours."); }
    const id = w.startsWith("agent:") ? w.slice(6) : "";
    if (!(await knownAgent(id))) return { ok: false, text: "Unknown agent." };
    await setHolder(seatId, "agent", id);
    await audit(me, "set_seat_holder", seatId, { who });
    return done(`${(await getFloor()).byId[id]?.name ?? "The agent"} sits there now. Its old seat, if it had one, is open.`);
  } catch (e) { return fail(e); }
}

/** From the builder's step 1: put an agent in a seat, or take it off the chart (null). */
export async function placeAgent(agentId: string, seatId: string | null): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!(await knownAgent(String(agentId)))) return { ok: false, text: "Unknown agent." };
  try {
    if (seatId == null) { await unseat(agentId); await audit(me, "place_agent", agentId, { seat: seatId }); return done("Off the chart. Its seat is open."); }
    if (!UUID.test(String(seatId))) return { ok: false, text: "Unknown seat." };
    await setHolder(seatId, "agent", agentId);
    await audit(me, "place_agent", agentId, { seat: seatId });
    return done("Placed on the chart.");
  } catch (e) { return fail(e); }
}

// ---- Department limits and rules (slice 2)

const CONTROLS_OFF = "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this.";
const SLUG = /^[a-z][a-z0-9_]{1,39}$/;

/** A blank box means no department limit. */
const limitOf = (v: unknown): number | null => (v === null || v === undefined || String(v).trim() === "" ? null : Number(v));

async function dept(id: string) {
  if (!SLUG.test(id)) throw new Error("Unknown department.");
  const o = await loadOrg();
  const d = o?.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  return d;
}

/** A department's monthly AI budget. Raising or removing it needs Controls on and a confirm. */
export async function orgSetDeptBudget(id: string, value: number | string | null, confirmed = false): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const d = await dept(String(id));
    const next = limitOf(value);
    const ch = deptBudgetChange(d.monthlyBudgetUsd, next);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const from = d.monthlyBudgetUsd == null ? "no budget" : `$${d.monthlyBudgetUsd.toFixed(2)}`;
    const to = next == null ? "no budget" : `$${next.toFixed(2)} a month`;
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${d.name} from ${from} to ${to}.` };
    await setDeptBudget(d.id, next);
    await audit(me, "set_department_budget", id, { value: next });
    return done(next == null ? `${d.name} has no department budget now. Each agent’s daily budget still applies.` : `${d.name}: ${to}. Its agents check it before every run.`);
  } catch (e) { return fail(e); }
}

/** A department's email cap, never above the company cap. Raising or removing it needs Controls on and a confirm. */
export async function orgSetDeptEmails(id: string, value: number | string | null, confirmed = false): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const d = await dept(String(id));
    const next = limitOf(value);
    const company = (await loadCaps()).max_emails_per_day.value;
    const ch = deptEmailChange(d.maxEmailsPerDay, next, company);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const to = next == null ? `the company cap (${company})` : `${next} a day`;
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${d.name}’s emails up to ${to}.` };
    await setDeptEmailCap(d.id, next, company);
    await audit(me, "set_department_emails", id, { value: to });
    return done(`${d.name}’s emails: ${to}.`);
  } catch (e) { return fail(e); }
}

export async function orgAddDeptRule(id: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const d = await dept(String(id));
    await withActor(me.email, () => addDepartmentRule(d.id, String(text ?? "")));
    return done(`Every agent in ${d.name} follows it from its next run.`);
  } catch (e) { return fail(e); }
}

/** Only a department rule: other memory lines are edited on each agent's Memory tab. */
async function deptRule(ruleId: string) {
  if (!UUID.test(ruleId)) throw new Error("Unknown rule.");
  const { data } = await db().from("agent_memory").select("grp").eq("id", ruleId).maybeSingle();
  if (data?.grp !== "department") throw new Error("That isn’t a department rule.");
}

export async function orgEditDeptRule(ruleId: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try { await deptRule(String(ruleId)); await withActor(me.email, () => editMemory(ruleId, String(text ?? ""))); return done("Rule saved."); } catch (e) { return fail(e); }
}

export async function orgForgetDeptRule(ruleId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try { await deptRule(String(ruleId)); await withActor(me.email, () => forgetMemory(ruleId)); return done("Forgotten. It stays on each agent’s memory timeline."); } catch (e) { return fail(e); }
}

/** "Lead checks drafts first" on or off. Neither way loosens a cap: The owner's tap stays the only approval. */
export async function orgSetLeadChecks(id: string, on: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const d = await dept(String(id));
    await setLeadChecks(d.id, !!on);
    await audit(me, "set_lead_checks", d.id, { on: !!on });
    return done(on ? `${d.name}: drafts go to the agent above them first, for up to a day.` : `${d.name}: drafts come straight to you.`);
  } catch (e) { return fail(e); }
}

/** The business's own words (Settings): its name, a line about it and the owner's name, which every agent is told. */
export async function saveBusinessProfile(f: { name: string; about: string; ownerName: string }): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const b = { name: String(f?.name ?? ""), about: String(f?.about ?? ""), ownerName: String(f?.ownerName ?? "") };
  const problem = businessProblem(b);
  if (problem) return { ok: false, text: problem };
  try {
    await saveBusiness(b);
    await audit(me, "save_business_profile", null, { name: b.name.trim() });
    return done("Saved. Agents get the new words from their next run.");
  } catch (e) { return fail(e); }
}

/** Where things go (Settings): the owner email, website, Shopify store, Mercury accounts and Notion pages of this business. */
const WHERE_KEYS = ["ownerEmail", "siteUrl", "shopifyDomain", "shopifyClientId", "mercuryAccountIds", "notionBriefParent", "notionBriefsDb", "notionLeadsParent", "notionBooksParent"] as const;
const PRODUCT_KEYS = ["productCollections", "productFields", "offerTerms"] as const;
const COST_KEYS = ["costSource", "costNumber"] as const;

/** One Settings card's fields over what the org already saved, so the other card's fields stay; checked, then saved. */
async function saveSettingsCard(f: Partial<SettingsEdit>, keys: readonly (keyof SettingsEdit)[], max: (k: keyof SettingsEdit) => number): Promise<{ problem: string } | { settings: BusinessSettings }> {
  const e = { ...editOf(await settings()), ...Object.fromEntries(keys.map((k) => [k, String(f?.[k] ?? "").slice(0, max(k))])) } as SettingsEdit;
  const owners = (await listMembers()).filter((m) => m.role === "owner").map((m) => m.email);
  const checked = checkSettingsEdit(e, owners);
  if ("settings" in checked) await saveSettings(checked.settings);
  return checked;
}

export async function saveWhereThingsGo(f: Omit<SettingsEdit, "productCollections" | "productFields" | "offerTerms" | "costSource" | "costNumber">): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const r = await saveSettingsCard(f, WHERE_KEYS, () => 300);
    if ("problem" in r) return { ok: false, text: r.problem };
    await audit(me, "save_settings", null, { owner_email: r.settings.ownerEmail, shopify: r.settings.shopifyDomain });
    return done("Saved. Agents use the new settings from their next run.");
  } catch (e2) { return fail(e2); }
}

/** What agents may say about the products (docs/product-facts.md): collections, fields and offer terms. Owners only. */
export async function saveProductFacts(f: Pick<SettingsEdit, "productCollections" | "productFields" | "offerTerms">): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const r = await saveSettingsCard(f, PRODUCT_KEYS, (k) => (k === "offerTerms" ? OFFER_TERMS_MAX + 1 : 1000));
    if ("problem" in r) return { ok: false, text: r.problem };
    const s = r.settings;
    await audit(me, "save_product_facts", null, { collections: s.productCollections.join(", "), fields: s.productFields.length, offer_terms: !!s.offerTerms });
    return done("Saved. Agents use the new product facts from their next run.");
  } catch (e2) { return fail(e2); }
}

/** Daily numbers (docs/daily-numbers.md): where cost of goods comes from. A number from your own tool must be one of this business's, in dollars. Owners only. */
export async function saveDailyNumbers(f: Pick<SettingsEdit, "costSource" | "costNumber">): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    if (f?.costSource === "own" && !(await ownMeasureDefs()).some((d) => d.key === f.costNumber && d.unit === "usd")) return { ok: false, text: "Pick a number in dollars from your own tools." };
    const r = await saveSettingsCard(f, COST_KEYS, () => 20);
    if ("problem" in r) return { ok: false, text: r.problem };
    await audit(me, "save_daily_numbers", null, { cost_source: r.settings.costSource });
    return done("Saved. The next daily numbers use it.");
  } catch (e2) { return fail(e2); }
}

/**
 * Starts an empty org from the picked department templates (core/install.ts): departments, the chart,
 * agents, playbooks, chains and goals, every one switched off until the owner approves and turns things on.
 */
export async function installTemplate(picked: string[]): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const ids = (Array.isArray(picked) ? picked : []).map(String).slice(0, 20);
    const { counts } = await installTemplates(ids);
    await audit(me, "install_template", ids.join(","), counts);
    return done(`Installed: ${counts.agents ?? 0} agents in ${counts.departments ?? 0} departments, all off duty. Approve each playbook on Crew before it runs.`);
  } catch (e) { return fail(e); }
}
