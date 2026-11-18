import "server-only";
// Each business's own settings (core/settings-rules.ts), read for the current org. The home org
// starts from the app-wide settings in Vercel (BRIEF_TO, SITE_URL, SHOPIFY_STORE_DOMAIN, ...) until
// its owner saves its own; another org never sees those.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { HOME_ORG_ID, orgId } from "@/core/tenancy";
import { NO_SETTINGS, SETTINGS_KEY, effectiveSettings, readSettings, type BusinessSettings } from "@/core/settings-rules";

const cache = new Map<string, { s: BusinessSettings; own: BusinessSettings; at: number }>();
const TTL_MS = 60_000;

/** The app-wide values from before each org kept its own: the home org's starting settings. */
const homeDefaults = (): BusinessSettings => readSettings({
  ownerEmail: env.briefTo, siteUrl: env.siteUrl, shopifyDomain: env.shopifyDomain, shopifyClientId: env.shopifyClientId,
  mercuryAccountIds: env.mercuryAccountIds, notionBriefParent: env.notionBriefParent, notionBriefsDb: env.notionBriefsDb,
  notionLeadsParent: env.notionLeadsParent, notionBooksParent: env.notionBooksParent,
});

async function load(): Promise<{ s: BusinessSettings; own: BusinessSettings }> {
  const org = await orgId();
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const { data, error } = await db().from("policies").select("value_json").eq("key", SETTINGS_KEY).maybeSingle();
  if (error) console.error("[settings]", error.message);
  const own = error ? NO_SETTINGS : readSettings((data as { value_json?: unknown } | null)?.value_json);
  const s = effectiveSettings(own, org === HOME_ORG_ID ? homeDefaults() : null);
  cache.set(org, { s, own, at: Date.now() });
  return { s, own };
}

/** The current org's settings, with the home org's starting values filled in. */
export const settings = async (): Promise<BusinessSettings> => (await load()).s;

/** What the current org saved itself (Settings shows these; blank fields show the starting value as a hint). */
export const ownSettings = async (): Promise<BusinessSettings> => (await load()).own;

/** Saves the current org's settings. The caller has checked the member is an owner and the edit (checkSettingsEdit). */
export async function saveSettings(s: BusinessSettings): Promise<void> {
  const { error } = await db().from("policies").upsert({ key: SETTINGS_KEY, value_json: s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  cache.delete(await orgId());
}
