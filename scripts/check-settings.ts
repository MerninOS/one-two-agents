// Each business's own settings (docs/tenancy.md, slice 8.1b): `npm run check:settings`. Pure.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_SETTINGS, accountIds, checkSettingsEdit, effectiveSettings, notionId, readSettings, siteUrl, type SettingsEdit } from "../core/settings-rules";

// Notion ids from ids or links; nothing else
const ID = "0123456789abcdef0123456789abcdef";
const DASHED = "01234567-89ab-cdef-0123-456789abcdef";
assert.equal(notionId(ID), DASHED);
assert.equal(notionId(DASHED), DASHED);
assert.equal(notionId(`https://www.notion.so/My-Page-${ID}?v=1`), DASHED);
assert.equal(notionId(`https://app.notion.com/p/${ID}`), DASHED);
assert.equal(notionId(`https://evil.example/${ID}`), null, "only Notion's own links");
assert.equal(notionId("nope"), null);
assert.equal(notionId(""), null);

// websites: https only, no credentials or ports
assert.equal(siteUrl("example.com"), "https://example.com");
assert.equal(siteUrl("https://example.com/shop/"), "https://example.com/shop");
assert.equal(siteUrl("http://example.com"), null);
assert.equal(siteUrl("https://user:pw@example.com"), null);
assert.equal(siteUrl("https://example.com:8443"), null);
assert.equal(siteUrl("localhost"), null);

// Mercury accounts: "all" or uuids
assert.deepEqual(accountIds("all"), ["all"]);
assert.deepEqual(accountIds(" 0E1A7C4E-0001-4000-8000-000000000001 , junk"), ["0e1a7c4e-0001-4000-8000-000000000001"]);
assert.deepEqual(accountIds(""), []);

// a stored row is read again field by field
const r = readSettings({ ownerEmail: " Owner@Example.com ", shopifyDomain: "Shop.myshopify.com", siteUrl: "javascript:alert(1)", notionBriefParent: ID, mercuryAccountIds: ["all"], shopifyClientId: "x" });
assert.equal(r.ownerEmail, "owner@example.com");
assert.equal(r.shopifyDomain, "shop.myshopify.com");
assert.equal(r.siteUrl, null);
assert.equal(r.shopifyClientId, null, "too short for a client id");
assert.deepEqual(readSettings(null), NO_SETTINGS);
assert.deepEqual(readSettings("junk"), NO_SETTINGS);

// the app-wide values count only for the home org, and only where it saved none
const home = readSettings({ ownerEmail: "home@example.com", shopifyDomain: "home.myshopify.com", notionBriefParent: ID });
const own = readSettings({ shopifyDomain: "mine.myshopify.com" });
assert.deepEqual(effectiveSettings(own, null).ownerEmail, null, "another org never gets the home org's address");
assert.equal(effectiveSettings(own, null).shopifyDomain, "mine.myshopify.com");
const h = effectiveSettings(own, home);
assert.equal(h.ownerEmail, "home@example.com");
assert.equal(h.shopifyDomain, "mine.myshopify.com", "the org's own value wins");
assert.equal(h.notionLeadsParent, DASHED, "leads fall back to the briefs page");

// edits: the owner email is always one of the org's owners
const edit = (p: Partial<SettingsEdit>): SettingsEdit => ({ ownerEmail: "", siteUrl: "", shopifyDomain: "", shopifyClientId: "", mercuryAccountIds: "", notionBriefParent: "", notionBriefsDb: "", notionLeadsParent: "", notionBooksParent: "", productCollections: "", productFields: "", offerTerms: "", costSource: "", costNumber: "", ...p });
const owners = ["owner@example.com"];
assert.ok("problem" in checkSettingsEdit(edit({ ownerEmail: "someone@else.com" }), owners));
assert.ok("settings" in checkSettingsEdit(edit({ ownerEmail: "Owner@Example.com" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ siteUrl: "http://x.com" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ shopifyDomain: "shop.com" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ notionBooksParent: "not a page" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ mercuryAccountIds: "savings" }), owners));
const ok = checkSettingsEdit(edit({ shopifyDomain: "s.myshopify.com", notionBriefParent: `https://www.notion.so/${ID}` }), owners);
assert.ok("settings" in ok && ok.settings.notionBriefParent === DASHED);

// the app-wide settings are read only by core/settings.ts (and core/env.ts, which defines them)
const OLD = /env\.(briefTo|siteUrl|shopifyDomain|shopifyClientId|mercuryAccountIds|notionBriefParent|notionLeadsParent|notionBooksParent|notionBriefsDb)\b/;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "node_modules" || f.startsWith(".") ? [] : walk(p)) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
for (const dir of ["app", "core", "dashboard", "integrations", "agents", "templates"]) {
  for (const f of walk(dir)) {
    if (f === "core/settings.ts" || f === "core/env.ts") continue;
    assert.ok(!OLD.test(readFileSync(f, "utf8")), `${f} reads a business setting from the environment; use settings() (core/settings.ts)`);
  }
}
// cost of goods source (card 133.5): "own" needs a goal number key, anything else reads as none
const KEY = "n_0123456789ab";
assert.equal(readSettings({ costSource: "shopify" }).costSource, "shopify");
assert.deepEqual([readSettings({ costSource: "own", costNumber: KEY }).costSource, readSettings({ costSource: "own", costNumber: KEY }).costNumber], ["own", KEY]);
assert.equal(readSettings({ costSource: "own", costNumber: "green_cost" }).costSource, "none");
assert.equal(readSettings({ costSource: "own" }).costSource, "none");
assert.equal(readSettings({ costSource: "something" }).costSource, "none");
assert.equal(readSettings({}).costSource, "none");
assert.equal(readSettings({ costSource: "shopify", costNumber: KEY }).costNumber, null);
assert.ok("problem" in checkSettingsEdit(edit({ costSource: "bogus" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ costSource: "own" }), owners));
assert.ok("problem" in checkSettingsEdit(edit({ costSource: "own", costNumber: "x" }), owners));
const ownEdit = checkSettingsEdit(edit({ costSource: "own", costNumber: KEY }), owners);
assert.ok("settings" in ownEdit && ownEdit.settings.costSource === "own" && ownEdit.settings.costNumber === KEY);
assert.match(readFileSync("dashboard/orgActions.ts", "utf8"), /export async function saveDailyNumbers\([^\n]*\n\s+const \{ me, no \} = await asRole\("owner"\)/);
// email to the owner still has no recipient argument
assert.match(readFileSync("integrations/email.ts", "utf8"), /export async function emailOwner\(subject: string, html: string, text: string\)/);
console.log("check:settings ok");
