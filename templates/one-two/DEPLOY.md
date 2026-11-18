# One Two's deployment (private repo only)

This repo is One Two Coffee Lab's copy of OPERATOR (onetwocoffeelab.com). One Two is the home org;
its owner is Zak. Deployed as the Vercel project `one-two-agents`, schedules (Vercel Schedules, not
Cron Jobs) in `vercel.json`, state in the Supabase project `one-two-agents`. The storefront is a
separate repo (`MerninOS/blended`); this repo never imports from it. The public repo is
`Operator-A/Operator`, exported without `templates/one-two` (docs/self-host.md, card 127).

Settings only One Two's pack reads: `SHOPIFY_STOCK_COLLECTION`, the collection holding "Our coffees"
(blank = `our-coffees`).
