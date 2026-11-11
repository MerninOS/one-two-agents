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
  // A second Mercury token used only by the tool gateway (core/gateway) to apply approved
  // receipt, category and memo changes on existing transactions. Blank = approvals are
  // recorded but nothing is written to Mercury.
  mercuryWriteToken: v("MERCURY_WRITE_TOKEN"),
  mercuryAccountIds: (v("MERCURY_ACCOUNT_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),

  // Notion internal integration, shared only with the page briefs and lead lists go under.
  notionToken: v("NOTION_TOKEN"),
  notionBriefParent: v("NOTION_BRIEF_PARENT_ID"),
  // Each agent's own page for its run pages. Blank = they go under NOTION_BRIEF_PARENT_ID, as before.
  notionLeadsParent: v("NOTION_LEADS_PARENT_ID") ?? v("NOTION_BRIEF_PARENT_ID"),
  notionBooksParent: v("NOTION_BOOKS_PARENT_ID") ?? v("NOTION_BRIEF_PARENT_ID"),
  // The "Briefs" database (one row per morning brief). Blank = the brief is a page under the parent, as before.
  notionBriefsDb: v("NOTION_BRIEFS_DB_ID"),

  // Gmail for Wholesale Hunter drafts (gmail.compose scope only). Blank = drafts appear in Notion only.
  gmailClientId: v("GMAIL_CLIENT_ID"),
  gmailClientSecret: v("GMAIL_CLIENT_SECRET"),
  gmailRefreshToken: v("GMAIL_REFRESH_TOKEN"),
  // Bookkeeper's own refresh token for the same mailbox with only gmail.readonly: it searches
  // for receipts and never drafts or sends. Blank = no receipt search.
  gmailReceiptsRefreshToken: v("GMAIL_RECEIPTS_REFRESH_TOKEN"),

  // Email to Zak only (morning brief, alerts) through Resend. BRIEF_TO is the one fixed
  // recipient; BRIEF_FROM is a sender on a domain verified in Resend. Blank = no email.
  resendKey: v("RESEND_API_KEY"),
  briefFrom: v("BRIEF_FROM"),
  briefTo: v("BRIEF_TO"),
  // Where the Control Room lives, for links in the brief. Defaults to the Vercel production URL.
  dashboardUrl: (v("DASHBOARD_URL") || (v("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${v("VERCEL_PROJECT_PRODUCTION_URL")}` : "")).replace(/\/+$/, "") || undefined,

  // Public storefront, named in outreach drafts.
  siteUrl: (v("SITE_URL") || "https://onetwocoffeelab.com").replace(/\/+$/, ""),
};
