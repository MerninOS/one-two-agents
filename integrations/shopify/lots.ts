import "server-only";
// Green lots: unpublished Shopify products tagged `blended-green`, one inventory-tracked
// variant whose quantity is green coffee in grams, costs in blended.* metafields.
import type { GreenLot } from "@/domain/types";
import { G_PER_LB } from "@/domain/coffee";
import { admin, gql } from "./client";

const GREEN_QUERY = "tag:blended-green AND -status:archived";

const GREEN_LOTS = gql`
  query AgentGreenLots($query: String!) {
    products(first: 250, query: $query, sortKey: TITLE) {
      nodes {
        id handle title status
        variants(first: 1) { nodes { inventoryQuantity } }
        origin: metafield(namespace: "blended", key: "origin") { value }
        lot_code: metafield(namespace: "blended", key: "lot_code") { value }
        process: metafield(namespace: "blended", key: "process") { value }
        roast_level: metafield(namespace: "blended", key: "roast_level") { value }
        green_price: metafield(namespace: "blended", key: "green_price") { value }
        wholesale_price: metafield(namespace: "blended", key: "wholesale_price") { value }
        retail_price: metafield(namespace: "blended", key: "retail_price") { value }
      }
    }
  }
`;
type MF = { value: string } | null;
type Node = {
  id: string; handle: string; title: string; status: string;
  variants: { nodes: { inventoryQuantity: number | null }[] };
  origin: MF; lot_code: MF; process: MF; roast_level: MF; green_price: MF; wholesale_price: MF; retail_price: MF;
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
    wholesale: num(p.wholesale_price?.value),
    retail: num(p.retail_price?.value),
    avail: Math.round((grams / G_PER_LB) * 10) / 10,
    availG: grams,
    listed: p.status === "ACTIVE",
  };
}

/** Every green lot that isn't archived, listed or not, with live stock (total across locations). */
export async function getInventoryLots(): Promise<GreenLot[]> {
  const r = await admin<{ products: { nodes: Node[] } }>(GREEN_LOTS, { query: GREEN_QUERY });
  return r.products.nodes.map(lotFromProduct);
}
