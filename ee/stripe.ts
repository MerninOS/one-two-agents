// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The one file that calls Stripe's API. Its keys are app infrastructure in the deployment's settings
// (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET), like Supabase and Resend, never in the
// vault and never shown: errors are scrubbed and requests never follow redirects.
import "server-only";
import { scrubSecrets } from "@/core/mcp-rules";
import { formEncode } from "./stripe-rules";

const key = () => process.env.STRIPE_SECRET_KEY?.trim() ?? "";
export const stripePrice = () => process.env.STRIPE_PRICE_ID?.trim() ?? "";
export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? "";
/** True when this deployment can take cards: a secret key and the plan's price. */
export const stripeReady = () => /^(sk|rk)_(test|live)_/.test(key()) && /^price_/.test(stripePrice());

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST", path: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!stripeReady()) throw new Error("Billing isn’t set up on this deployment yet (STRIPE_SECRET_KEY and STRIPE_PRICE_ID).");
  if (!/^\/v1\/[a-z_]+(\/[A-Za-z0-9_]+)*$/.test(path)) throw new Error("Refused: not a Stripe API path.");
  const body = formEncode(params);
  const url = `https://api.stripe.com${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method, redirect: "error", cache: "no-store",
    headers: { authorization: `Bearer ${key()}`, "content-type": "application/x-www-form-urlencoded", "stripe-version": "2025-03-31.basil" },
    body: method === "POST" ? body : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) throw new Error(scrubSecrets(`Stripe: ${json.error?.message ?? `HTTP ${res.status}`}`, [key()]).slice(0, 300));
  return json;
}
