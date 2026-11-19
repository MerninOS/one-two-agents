// The daily numbers (core/daily-numbers-rules.ts, docs/daily-numbers.md): `npm run check:daily-numbers`.
// Pure: no database, no network. Every number is code's; a missing cost is left out, never guessed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { channelOf, daySnapshot, shopifyCost, type SnapOrder } from "../core/daily-numbers-rules";

// ---- sales channels, in words
assert.equal(channelOf("web"), "online store");
assert.equal(channelOf("pos"), "point of sale");
assert.equal(channelOf("shopify_draft_order"), "draft orders");
assert.equal(channelOf(" Web "), "online store");
assert.equal(channelOf(""), "other");
assert.equal(channelOf(null), "other");
assert.equal(channelOf("<script>"), "script");
assert.equal(channelOf("!!!"), "other");
assert.equal(channelOf("x".repeat(80)).length, 40);

// ---- Shopify's unit cost: quantity × cost, uncosted lines counted
assert.deepEqual(shopifyCost([{ quantity: 2, unitCost: 4.5 }, { quantity: 1, unitCost: 3.333 }]), { usd: 12.33, uncosted: 0 });
assert.deepEqual(shopifyCost([{ quantity: 3, unitCost: null }, { quantity: 1, unitCost: -1 }, { quantity: 1, unitCost: NaN }, { quantity: 2, unitCost: 1 }]), { usd: 2, uncosted: 5 });
assert.deepEqual(shopifyCost([]), { usd: 0, uncosted: 0 });

// ---- one day
const o = (total: number, goods: number, repeat = false, channel = "online store"): SnapOrder => ({ total, goods, repeat, channel });
const day = [o(50, 40), o(30, 25, true), o(20.005, 18, false, "point of sale")];
const r = daySnapshot("2026-11-18", day, { source: "own", usd: 33 }, 1234.5);
assert.equal(r.revenue, 100.01);
assert.equal(r.goods, 83);
assert.equal(r.orders, 3);
assert.equal(r.aov, 33.34);
assert.equal(r.repeat_rate, 0.3333);
assert.equal(r.cost_of_goods, 33);
assert.equal(r.margin, 0.6024, "margin is (goods − cost) / goods");
assert.equal(r.cost_source, "own");
assert.equal(r.cash_usd, 1234.5);
assert.deepEqual(r.detail.byChannel, { "online store": { orders: 2, revenue: 80 }, "point of sale": { orders: 1, revenue: 20.01 } });
assert.equal(r.detail.costNote, undefined);
assert.deepEqual(r.detail.failed, []);

// each cost source
const none = daySnapshot("2026-11-18", day, { source: "none", usd: null }, null);
assert.equal(none.cost_of_goods, null); assert.equal(none.margin, null); assert.equal(none.cost_source, "none");
const shop = daySnapshot("2026-11-18", day, { source: "shopify", usd: 41.5, note: "2 items have no cost in Shopify" }, null);
assert.equal(shop.cost_of_goods, 41.5); assert.equal(shop.margin, 0.5); assert.equal(shop.detail.costNote, "2 items have no cost in Shopify");
const failed = daySnapshot("2026-11-18", day, { source: "own", usd: null, note: "The tool didn't answer." }, null, ["mercury"]);
assert.equal(failed.cost_of_goods, null); assert.equal(failed.margin, null); assert.equal(failed.cost_source, "own");
assert.equal(failed.detail.costNote, "The tool didn't answer."); assert.deepEqual(failed.detail.failed, ["mercury"]);
// a bad cost is left out, never a margin from it
for (const usd of [-5, NaN, Infinity]) assert.equal(daySnapshot("d", day, { source: "own", usd }, null).margin, null, String(usd));

// no orders, no goods: nothing divides by zero
const empty = daySnapshot("2026-11-18", [], { source: "shopify", usd: 0 }, 10);
assert.deepEqual([empty.revenue, empty.goods, empty.orders, empty.aov, empty.repeat_rate, empty.margin], [0, 0, 0, null, null, null]);
assert.equal(empty.cost_of_goods, 0);

// ---- the store reads only, and no coffee words in core
const src = readFileSync("core/daily-numbers.ts", "utf8") + readFileSync("core/daily-numbers-rules.ts", "utf8");
assert.doesNotMatch(src, /\bgreen|roast|coffee|\blots?\b/i, "core's daily numbers know nothing of coffee");
assert.match(readFileSync("core/daily-numbers.ts", "utf8"), /chicagoDate\(1\)/, "an own cost number is read for yesterday only");

console.log("check:daily-numbers ok");
