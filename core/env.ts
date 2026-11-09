import "server-only";
// Every secret and setting the agents read, in one place. Only what agents need:
// no storefront tokens live here.
const v = (k: string) => process.env[k]?.trim() || undefined;

export const env = {
  // Vercel Cron sends this as a bearer token; manual runs use the same header.
  cronSecret: v("CRON_SECRET"),

  // Supabase project one-two-agents (service role, server only; tables have RLS with no policies)
  supabaseUrl: v("SUPABASE_URL"),
  supabaseServiceKey: v("SUPABASE_SERVICE_ROLE_KEY"),

  // Shopify Admin API, read-only app "One Two Agents (read)": a static token, or
  // Dev Dashboard app credentials exchanged with the client-credentials grant.
  shopifyDomain: v("SHOPIFY_STORE_DOMAIN"),
  shopifyApiVersion: v("SHOPIFY_API_VERSION") || "2026-07",
  shopifyAdminToken: v("SHOPIFY_ADMIN_ACCESS_TOKEN"),
  shopifyClientId: v("SHOPIFY_CLIENT_ID"),
  shopifyClientSecret: v("SHOPIFY_CLIENT_SECRET"),
  shopifyStockCollection: v("SHOPIFY_STOCK_COLLECTION") || "our-coffees",

  // Mercury read-only token (business org). Agents never move money.
  mercuryToken: v("MERCURY_API_TOKEN"),
  // "all" (every non-credit account the token sees) or comma-separated account IDs; blank = cash not reported.
  mercuryAccountIds: (v("MERCURY_ACCOUNT_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  // Notion internal integration, shared only with the page briefs and lead lists go under.
  notionToken: v("NOTION_TOKEN"),
  notionBriefParent: v("NOTION_BRIEF_PARENT_ID"),

  // Gmail for Wholesale Hunter drafts (gmail.compose scope only). Blank = drafts appear in Notion only.
  gmailClientId: v("GMAIL_CLIENT_ID"),
  gmailClientSecret: v("GMAIL_CLIENT_SECRET"),
  gmailRefreshToken: v("GMAIL_REFRESH_TOKEN"),
  // Bookkeeper's own refresh token for the same mailbox with only gmail.readonly: it searches
  // for receipts and never drafts or sends. Blank = no receipt search.
  gmailReceiptsRefreshToken: v("GMAIL_RECEIPTS_REFRESH_TOKEN"),

  // Public storefront, named in outreach drafts.
  siteUrl: (v("SITE_URL") || "https://onetwocoffeelab.com").replace(/\/+$/, ""),
};
