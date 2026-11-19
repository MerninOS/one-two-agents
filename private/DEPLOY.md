# One Two's deployment (private repo only)

This repo is One Two Coffee Lab's copy of OPERATOR (onetwocoffeelab.com). One Two is the first org,
an ordinary customer on a comped plan; its owner is Zak. Sign-up codes are made in the separate
"Operator" business (OPERATOR_ADMIN_ORG_ID, card 135). Deployed as the Vercel project `one-two-agents`, schedules (Vercel Schedules, not
Cron Jobs) in `vercel.json`, state in the Supabase project `one-two-agents`. The storefront is a
separate repo (`MerninOS/blended`); this repo never imports from it. The public repo is
`Operator-A/Operator`, exported without this `private/` folder by `private/export.sh` (docs/self-host.md,
card 127). Card 136 retires this folder when the cloud runs from the public repo.

One Two's coffee numbers (green lots, cover, reorder amounts, a day's green cost, orders by roasting
stage) come from its own server in the storefront, `MerninOS/blended` `/api/agents-mcp`, added on
Connections as a custom server (cards 133 and 133.5). Cost of goods is its `green_cost` number
(Settings › Daily numbers); orders to roast, days of cover and orders never deducted show in the brief.

One Two's org was installed from its own crew snapshot (card 125) and now lives only in the
database. Its unbuilt agents (Roast planner, Green buyer, Merchandiser and more) are open seats on
its org chart since card 134.
