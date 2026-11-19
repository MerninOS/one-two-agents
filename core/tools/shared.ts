// What core tools share: the settings or sign-ins a
// tool needs before the builder offers it, and small helpers.
import type { Param } from "./types";

export const SHOPIFY = ["SHOPIFY_CONNECTED"], MERCURY = ["MERCURY_CONNECTED"], NOTION = ["NOTION_CONNECTED"], SUPABASE = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], EMAIL = ["RESEND_API_KEY", "BRIEF_FROM", "BRIEF_TO"], GMAIL = ["GMAIL_CONNECTED"];
/** Not settings: Klaviyo, Mercury and Notion are signed in on Connections (mcp_connections), so the builder checks those rows. */
export const KLAVIYO = ["KLAVIYO_CONNECTED"];
export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
export const daysParam = (def: number, max: number, what: string): Param => ({ name: "days", type: "int", min: 1, max, default: def, description: what });
