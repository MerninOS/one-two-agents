import "server-only";
// The org switch (docs/org-schedule.md): the policies row `org`. While it is off, nothing starts on
// its own: the dispatcher starts no scheduled chain (and no waiting step of one) and a decided
// approval starts no chain. The Run button and Run chain still work for agents on duty. A missing
// or unreadable row counts as off, so nothing runs by mistake.
import { db } from "@/core/db";

export interface OrgState { on: boolean; at: string | null; by: string | null; /** False when the row can't be read (before the migration, or an error). */ known: boolean }

export async function orgState(): Promise<OrgState> {
  const { data, error } = await db().from("policies").select("value_json").eq("key", "org").maybeSingle();
  if (error || !data) return { on: false, at: null, by: null, known: false };
  const v = (data.value_json ?? {}) as { on?: unknown; at?: unknown; by?: unknown };
  return { on: v.on === true, at: typeof v.at === "string" ? v.at : null, by: typeof v.by === "string" ? v.by : null, known: true };
}

export const orgOn = async () => (await orgState()).on;

/** Sets the switch. The caller has checked the login, and for turning on, Controls and the confirm. */
export async function setOrg(on: boolean, by: string): Promise<void> {
  const { error } = await db().from("policies").upsert({ key: "org", value_json: { on, at: new Date().toISOString(), by }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
