// What agents may say about the business's products (docs/product-facts.md): the only facts about
// products, lots, origins or certifications that an outside message may claim. Pure, so
// check:product-facts can test it. The facts come from Shopify (core/shopify-rules.ts
// shopify_product_facts) and the business's own offer terms (Settings), never from a model.

/** One product as our Shopify server returns it. */
export interface ShopifyProductNode {
  handle: string; title: string; description: string | null; productType: string | null; vendor: string | null; tags: string[];
  status: string; tracksInventory: boolean; totalInventory: number | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string }; maxVariantPrice: { amount: string; currencyCode: string } } | null;
  metafields: { nodes: { namespace: string; key: string; value: string | null }[] } | null;
}
export interface ShopifyCollectionResult { collectionByIdentifier: { handle: string; title: string; products: { nodes: ShopifyProductNode[] } } | null }

/** One product, as an agent sees it: plain facts, every value from Shopify. */
export interface ProductFact {
  name: string; handle: string; about: string; type: string | null; vendor: string | null; tags: string[];
  price: { from: number; to: number; currency: string } | null;
  fields: Record<string, string>;
}
export interface CollectionFacts { collection: string; title: string; products: ProductFact[] }

const ABOUT_MAX = 600, FIELD_MAX = 300, TAGS_MAX = 20;
const clip = (s: string | null | undefined, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * The facts in one collection: active products only, not tracked products that are sold out, and
 * only the fields the business chose (checked again here, whatever Shopify sent back).
 */
export function collectionFacts(r: ShopifyCollectionResult, chosenFields: readonly string[]): CollectionFacts | null {
  const c = r.collectionByIdentifier;
  if (!c) return null;
  const allowed = new Set(chosenFields);
  const products = c.products.nodes
    .filter((p) => p.status === "ACTIVE" && !(p.tracksInventory && (p.totalInventory ?? 0) <= 0))
    .map((p): ProductFact => {
      const fields: Record<string, string> = {};
      for (const m of p.metafields?.nodes ?? []) {
        const k = `${m.namespace}.${m.key}`;
        if (allowed.has(k) && m.value != null && m.value !== "") fields[k] = clip(m.value, FIELD_MAX);
      }
      const min = Number(p.priceRangeV2?.minVariantPrice.amount), max = Number(p.priceRangeV2?.maxVariantPrice.amount);
      return {
        name: clip(p.title, 200), handle: p.handle, about: clip(p.description, ABOUT_MAX),
        type: clip(p.productType, 100) || null, vendor: clip(p.vendor, 100) || null, tags: p.tags.slice(0, TAGS_MAX).map((t) => clip(t, 60)),
        price: p.priceRangeV2 && Number.isFinite(min) && Number.isFinite(max) ? { from: min, to: max, currency: p.priceRangeV2.minVariantPrice.currencyCode } : null,
        fields,
      };
    });
  return { collection: c.handle, title: clip(c.title, 200), products };
}
