# One Two's deployment (private repo only)

This repo is One Two Coffee Lab's copy of OPERATOR (onetwocoffeelab.com). One Two is the home org;
its owner is Zak. Deployed as the Vercel project `one-two-agents`, schedules (Vercel Schedules, not
Cron Jobs) in `vercel.json`, state in the Supabase project `one-two-agents`. The storefront is a
separate repo (`MerninOS/blended`); this repo never imports from it. The public repo is
`Operator-A/Operator`, exported without `templates/one-two` (docs/self-host.md, card 127).

One Two's coffee numbers (green lots, cover, reorder amounts, a day's green cost, orders by roasting
stage) come from its own server in the storefront, `MerninOS/blended` `/api/agents-mcp`, added on
Connections as a custom server (cards 133 and 133.5, `templates/one-two/docs/pack.md`). The pack has
no settings of its own.
