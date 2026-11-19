# Product facts

What an agent may say about the business's products in an outside message, like a first email to a
lead. The hard rule: external messages only claim facts about products, lots, origins or
certifications that come from the business's own Shopify data, never from the model. This page is how
core keeps it for every business on OPERATOR (card 132).

## Where the facts come from

The owner chooses them on **Settings > What agents may say about your products**:

| Field | What it is | Limits (in code, `core/settings-rules.ts`) |
| --- | --- | --- |
| Shopify collections | The collections agents read, by handle (`our-coffees`) | At most 5; lower-case handles only |
| Product fields | Metafields read with each product, written `namespace.key` (`custom.origin`) | At most 20; nothing else leaves Shopify |
| Offer terms | The owner's own words: minimums, sizes, prices, terms, the page to send people to | 1,500 characters, plain text, every link `https://` |

They are saved with the business's other settings (the `business_settings` row in `policies`).
Saving this card keeps the "Where things go" card's fields, and the other way round (`editOf`).

## The tool

`product_facts` (core, `core/tools/catalog.ts`, group Shopify) takes no params: the model picks
nothing. For each chosen collection it calls our Shopify server's `shopify_product_facts` read tool
(`core/shopify-rules.ts`), one fixed read query:

- The collection must be one the business chose; any other handle is refused.
- The metafield keys are the business's chosen fields. With none chosen it sends a key no store can
  have (`__.none`), because Shopify returns every metafield when the list is empty.
- No customer, order or cost data is in the query.

`core/product-facts-rules.ts` shapes the reply in code: only `ACTIVE` products, no tracked product
that is sold out, only the chosen fields (checked again, whatever Shopify sent), text clipped. The
tool returns those collections, the offer terms and the website, with counts in `numbers`.

## Who uses it

Rowan's outreach drafts may claim only what Product facts says, and Reese checks Rowan's drafts
against it. Any agent can be given it on the builder's Tools step.

## Moving off a pack's own offer tool

A pack that kept its own offer (terms in code, prices from a formula) moves it here: the terms go in
Offer terms, the products offered go in a collection, and each product's price for that offer is a
product field. Migration `20261213090000_product_facts.sql` renamed the first such tool
(`wholesale_offer`) in every spec and playbook.

## Tests

`npm run check:product-facts`: settings parsing and limits, the Shopify query's checks, the
shaping, the Settings card, and that no pack keeps an offer of its own.
