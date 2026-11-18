import "server-only";
// The template installer (docs/templates.md, slice 4). A new org starts empty, or from a pack's
// crew: departments, the org chart, agents with their specs, playbooks, the chains and starting
// goals. Everything it installs is switched off (core/install-rules.ts): no agent runs until the
// owner approves its playbook, puts it on duty and turns the org on. Policies aren't installed:
// every cap and setting starts at its default in code.
import { db, createOrgRow } from "@/core/db";
import { withOrg } from "@/core/tenancy";
import { normalEmail } from "@/core/roles";
import { installRows, type InstallRows } from "@/core/install-rules";
import { PACKS } from "@/templates";

const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const ORDER: (keyof InstallRows)[] = ["departments", "agents", "agent_defs", "agent_playbooks", "seats", "crew_flow", "goals"];

/** The installed packs that bring a crew, for a new org to start from. */
export const crewPacks = () => PACKS.filter((p) => p.crew).map((p) => ({ id: p.id, name: p.name, about: p.about }));

/**
 * The planned seats to show: those of each pack whose agents this org has (by id). An org that
 * started empty, or from another pack, sees none of a pack's plan.
 */
export function plannedSeats(agentIds: Iterable<string>) {
  const ids = new Set(agentIds);
  return PACKS.filter((p) => p.planned?.length && p.crew?.agents.some((a) => ids.has(a.id))).flatMap((p) => [...p.planned!]);
}

/** Every pack's planned seat ids: an org chart seat may be held for one before it is built. */
export const plannedIds = () => new Set(PACKS.flatMap((p) => (p.planned ?? []).map((x) => x.id)));

/** Installs a pack's crew into the current org. Refuses an org that already has a crew. */
export async function installPack(packId: string): Promise<{ counts: Record<string, number> }> {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack?.crew) throw new Error(`No installed template pack ${packId} brings a crew.`);
  for (const t of ["agents", "departments", "seats"] as const) {
    const { count, error } = await db().from(t).select("org_id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    if (count) throw new Error(`This org already has ${t}: a template installs only into an empty org.`);
  }
  const rows = installRows(pack.id, pack.crew);
  const counts: Record<string, number> = {};
  for (const t of ORDER) {
    if (!rows[t].length) continue;
    const { error } = await db().from(t).insert(rows[t]);
    if (error) throw new Error(`Installing ${pack.name} stopped at ${t} (${error.message}). Done before it: ${Object.keys(counts).join(", ") || "nothing"}.`);
    counts[t] = rows[t].length;
  }
  return { counts };
}

/**
 * A new org with its first owner, empty or from a pack's crew. Run by whoever runs the app
 * (npm run org:new); signing in to an org other than the home org isn't built yet.
 */
export async function newOrg(p: { slug: string; name: string; ownerEmail: string; packId?: string | null }): Promise<{ orgId: string; counts: Record<string, number> }> {
  const slug = p.slug.trim().toLowerCase(), name = p.name.trim(), email = normalEmail(p.ownerEmail);
  if (!SLUG.test(slug)) throw new Error("The slug is 2 to 41 lowercase letters, digits or dashes.");
  if (!name || name.length > 120) throw new Error("The name is 1 to 120 characters.");
  if (!email) throw new Error("The owner's email isn't an email address.");
  if (p.packId && !PACKS.some((x) => x.id === p.packId && x.crew)) throw new Error(`No installed template pack ${p.packId} brings a crew.`);
  const orgId = await createOrgRow(slug, name);
  return withOrg(orgId, async () => {
    const m = await db().from("members").insert({ email, role: "owner", added_by: "org:new" });
    if (m.error) throw new Error(`The org ${slug} was made but its owner wasn't added: ${m.error.message}`);
    const counts = p.packId ? (await installPack(p.packId)).counts : {};
    return { orgId, counts };
  });
}
