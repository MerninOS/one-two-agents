import "server-only";
// Green lots: unpublished Shopify products tagged `blended-green`, one inventory-tracked
// variant whose quantity is green coffee in grams, costs in blended.* metafields. Read through our
// Shopify MCP server (integrations/shopify-server.ts, docs/mcp-everywhere.md slice 7).
import type { GreenLot } from "@/templates/one-two/domain/types";
import { G_PER_LB } from "@/templates/one-two/domain/coffee";
import { callMcpTool } from "@/integrations/mcp";

type MF = { value: string } | null;
type Node = {
  id: string; handle: string; title: string; status: string;
  variants: { nodes: { inventoryQuantity: number | null }[] };
  origin: MF; lot_code: MF; process: MF; roast_level: MF; green_price: MF;
};

const num = (v: string | null | undefined, d: number | null = null) => {
  if (v == null || v === "") return d;
  const n = Number(v); return isNaN(n) ? d : n;
};

function lotFromProduct(p: Node): GreenLot {
  const grams = Math.max(0, p.variants.nodes[0]?.inventoryQuantity ?? 0);
  return {
    id: p.handle,
    gid: p.id,
    name: p.title,
    origin: p.origin?.value || "",
    lot: p.lot_code?.value || "",
    process: p.process?.value || "Washed",
    roast: num(p.roast_level?.value, 3)!,
    price: num(p.green_price?.value, 0)!,
    avail: Math.round((grams / G_PER_LB) * 10) / 10,
    availG: grams,
    listed: p.status === "ACTIVE",
  };
}

/** Every green lot that isn't archived, listed or not, with live stock (total across locations). */
export async function getInventoryLots(): Promise<GreenLot[]> {
  const r = (await callMcpTool("shopify", "shopify_green_lots", {})) as { products: { nodes: Node[] } };
  return r.products.nodes.map(lotFromProduct);
}
