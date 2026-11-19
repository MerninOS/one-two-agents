import "server-only";
// Every secret and setting the agents read, in one place. Only what agents need:
// no storefront tokens live here.
const v = (k: string) => process.env[k]?.trim() || undefined;

export const env = {
  // Vercel Cron sends this as a bearer token; manual runs use the same header.
  cronSecret: v("CRON_SECRET"),

  // The first owner (docs/tenancy.md, slice 2): while the org has no members, this address becomes
  // its owner on first sign-in. After that, owners add people on Settings > People.
  ownerEmail: v("OPERATOR_OWNER_EMAIL")?.toLowerCase(),

  // The Supabase project (service role, server only; every table has RLS, docs/tenancy.md)
  supabaseUrl: v("SUPABASE_URL"),
  supabaseServiceKey: v("SUPABASE_SERVICE_ROLE_KEY"),
  // The database lock (docs/tenancy.md, slice 2b): our ES256 private key (JWK), imported into
  // Supabase as its signing key, signs a short-lived token per org; tables are read with it and the
  // publishable key. Both blank = tables use the service role, as before.
  supabaseSigningKey: v("SUPABASE_SIGNING_KEY"),
  supabasePublishableKey: v("SUPABASE_PUBLISHABLE_KEY"),

  // The token vault (core/vault.ts): seals MCP sign-ins. A key of its own, never made from another
  // secret. To change it, move the current value to MCP_SECRET_KEY_OLD and put a new one here.
  mcpSecretKey: v("MCP_SECRET_KEY"),
  mcpSecretKeyOld: v("MCP_SECRET_KEY_OLD"),

  // Shopify Admin API version for our own Shopify server. Each business's store, client id and key
  // are its own (Settings and Connections).
  shopifyApiVersion: v("SHOPIFY_API_VERSION") || "2026-07",

  // The Build Board database. A yes on a new-tool proposal adds a card in Up next. Blank = no card.
  notionBuildBoardDb: v("NOTION_BUILD_BOARD_DB_ID"),

  // the business's own Google OAuth client (a Web application client), for the two Gmail sign-ins made
  // with Connect on Connections (docs/mcp-everywhere.md, slice 6). The sign-ins themselves live in the
  // token vault; the secret stays here and is never put in the vault, a cookie or the browser.
  gmailClientId: v("GMAIL_CLIENT_ID"),
  gmailClientSecret: v("GMAIL_CLIENT_SECRET"),

  // Email to the owner only (morning brief, alerts) through Resend. Each business picks its owner
  // email on Settings (core/settings.ts).
  // BRIEF_FROM is a sender on a domain verified in Resend. Blank = no email.
  resendKey: v("RESEND_API_KEY"),
  briefFrom: v("BRIEF_FROM"),
  // Where the Control Room lives, for links in the brief. Defaults to the Vercel production URL.
  dashboardUrl: (v("DASHBOARD_URL") || (v("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${v("VERCEL_PROJECT_PRODUCTION_URL")}` : "")).replace(/\/+$/, "") || undefined,
};
