import "server-only";
// The crew flow store: the versioned flow in crew_flow. The rules (types, palette, checks, time)
// are in core/flow-rules.ts, which the browser can use too.
import { db } from "@/core/db";
import { readFlow, type Flow } from "@/core/flow-rules";

export * from "@/core/flow-rules";

export interface FlowVersion { version: number; active: boolean; note: string | null; createdBy: string; createdAt: string; flow: Flow; problems: string[] }

/** The active flow. Throws when the table can't be read. An empty flow when there is no version yet. */
export async function loadFlow(agents: readonly string[]): Promise<FlowVersion> {
  const { data, error } = await db().from("crew_flow").select("version, flow, note, created_by, created_at, active").eq("active", true).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { version: 0, active: true, note: null, createdBy: "", createdAt: "", flow: { chains: [] }, problems: [] };
  const { flow, problems } = readFlow(data.flow, agents);
  return { version: data.version, active: true, note: data.note, createdBy: data.created_by, createdAt: data.created_at, flow, problems };
}

export async function listFlowVersions(agents: readonly string[]): Promise<FlowVersion[]> {
  const { data, error } = await db().from("crew_flow").select("version, flow, note, created_by, created_at, active").order("version", { ascending: false }).limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => { const { flow, problems } = readFlow(r.flow, agents); return { version: r.version, active: r.active, note: r.note, createdBy: r.created_by, createdAt: r.created_at, flow, problems }; });
}

/** Saves the flow as the next version and makes it active. The caller has checked the login, controls and confirm. */
export async function saveFlowVersion(flow: Flow, note: string, by: string, previous: number): Promise<number> {
  const { data: top, error: e1 } = await db().from("crew_flow").select("version").order("version", { ascending: false }).limit(1).maybeSingle();
  if (e1) throw new Error(e1.message);
  const version = (top?.version ?? 0) + 1;
  const { error } = await db().from("crew_flow").insert({ version, flow, note, created_by: by, active: false });
  if (error) throw new Error(error.message);
  await activateFlow(version, previous);
  return version;
}

export async function activateFlow(version: number, previous: number) {
  if (previous) {
    const { error } = await db().from("crew_flow").update({ active: false }).eq("version", previous);
    if (error) throw new Error(error.message);
  }
  const { error } = await db().from("crew_flow").update({ active: true }).eq("version", version);
  if (error) {
    if (previous) await db().from("crew_flow").update({ active: true }).eq("version", previous);
    throw new Error(error.message);
  }
}

