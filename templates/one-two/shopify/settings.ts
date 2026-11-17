import "server-only";
// The storefront's operational settings live as JSON in the shop metafield
// blended.settings. Agents only need the roast loss table.
import { cleanRoastLoss, DEFAULT_ROAST_LOSS, type RoastLoss } from "@/templates/one-two/domain/green";
import { callMcpTool } from "@/integrations/mcp";

/** Roast loss % by roast level 1–5, as set in the storefront admin (defaults if unset). */
export async function getRoastLoss(): Promise<RoastLoss> {
  const r = (await callMcpTool("shopify", "shopify_shop_settings", {})) as { shop: { metafield: { value: string } | null } };
  try { return cleanRoastLoss(JSON.parse(r.shop.metafield?.value || "{}").roastLoss); } catch { return [...DEFAULT_ROAST_LOSS]; }
}
