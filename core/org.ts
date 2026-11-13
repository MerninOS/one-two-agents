import "server-only";
// The org chart store (docs/org-chart.md): departments and seats in Supabase. The rules (tree,
// limits, who reports to whom) are in core/org-rules.ts, which the browser can use too.
// Callers check the login and that an agent id is one the Control Room knows.
import { db } from "@/core/db";
import {
  MAX_DEPARTMENTS, MAX_DEPTH, MAX_SEATS, childrenOf, cleanSub, cleanTitle, depthOf, deptSlug, headOf,
  type Department, type Holder, type Org, type Seat,
} from "@/core/org-rules";

export * from "@/core/org-rules";

interface SeatRow { id: string; department_id: string | null; parent_id: string | null; title: string; sub: string; holder: Holder; agent_id: string | null; sort: number }

const toSeat = (r: SeatRow): Seat => ({ id: r.id, departmentId: r.department_id, parentId: r.parent_id, title: r.title, sub: r.sub ?? "", holder: r.holder, agentId: r.agent_id, sort: r.sort });

/** The chart. Null when the org chart migration isn't applied yet. */
export async function loadOrg(): Promise<Org | null> {
  const [d, s] = await Promise.all([
    db().from("departments").select("id, name, sort").order("sort"),
    db().from("seats").select("id, department_id, parent_id, title, sub, holder, agent_id, sort").order("sort"),
  ]);
  if (d.error || s.error) return null;
  return { departments: (d.data ?? []) as Department[], seats: ((s.data ?? []) as SeatRow[]).map(toSeat) };
}

async function mustLoad(): Promise<Org> {
  const o = await loadOrg();
  if (!o) throw new Error("The org chart migration (20261115090000_org_chart.sql) isn’t applied yet.");
  return o;
}

const mustSeat = (o: Org, id: string) => {
  const s = o.seats.find((x) => x.id === id);
  if (!s) throw new Error("That seat isn’t on the chart any more.");
  return s;
};

/** A new department with an open head seat. Returns its id. */
export async function addDepartment(name: string): Promise<string> {
  const o = await mustLoad();
  const n = cleanTitle(name);
  if (!n) throw new Error("Give the department a name.");
  if (o.departments.length >= MAX_DEPARTMENTS) throw new Error(`A chart holds ${MAX_DEPARTMENTS} departments at most.`);
  if (o.seats.length >= MAX_SEATS) throw new Error(`A chart holds ${MAX_SEATS} seats at most.`);
  if (o.departments.some((d) => d.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a ${n} department.`);
  let id = deptSlug(n);
  for (let i = 2; o.departments.some((d) => d.id === id); i++) id = `${deptSlug(n).slice(0, 36)}_${i}`;
  const sort = Math.max(0, ...o.departments.map((d) => d.sort)) + 1;
  const a = await db().from("departments").insert({ id, name: n, sort });
  if (a.error) throw new Error(a.error.message);
  const b = await db().from("seats").insert({ department_id: id, parent_id: null, title: `Head of ${n.toLowerCase()}`.slice(0, 60), sub: "", holder: "open", sort: 0 });
  if (b.error) { await db().from("departments").delete().eq("id", id); throw new Error(b.error.message); }
  return id;
}

export async function renameDepartment(id: string, name: string) {
  const o = await mustLoad();
  const n = cleanTitle(name);
  if (!n) throw new Error("Give the department a name.");
  if (!o.departments.some((d) => d.id === id)) throw new Error("That department isn’t on the chart any more.");
  if (o.departments.some((d) => d.id !== id && d.name.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a ${n} department.`);
  const { error } = await db().from("departments").update({ name: n }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Only a department where nobody sits: every seat open. Its seats go with it. */
export async function removeDepartment(id: string) {
  const o = await mustLoad();
  const d = o.departments.find((x) => x.id === id);
  if (!d) throw new Error("That department isn’t on the chart any more.");
  const seats = o.seats.filter((s) => s.departmentId === id);
  const held = seats.filter((s) => s.holder !== "open");
  if (held.length) throw new Error(`Move ${held.map((s) => `“${s.title}”`).join(", ")} out of ${d.name} first: only a department with every seat open can be removed.`);
  // deepest first, so no seat is removed while another still sits under it
  const order = [...seats].sort((a, b) => depthOf(o, b) - depthOf(o, a));
  for (const s of order) {
    const { error } = await db().from("seats").delete().eq("id", s.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await db().from("departments").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** A new open seat under another seat in a department. Returns its id. */
export async function addSeat(parentId: string, title: string, sub: string): Promise<string> {
  const o = await mustLoad();
  const parent = mustSeat(o, parentId);
  if (parent.departmentId == null) throw new Error("Seats go inside a department. Add a department for a new head.");
  const t = cleanTitle(title);
  if (!t) throw new Error("Give the seat a name.");
  if (o.seats.length >= MAX_SEATS) throw new Error(`A chart holds ${MAX_SEATS} seats at most.`);
  if (depthOf(o, parent) + 1 > MAX_DEPTH) throw new Error(`A department goes ${MAX_DEPTH} levels deep at most.`);
  const sort = Math.max(0, ...childrenOf(o, parentId).map((s) => s.sort)) + 1;
  const { data, error } = await db().from("seats").insert({ department_id: parent.departmentId, parent_id: parentId, title: t, sub: cleanSub(sub), holder: "open", sort }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function editSeat(id: string, title: string, sub: string) {
  const o = await mustLoad();
  mustSeat(o, id);
  const t = cleanTitle(title);
  if (!t) throw new Error("Give the seat a name.");
  const { error } = await db().from("seats").update({ title: t, sub: cleanSub(sub), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Only an open seat with nothing under it. A head goes with its department. */
export async function removeSeat(id: string) {
  const o = await mustLoad();
  const s = mustSeat(o, id);
  if (s.departmentId == null) throw new Error("The company seat stays.");
  if (headOf(o, s.departmentId)?.id === id) throw new Error("A department keeps its head seat. Remove the department instead.");
  if (s.holder !== "open") throw new Error("Move whoever sits there out first.");
  if (childrenOf(o, id).length) throw new Error("Remove the seats under it first.");
  const { error } = await db().from("seats").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * Who sits in a seat. An agent moves: its old seat opens. The caller has checked the agent id is
 * one the Control Room knows.
 */
export async function setHolder(seatId: string, holder: Holder, agentId: string | null) {
  const o = await mustLoad();
  const s = mustSeat(o, seatId);
  if (holder === "agent" && !agentId) throw new Error("Pick an agent.");
  const now = new Date().toISOString();
  if (holder === "agent") {
    const was = o.seats.find((x) => x.agentId === agentId && x.id !== seatId);
    if (was) {
      const { error } = await db().from("seats").update({ holder: "open", agent_id: null, updated_at: now }).eq("id", was.id);
      if (error) throw new Error(error.message);
    }
  }
  const { error } = await db().from("seats").update({ holder, agent_id: holder === "agent" ? agentId : null, updated_at: now }).eq("id", s.id);
  if (error) throw new Error(error.message);
}

/** Takes an agent off the chart: its seat opens. */
export async function unseat(agentId: string) {
  const { error } = await db().from("seats").update({ holder: "open", agent_id: null, updated_at: new Date().toISOString() }).eq("agent_id", agentId);
  if (error) throw new Error(error.message);
}
