import "server-only";
// Rowan's code that the engine's tools call (core/tools/catalog.ts): what One Two offers a
// wholesale customer (wholesale_offer, the only facts an outreach email may claim) and the
// dedupe key for a lead's website (report_leads). Lead pages are untrusted: report_leads checks
// every lead in code before it is stored, and first emails are only ever draft cards.
import { PL_BAGS, PL_MIN, PL_PACK, roastName, wholesaleOf } from "@/domain/coffee";
import { env } from "@/core/env";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { fetchStockCoffees } from "@/integrations/shopify/stock";

// Profiles on these hosts belong to different businesses, so the profile path is part of the key.
const SHARED_HOSTS = new Set(["instagram.com", "facebook.com", "linktr.ee", "yelp.com", "google.com", "maps.google.com", "tiktok.com", "x.com", "twitter.com", "square.site", "toasttab.com"]);
/** Dedupe key for a lead's website: the host without www., plus the profile path on shared hosts. */
export const domainOf = (url: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!SHARED_HOSTS.has(host)) return host;
    const path = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase();
    return path ? `${host}/${path}` : null;
  } catch { return null; }
};
/** What One Two offers a wholesale customer, from Shopify. Rowan's emails may only claim these facts. */
export async function offer() {
  const [lots, stock] = await Promise.all([getInventoryLots(), fetchStockCoffees()]);
  return {
    site: `${env.siteUrl}/wholesale`,
    privateLabel: {
      minimumLb: PL_MIN,
      roastedToOrder: true,
      customBlend: "The shop can design its own house blend from our green lots, or take one of our coffees, under its own name.",
      bags: PL_BAGS.map((b) => b.label),
      packaging: PL_PACK.map((x) => `${x.title}: ${x.rate}`),
    },
    ourCoffees: stock.filter((s) => s.price > 0).map((s) => ({ name: s.name, about: s.sub, roast: roastName(s.roast), wholesalePerLb: s.price })),
    greenLots: lots.filter((l) => l.listed && l.avail > 0).map((l) => ({ name: l.name, origin: l.origin, process: l.process, wholesalePerLb: wholesaleOf(l) })),
  };
}
