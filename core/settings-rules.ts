// Each business's own settings (docs/tenancy.md, slice 8.1b): where the owner's emails go, the
// business's website, its Shopify store and Mercury accounts, and the Notion pages reports go
// under. Each org keeps them on Settings (a `business_settings` row in policies). Before this they
// were one setting each in Vercel for the whole app; those settings now count only for the home
// org, as its starting values, and never for another org. Pure, so check:settings can test it.

export interface BusinessSettings {
  /** Where the brief and alerts go: always one of the org's owners' sign-in addresses. */
  ownerEmail: string | null;
  /** The business's public website, named in outreach drafts. */
  siteUrl: string | null;
  /** The Shopify store, as its .myshopify.com address. */
  shopifyDomain: string | null;
  /** The read-only Shopify app's client id (a Dev Dashboard app); not a secret. */
  shopifyClientId: string | null;
  /** Mercury accounts that count as cash: "all" or account ids. Empty = cash not reported. */
  mercuryAccountIds: string[];
  /** Notion: the page briefs go under, the briefs database, and pages for leads and books. */
  notionBriefParent: string | null;
  notionBriefsDb: string | null;
  notionLeadsParent: string | null;
  notionBooksParent: string | null;
  /** What agents may say about the products (docs/product-facts.md): the Shopify collections they read, by handle. */
  productCollections: string[];
  /** The product fields (metafields, as namespace.key) read from those products. No other field leaves Shopify. */
  productFields: string[];
  /** The owner's own words on what the business offers (minimums, sizes, terms, the page to send people to). */
  offerTerms: string | null;
  /** Where the daily numbers' cost of goods comes from (docs/daily-numbers.md): none, Shopify's unit cost, or a number from the business's own tool. */
  costSource: CostSource;
  /** With costSource "own": the own number (its n_ key) that gives one day's cost of goods in dollars. */
  costNumber: string | null;
}

export type CostSource = "none" | "shopify" | "own";
export const COST_SOURCES: readonly CostSource[] = ["none", "shopify", "own"];
const COST_NUMBER = /^n_[0-9a-f]{12}$/;

export const SETTINGS_KEY = "business_settings";

export const NO_SETTINGS: BusinessSettings = {
  ownerEmail: null, siteUrl: null, shopifyDomain: null, shopifyClientId: null, mercuryAccountIds: [],
  notionBriefParent: null, notionBriefsDb: null, notionLeadsParent: null, notionBooksParent: null,
  productCollections: [], productFields: [], offerTerms: null, costSource: "none", costNumber: null,
};

export const MAX_COLLECTIONS = 5, MAX_PRODUCT_FIELDS = 20, OFFER_TERMS_MAX = 1500;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const FIELD = /^[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{1,64}$/;
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : text(v).split(/[\s,]+/)).map((s) => s.trim()).filter(Boolean);

/** Shopify collection handles, lower case, at most five; anything else is dropped. */
export const collectionHandles = (v: unknown): string[] => [...new Set(listOf(v).map((s) => s.toLowerCase()).filter((s) => HANDLE.test(s)))].slice(0, MAX_COLLECTIONS);
/** Product fields as namespace.key, at most twenty; anything else is dropped. */
export const productFields = (v: unknown): string[] => [...new Set(listOf(v).filter((s) => FIELD.test(s)))].slice(0, MAX_PRODUCT_FIELDS);
/** The owner's offer terms: plain text with line breaks, no control characters, every link https; null when empty or unsafe. */
export function offerTerms(v: unknown): string | null {
  const t = (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!t || t.length > OFFER_TERMS_MAX) return null;
  if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(t)) return null;
  if (/\b(?!https:)[a-z][a-z0-9+.-]*:\/\//i.test(t) || /\b(javascript|data|vbscript):/i.test(t)) return null;
  return t;
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,80}$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A Notion page or database id from an id or a Notion link (the last 32 hex characters), dashed; null if none. */
export function notionId(v: unknown): string | null {
  const t = text(v);
  if (!t) return null;
  if (/^https?:\/\//i.test(t) && !/^https:\/\/([a-z0-9-]+\.)?notion\.(so|site|com)\//i.test(t)) return null;
  const hex = t.replace(/[?#].*$/, "").replace(/-/g, "").match(/([0-9a-f]{32})$/i)?.[1];
  if (!hex) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A website as https://host[/path], without a trailing slash; null if it isn't one. */
export function siteUrl(v: unknown): string | null {
  const t = text(v);
  if (!t) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !u.hostname.includes(".")) return null;
  return `https://${u.hostname}${u.pathname}`.replace(/\/+$/, "");
}

/** "all", or Mercury account ids (uuids); anything else is dropped. */
export function accountIds(v: unknown): string[] {
  const parts = (Array.isArray(v) ? v : text(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === "all")) return ["all"];
  return [...new Set(parts.filter((p) => UUID.test(p)).map((p) => p.toLowerCase()))];
}

/** Settings from a stored row, each field checked again; a field that doesn't read is left out. */
export function readSettings(raw: unknown): BusinessSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const email = text(r.ownerEmail).toLowerCase();
  const shop = text(r.shopifyDomain).toLowerCase();
  const client = text(r.shopifyClientId);
  return {
    ownerEmail: EMAIL.test(email) ? email : null,
    siteUrl: siteUrl(r.siteUrl),
    shopifyDomain: SHOP.test(shop) ? shop : null,
    shopifyClientId: CLIENT_ID.test(client) ? client : null,
    mercuryAccountIds: accountIds(r.mercuryAccountIds),
    notionBriefParent: notionId(r.notionBriefParent),
    notionBriefsDb: notionId(r.notionBriefsDb),
    notionLeadsParent: notionId(r.notionLeadsParent),
    notionBooksParent: notionId(r.notionBooksParent),
    productCollections: collectionHandles(r.productCollections),
    productFields: productFields(r.productFields),
    offerTerms: offerTerms(r.offerTerms),
    ...costOf(r.costSource, r.costNumber),
  };
}

/** The cost of goods source: "own" only with a number picked; anything else reads as none. */
function costOf(source: unknown, num: unknown): Pick<BusinessSettings, "costSource" | "costNumber"> {
  const n = text(num);
  if (source === "own") return COST_NUMBER.test(n) ? { costSource: "own", costNumber: n } : { costSource: "none", costNumber: null };
  return { costSource: source === "shopify" ? "shopify" : "none", costNumber: null };
}

/** The settings an org works with: its own, and only for the home org, the old app-wide values where it has none. */
export function effectiveSettings(own: BusinessSettings, homeDefaults: BusinessSettings | null): BusinessSettings {
  if (!homeDefaults) return own;
  const pick = <K extends keyof BusinessSettings>(k: K): BusinessSettings[K] => {
    const v = own[k];
    return (Array.isArray(v) ? v.length : v) ? v : homeDefaults[k];
  };
  const out = { ...own };
  for (const k of Object.keys(own) as (keyof BusinessSettings)[]) (out as Record<string, unknown>)[k] = pick(k);
  // leads and books pages fall back to the briefs page, as the old settings did
  out.notionLeadsParent ??= out.notionBriefParent;
  out.notionBooksParent ??= out.notionBriefParent;
  return out;
}

export interface SettingsEdit {
  ownerEmail: string; siteUrl: string; shopifyDomain: string; shopifyClientId: string; mercuryAccountIds: string;
  notionBriefParent: string; notionBriefsDb: string; notionLeadsParent: string; notionBooksParent: string;
  productCollections: string; productFields: string; offerTerms: string;
  costSource: string; costNumber: string;
}

/** Stored settings as Settings' text fields: what one card keeps when another card saves. */
export const editOf = (b: BusinessSettings): SettingsEdit => ({
  ownerEmail: b.ownerEmail ?? "", siteUrl: b.siteUrl ?? "", shopifyDomain: b.shopifyDomain ?? "", shopifyClientId: b.shopifyClientId ?? "",
  mercuryAccountIds: b.mercuryAccountIds.join(", "), notionBriefParent: b.notionBriefParent ?? "", notionBriefsDb: b.notionBriefsDb ?? "",
  notionLeadsParent: b.notionLeadsParent ?? "", notionBooksParent: b.notionBooksParent ?? "",
  productCollections: b.productCollections.join(", "), productFields: b.productFields.join(", "), offerTerms: b.offerTerms ?? "",
  costSource: b.costSource, costNumber: b.costNumber ?? "",
});

/**
 * What's wrong with an edit from Settings, or the settings to save. The owner email must be one of
 * the org's owners: the brief and alerts never go to anyone who couldn't sign in as an owner.
 */
export function checkSettingsEdit(e: SettingsEdit, ownerEmails: readonly string[]): { problem: string } | { settings: BusinessSettings } {
  const s = readSettings(e);
  const email = text(e.ownerEmail).toLowerCase();
  if (email && !ownerEmails.includes(email)) return { problem: "The owner email must be the sign-in address of one of this business’s owners." };
  if (text(e.siteUrl) && !s.siteUrl) return { problem: "The website needs to be an https address, like https://example.com." };
  if (text(e.shopifyDomain) && !s.shopifyDomain) return { problem: "The Shopify store is its .myshopify.com address, like your-store.myshopify.com." };
  if (text(e.shopifyClientId) && !s.shopifyClientId) return { problem: "That doesn’t look like a Shopify app’s client id." };
  if (text(e.mercuryAccountIds) && !s.mercuryAccountIds.length) return { problem: "Mercury accounts are \"all\" or account ids separated by commas." };
  for (const [k, label] of [["notionBriefParent", "briefs page"], ["notionBriefsDb", "briefs database"], ["notionLeadsParent", "leads page"], ["notionBooksParent", "books page"]] as const) {
    if (text(e[k]) && !s[k]) return { problem: `The Notion ${label} needs a Notion link or page id.` };
  }
  const asked = (k: "productCollections" | "productFields") => listOf(e[k]);
  if (asked("productCollections").length > MAX_COLLECTIONS) return { problem: `At most ${MAX_COLLECTIONS} collections.` };
  if (asked("productCollections").length !== s.productCollections.length) return { problem: "Collections are Shopify collection handles, like our-coffees, separated by commas." };
  if (asked("productFields").length > MAX_PRODUCT_FIELDS) return { problem: `At most ${MAX_PRODUCT_FIELDS} product fields.` };
  if (asked("productFields").length !== s.productFields.length) return { problem: "Product fields are metafields written namespace.key, like custom.origin, separated by commas." };
  if (text(e.offerTerms).length > OFFER_TERMS_MAX) return { problem: `Offer terms are at most ${OFFER_TERMS_MAX} characters.` };
  if (text(e.offerTerms) && !s.offerTerms) return { problem: "Offer terms are plain text; any link in them must start with https://." };
  if (e.costSource && !COST_SOURCES.includes(e.costSource as CostSource)) return { problem: "Pick where cost of goods comes from." };
  if (e.costSource === "own" && s.costSource !== "own") return { problem: "Pick the number from your own tool that gives a day’s cost of goods." };
  return { settings: s };
}
