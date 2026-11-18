# ee/: OPERATOR's paid layer

Billing, seats, SSO, credits and the support console live here (Build Board card 128, not built yet).
This folder is under its own license (`ee/LICENSE`), not the AGPL-3.0 in `LICENSE`, and takes no
outside pull requests. Nothing outside `ee/` imports from it: lint refuses `@/ee/...` anywhere else,
so the open-source app is complete on its own.
