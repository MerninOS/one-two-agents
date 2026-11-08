import "server-only";
// The storefront's operational settings live as JSON in the shop metafield
// blended.settings. Agents only need the roast loss table.
import { cleanRoastLoss, DEFAULT_ROAST_LOSS, type RoastLoss } from "@/domain/green";
import { admin, gql } from "./client";

const SHOP = gql`
  query AgentShopSettings { shop { metafield(namespace: "blended", key: "settings") { value } } }
`;

/** Roast loss % by roast level 1–5, as set in the storefront admin (defaults if unset). */
export async function getRoastLoss(): Promise<RoastLoss> {
  const r = await admin<{ shop: { metafield: { value: string } | null } }>(SHOP);
  try { return cleanRoastLoss(JSON.parse(r.shop.metafield?.value || "{}").roastLoss); } catch { return [...DEFAULT_ROAST_LOSS]; }
}
