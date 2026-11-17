import "server-only";
// Rowan's code that the pack's tools call (templates/one-two/tools.ts): what One Two offers a
// wholesale customer (wholesale_offer, the only facts an outreach email may claim). The dedupe key
// for a lead's website is core's (core/lead-rules.ts). Lead pages are untrusted: report_leads checks
// every lead in code before it is stored, and first emails are only ever draft cards.
import { PL_BAGS, PL_MIN, PL_PACK, roastName, wholesaleOf } from "@/templates/one-two/domain/coffee";
import { env } from "@/core/env";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { fetchStockCoffees } from "@/integrations/shopify/stock";

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
