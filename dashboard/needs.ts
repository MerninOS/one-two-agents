// "Needs you": things on the floor that want Zak, worked out from real runs and settings.
import { ACCESS, BUILT, BY_ID, INTEGRATIONS } from "./crew";
import type { Floor } from "./data";
import type { Seen } from "./seen";
import { stateOf } from "./status";

export type Priority = "High" | "Medium" | "Low";
/** `run` marks an alert about one run. Those clear once Zak opens the agent or the run; the rest stay until fixed. */
export interface Need { pri: Priority; title: string; sub: string; href: string; agentId?: string; run?: boolean }

export function needs(f: Floor, now = Date.now(), seen: Seen = {}): Need[] {
  const out: Need[] = [];
  // the latest real (not dry) run that worked, per agent: a failure before it is old news
  const lastOk: Record<string, number> = {};
  for (const r of f.runs) {
    if (r.status !== "ok" || r.summary?.startsWith("[dry run")) continue;
    lastOk[r.agent_id] = Math.max(lastOk[r.agent_id] ?? 0, Date.parse(r.started_at));
  }
  if (!f.ok) out.push({ pri: "High", title: "Can’t read the agent database", sub: f.problem ?? "", href: "/integrations" });
  for (const r of f.runs) {
    const a = BY_ID[r.agent_id];
    if (!a) continue;
    const at = Date.parse(r.started_at);
    const age = now - at;
    if (at <= (seen[a.id] ?? 0) || at < (lastOk[a.id] ?? 0)) continue;
    if (r.status === "failed" && age < 864e5) out.push({ pri: "High", title: `${a.name}’s run failed`, sub: r.error ?? r.summary ?? "", href: `/runs/${r.id}`, agentId: a.id, run: true });
    if (r.status === "running" && age > 6 * 6e4 && age < 7 * 864e5) out.push({ pri: "Medium", title: `${a.name}’s run never finished`, sub: "It passed the 5 minute limit without writing a result.", href: `/runs/${r.id}`, agentId: a.id, run: true });
  }
  for (const a of BUILT) {
    if (f.ok && stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0) === "over") out.push({ pri: "High", title: `${a.name} reached today’s budget`, sub: "Further runs today are skipped.", href: `/agents/${a.id}?tab=settings`, agentId: a.id });
    if (f.ok && !f.agents[a.id]) out.push({ pri: "High", title: `${a.name} isn’t in the agents table`, sub: "Apply the migrations to the one-two-agents Supabase project.", href: `/agents/${a.id}`, agentId: a.id });
  }
  if (f.approvalsPending) out.push({ pri: "High", title: `${f.approvalsPending} Mercury change${f.approvalsPending === 1 ? "" : "s"} waiting for your OK`, sub: "Quinn’s matched receipts and category suggestions. Nothing goes to Mercury until you approve.", href: "/approvals", agentId: "bookkeeper" });
  if (f.photosWaiting) out.push({ pri: "Medium", title: `${f.photosWaiting} charge${f.photosWaiting === 1 ? "" : "s"} need a receipt photo`, sub: "Quinn couldn’t find a receipt. The list is on Quinn’s profile and the latest Books page in Notion.", href: "/agents/bookkeeper", agentId: "bookkeeper" });
  for (const i of INTEGRATIONS) {
    if (f.health[i.id] || i.id === "supabase") continue;
    const users = BUILT.filter((a) => ACCESS[a.id]?.[i.id]);
    if (!users.length) continue;
    out.push({
      pri: i.id === "gmail" || i.id === "gmail_read" || i.id === "email" ? "Low" : "Medium",
      title: `Connect ${i.name}`,
      sub: i.id === "email" ? "Avery’s brief goes to Notion only until email is set up." : i.id === "gmail" ? "Rowan’s drafts land in Notion only until Gmail is connected." : i.id === "gmail_read" ? "Quinn can’t look for receipts in email until the read-only Gmail token is set." : `${users.map((u) => u.name).join(" and ")} ${users.length > 1 ? "need" : "needs"} it.`,
      href: "/integrations",
      agentId: users[0].id,
    });
  }
  const order: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => order[a.pri] - order[b.pri]);
}

export const PRI_COLOR: Record<Priority, string> = { High: "var(--acc)", Medium: "var(--yel)", Low: "var(--mint)" };
