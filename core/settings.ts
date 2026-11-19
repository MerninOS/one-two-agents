import "server-only";
// Each business's own settings (core/settings-rules.ts), read for the current org: only what its
// owner saved on Settings. No business takes values from the app's settings in Vercel (card 135).
import { db } from "@/core/db";
import { orgId } from "@/core/tenancy";
import { NO_SETTINGS, SETTINGS_KEY, readSettings, type BusinessSettings } from "@/core/settings-rules";

const cache = new Map<string, { s: BusinessSettings; at: number }>();
const TTL_MS = 60_000;

/** The current org's settings, as its owner saved them. */
export async function settings(): Promise<BusinessSettings> {
  const org = await orgId();
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.s;
  const { data, error } = await db().from("policies").select("value_json").eq("key", SETTINGS_KEY).maybeSingle();
  if (error) console.error("[settings]", error.message);
  const s = error ? NO_SETTINGS : readSettings((data as { value_json?: unknown } | null)?.value_json);
  cache.set(org, { s, at: Date.now() });
  return s;
}

/** Saves the current org's settings. The caller has checked the member is an owner and the edit (checkSettingsEdit). */
export async function saveSettings(s: BusinessSettings): Promise<void> {
  const { error } = await db().from("policies").upsert({ key: SETTINGS_KEY, value_json: s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  cache.delete(await orgId());
}
