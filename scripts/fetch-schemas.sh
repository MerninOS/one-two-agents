#!/usr/bin/env bash
# Pull Shopify's published Admin 2026-07 GraphQL schema (from @shopify/dev-mcp) into
# .schemas/ for scripts/validate-graphql.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p .schemas
( cd "$tmp" && npm pack @shopify/dev-mcp --silent >/dev/null )
tar -xzf "$tmp"/shopify-dev-mcp-*.tgz -C "$tmp" package/dist/data/admin_2026-07.json.gz
gunzip -c "$tmp"/package/dist/data/admin_2026-07.json.gz > .schemas/admin-2026-07.json
echo "Schema saved to .schemas/"
