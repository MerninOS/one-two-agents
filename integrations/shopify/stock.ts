import "server-only";
// Our coffees: the products in the "Our coffees" collection (SHOPIFY_STOCK_COLLECTION).
// The storefront reads these through the Storefront API; agents use the Admin API so one
// read-only token covers everything, and skip anything not ACTIVE (the storefront only
// sees published products).
import type { StockCoffee } from "@/domain/types";
import { sizeFromOption } from "@/domain/coffee";
import { env } from "@/core/env";
import { admin, gql } from "./client";

const STOCK = gql`
  query AgentStockCoffees($handle: String!) {
    collectionByIdentifier(identifier: { handle: $handle }) {
      products(first: 50, sortKey: COLLECTION_DEFAULT) {
        nodes {
          id handle title description status
          variants(first: 10) { nodes { id price availableForSale selectedOptions { name value } } }
          roast: metafield(namespace: "blended", key: "roast_level") { value }
          wholesale: metafield(namespace: "blended", key: "wholesale_price") { value }
          subtitle: metafield(namespace: "blended", key: "subtitle") { value }
          kind: metafield(namespace: "blended", key: "kind") { value }
          recipe: metafield(namespace: "blended", key: "recipe") { value }
        }
      }
    }
  }
`;
type MF = { value: string } | null;
type Node = {
  id: string; handle: string; title: string; description: string; status: string;
  variants: { nodes: { id: string; price: string; availableForSale: boolean; selectedOptions: { name: string; value: string }[] }[] };
  roast: MF; wholesale: MF; subtitle: MF; kind: MF; recipe: MF;
};

const num = (v: string | null | undefined, d: number) => {
  const n = Number(v); return v == null || v === "" || isNaN(n) ? d : n;
};

function stockFromProduct(p: Node): StockCoffee {
  const variants: StockCoffee["variants"] = {};
  for (const v of p.variants.nodes) {
    const opt = v.selectedOptions.find((o) => /size|weight/i.test(o.name)) ?? v.selectedOptions[0];
    const id = opt && sizeFromOption(opt.value);
    if (id) variants[id] = { id: v.id, price: Number(v.price), available: v.availableForSale };
  }
  const sub = p.subtitle?.value || "";
  const kindField = p.kind?.value?.trim().toLowerCase();
  return {
    id: p.handle, gid: p.id, name: p.title, sub,
    roast: num(p.roast?.value, 3),
    price: num(p.wholesale?.value, 0),
    variants,
    // same rule as the storefront: the kind field, else "blend" in the subtitle's first part
    kind: kindField ? (kindField.startsWith("blend") ? "blend" : "single") : /blend/i.test(sub.split(/\s*·\s*/)[0] ?? "") ? "blend" : "single",
    recipe: p.recipe?.value?.trim() || undefined,
    blurb: p.description,
  };
}

/** Our coffees as Shopify has them. */
export async function fetchStockCoffees(): Promise<StockCoffee[]> {
  const r = await admin<{ collectionByIdentifier: { products: { nodes: Node[] } } | null }>(STOCK, { handle: env.shopifyStockCollection });
  return (r.collectionByIdentifier?.products.nodes ?? []).filter((p) => p.status === "ACTIVE").map(stockFromProduct);
}
