// What agents may say about the products (docs/product-facts.md): `npm run check:product-facts`.
// Pure: no database, no network. The facts come from the business's own Shopify collections and
// fields and its own offer terms on Settings; the model picks nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { collectionFacts, type ShopifyCollectionResult, type ShopifyProductNode } from "../core/product-facts-rules";
import { CORE_SHOPIFY, NO_FIELDS_KEY, assertReadOnly } from "../core/shopify-rules";
import { shopifyVariables } from "../core/shopify-queries";
import { NO_SETTINGS, checkSettingsEdit, collectionHandles, editOf, offerTerms, productFields, readSettings, type SettingsEdit } from "../core/settings-rules";

// ---- Settings: collections, fields and offer terms are checked in code
assert.deepEqual(collectionHandles("Our-Coffees, wholesale  wholesale, bad handle!, -x"), ["our-coffees", "wholesale", "bad"]);
assert.deepEqual(collectionHandles("a,b,c,d,e,f,g"), ["a", "b", "c", "d", "e"], "at most five collections");
assert.deepEqual(productFields("custom.origin, shop.roast_level, nope, a.b.c, custom.origin"), ["custom.origin", "shop.roast_level"]);
assert.equal(productFields(Array.from({ length: 30 }, (_, i) => `c.f${i}`)).length, 20, "at most twenty fields");
assert.equal(offerTerms("  Minimum 5 lb.\r\n\r\n\r\n\r\nSee https://example.com/wholesale  "), "Minimum 5 lb.\n\nSee https://example.com/wholesale");
assert.equal(offerTerms("Order at http://example.com"), null, "only https links");
assert.equal(offerTerms("click javascript:alert(1)"), null);
assert.equal(offerTerms("bell \u0007 here"), null, "no control characters");
assert.equal(offerTerms("x".repeat(1501)), null);
assert.equal(offerTerms(""), null);

const owners = ["owner@example.com"];
const edit = (p: Partial<SettingsEdit>): SettingsEdit => ({ ...editOf(NO_SETTINGS), ...p });
const saved = checkSettingsEdit(edit({ productCollections: "our-coffees, wholesale", productFields: "custom.origin", offerTerms: "Minimum 5 lb." }), owners);
assert.ok("settings" in saved);
assert.deepEqual([saved.settings.productCollections, saved.settings.productFields, saved.settings.offerTerms], [["our-coffees", "wholesale"], ["custom.origin"], "Minimum 5 lb."]);
assert.match((checkSettingsEdit(edit({ productCollections: "our coffees!" }), owners) as { problem: string }).problem, /collection handles/);
assert.match((checkSettingsEdit(edit({ productCollections: "a,b,c,d,e,f" }), owners) as { problem: string }).problem, /At most 5/);
assert.match((checkSettingsEdit(edit({ productFields: "origin" }), owners) as { problem: string }).problem, /namespace\.key/);
assert.match((checkSettingsEdit(edit({ offerTerms: "see http://x.com" }), owners) as { problem: string }).problem, /https/);
// one Settings card saving keeps the other card's fields: editOf turns stored settings back into the same settings
const full = readSettings({ ownerEmail: "owner@example.com", siteUrl: "https://example.com", productCollections: ["our-coffees"], productFields: ["custom.origin"], offerTerms: "Minimum 5 lb." });
const again = checkSettingsEdit(editOf(full), owners);
assert.ok("settings" in again && JSON.stringify(again.settings) === JSON.stringify(full), "editOf round-trips");

// ---- The Shopify tool: one fixed read query; the collection must be one the business chose, the fields are the business's
const q = CORE_SHOPIFY.find((x) => x.tool === "shopify_product_facts")!;
assert.ok(q, "shopify_product_facts is a core Shopify tool");
assert.doesNotThrow(() => assertReadOnly(q.doc));
assert.ok(!/\b(email|phone|address|firstName|lastName|displayName|customer|order|cost|unitCost|inventoryItem)\b/i.test(q.doc), "reads no customer, order or cost data");
const ctx = { productCollections: ["our-coffees", "wholesale"], productFields: ["custom.origin"] };
const ok = shopifyVariables("shopify_product_facts", { collection: " Our-Coffees " }, ctx);
assert.ok(!("problem" in ok) && ok.variables.handle === "our-coffees" && JSON.stringify(ok.variables.keys) === '["custom.origin"]');
const other = shopifyVariables("shopify_product_facts", { collection: "secret-drops" }, ctx);
assert.ok("problem" in other && /chosen on Settings/.test(other.problem), "a collection the business didn't choose is refused");
const none = shopifyVariables("shopify_product_facts", { collection: "our-coffees" }, { ...ctx, productCollections: [] });
assert.ok("problem" in none, "no collections chosen, nothing read");
const noFields = shopifyVariables("shopify_product_facts", { collection: "wholesale", keys: ["custom.cost"] }, { ...ctx, productFields: [] });
assert.ok(!("problem" in noFields) && JSON.stringify(noFields.variables.keys) === JSON.stringify([NO_FIELDS_KEY]), "no fields chosen sends a key no store has; a caller never picks keys");
assert.ok(!/^[A-Za-z0-9_-]{3,}\./.test(NO_FIELDS_KEY), "the no-fields key's namespace is shorter than Shopify allows");

// ---- Shaping: active, in-stock products only, and only the chosen fields, whatever Shopify sent
const node = (p: Partial<ShopifyProductNode>): ShopifyProductNode => ({
  handle: "h", title: "Coffee", description: "  Bright   and sweet. ", productType: "Coffee", vendor: "Us", tags: ["single"], status: "ACTIVE", tracksInventory: true, totalInventory: 4,
  priceRangeV2: { minVariantPrice: { amount: "14.5", currencyCode: "USD" }, maxVariantPrice: { amount: "52", currencyCode: "USD" } },
  metafields: { nodes: [{ namespace: "custom", key: "origin", value: "Brazil" }, { namespace: "custom", key: "cost", value: "3.10" }] }, ...p,
});
const r: ShopifyCollectionResult = { collectionByIdentifier: { handle: "our-coffees", title: "Our coffees", products: { nodes: [
  node({ handle: "a" }),
  node({ handle: "draft", status: "DRAFT" }),
  node({ handle: "sold-out", totalInventory: 0 }),
  node({ handle: "untracked", tracksInventory: false, totalInventory: 0, priceRangeV2: null, description: "x".repeat(900) }),
] } } };
const c = collectionFacts(r, ["custom.origin"])!;
assert.deepEqual(c.products.map((p) => p.handle), ["a", "untracked"], "drafts and sold-out tracked products are left out");
assert.deepEqual(c.products[0].fields, { "custom.origin": "Brazil" }, "a field the business didn't choose never comes through");
assert.deepEqual(c.products[0].price, { from: 14.5, to: 52, currency: "USD" });
assert.equal(c.products[0].about, "Bright and sweet.");
assert.equal(c.products[1].price, null);
assert.ok(c.products[1].about.length <= 600);
assert.equal(collectionFacts({ collectionByIdentifier: null }, []), null);

// ---- The tool is core's and takes no params; Settings has the card
const catalog = readFileSync("core/tools/catalog.ts", "utf8");
assert.match(catalog, /id: "product_facts", [^\n]*\n\s+kind: "read", group: "shopify", params: \[\], trusted: true/);
assert.match(readFileSync("app/(room)/settings/page.tsx", "utf8"), /ProductFactsForm[^\n]*save=\{saveProductFacts\}/);

console.log("check:product-facts ok");
