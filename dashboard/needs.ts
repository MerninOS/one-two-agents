// "Needs you": things on the floor that want Zak, worked out from real runs and settings.
import { ACCESS, BUILT, BY_ID, INTEGRATIONS } from "./crew";
import type { Floor } from "./data";
import { stateOf } from "./status";

export type Priority = "High" | "Medium" | "Low";
export interface Need { pri: Priority; title: string; sub: string; href: string; agentId?: string }

export function needs(f: Floor, now = Date.now()): Need[] {
  const out: Need[] = [];
  if (!f.ok) out.push({ pri: "High", title: "Can’t read the agent database", sub: f.problem ?? "", href: "/integrations" });
  for (const r of f.runs) {
    const a = BY_ID[r.agent_id];
    if (!a) continue;
    const age = now - Date.parse(r.started_at);
    if (r.status === "failed" && age < 864e5) out.push({ pri: "High", title: `${a.name}’s run failed`, sub: r.error ?? r.summary ?? "", href: `/runs/${r.id}`, agentId: a.id });
    if (r.status === "running" && age > 6 * 6e4 && age < 7 * 864e5) out.push({ pri: "Medium", title: `${a.name}’s run never finished`, sub: "It passed the 5 minute limit without writing a result.", href: `/runs/${r.id}`, agentId: a.id });
  }
  for (const a of BUILT) {
    if (f.ok && stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0) === "over") out.push({ pri: "High", title: `${a.name} reached today’s budget`, sub: "Further runs today are skipped.", href: `/agents/${a.id}?tab=settings`, agentId: a.id });
    if (f.ok && !f.agents[a.id]) out.push({ pri: "High", title: `${a.name} isn’t in the agents table`, sub: "Apply the migrations to the one-two-agents Supabase project.", href: `/agents/${a.id}`, agentId: a.id });
  }
  if (f.photosWaiting) out.push({ pri: "Medium", title: `${f.photosWaiting} charge${f.photosWaiting === 1 ? "" : "s"} need a receipt photo`, sub: "Quinn couldn’t find a receipt. The list is on Quinn’s profile and the latest Books page in Notion.", href: "/agents/bookkeeper", agentId: "bookkeeper" });
  for (const i of INTEGRATIONS) {
    if (f.health[i.id] || i.id === "supabase") continue;
    const users = BUILT.filter((a) => ACCESS[a.id]?.[i.id]);
    if (!users.length) continue;
    out.push({
      pri: i.id === "gmail" || i.id === "gmail_read" ? "Low" : "Medium",
      title: `Connect ${i.name}`,
      sub: i.id === "gmail" ? "Rowan’s drafts land in Notion only until Gmail is connected." : i.id === "gmail_read" ? "Quinn can’t look for receipts in email until the read-only Gmail token is set." : `${users.map((u) => u.name).join(" and ")} ${users.length > 1 ? "need" : "needs"} it.`,
      href: "/integrations",
      agentId: users[0].id,
    });
  }
  const order: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => order[a.pri] - order[b.pri]);
}

export const PRI_COLOR: Record<Priority, string> = { High: "var(--acc)", Medium: "var(--yel)", Low: "var(--mint)" };
