# ee/: OPERATOR's paid layer

Billing, seats, SSO, credits and the support console live here (Build Board card 128). This folder
is under its own license (`ee/LICENSE`), not the AGPL-3.0 in `LICENSE`, and takes no outside pull
requests. Nothing outside `ee/` imports from it (check:open-core refuses `@/ee/...` anywhere else),
so the open-source app is complete on its own.

`ee/index.ts` fills the extension slots that core names in `core/extension-types.ts`. It is built
in only when `OPERATOR_EDITION=cloud` is set; see `docs/extensions.md`. Its two tables come from
their own migration after the starting one (`*_ee_tables.sql`); an open-edition install has them
empty.
