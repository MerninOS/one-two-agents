// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Billing on Stripe (card 128 slice 3b): Checkout to add a card, the customer portal to change or
// cancel, the webhook that keeps ee_subscriptions in step, and the seat count following People.
// Every write is the current org's ee_subscriptions row through db(). The webhook is the one place
// that picks an org from outside a session: the org id we put on the subscription ourselves, in a
// request signed with the webhook secret, and only ever for that org's billing row.
import "server-only";
import { db } from "@/core/db";
import { orgId, withOrg } from "@/core/tenancy";
import { listMembers } from "@/core/members";
import { emailOwner, hasEmail } from "@/integrations/email";
import { stripe, stripePrice, stripeReady, webhookSecret } from "./stripe";
import { isCustomerId, isOrgId, isSubscriptionId, rowFromSubscription, trialEndFor, validSignature, type StripeSubscription } from "./stripe-rules";
import type { SubStatus } from "./plan-rules";

interface Row { status: SubStatus; trial_ends_at: string | null; past_due_since: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null; seats: number }
async function row(): Promise<Row | null> {
  const { data, error } = await db().from("ee_subscriptions").select("status, trial_ends_at, past_due_since, stripe_customer_id, stripe_subscription_id, seats").maybeSingle();
  if (error) throw new Error(error.message);
  return data as Row | null;
}
const people = async () => Math.max(1, (await listMembers()).length);

/** A Stripe Checkout page for the current business; the rest of our own trial carries over. */
export async function checkoutUrl(base: string): Promise<string> {
  const org = await orgId();
  const r = await row();
  if (r?.status === "comped") throw new Error("This business is comped: there’s nothing to pay.");
  if (r?.stripe_subscription_id && r.status !== "canceled") throw new Error("This business already has a card on file: use Manage billing.");
  const trialEnd = r?.status === "trialing" ? trialEndFor(r.trial_ends_at, Date.now()) : undefined;
  const s = await stripe<{ url?: string }>("POST", "/v1/checkout/sessions", {
    mode: "subscription",
    line_items: { 0: { price: stripePrice(), quantity: await people() } },
    client_reference_id: org,
    customer: r?.stripe_customer_id && isCustomerId(r.stripe_customer_id) ? r.stripe_customer_id : undefined,
    subscription_data: { metadata: { org_id: org }, trial_end: trialEnd },
    metadata: { org_id: org },
    success_url: `${base}/settings?billing=added`,
    cancel_url: `${base}/settings`,
  });
  if (!s.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe didn’t return a checkout page.");
  return s.url;
}

/** Stripe's customer portal: change the card, see invoices, cancel. */
export async function portalUrl(base: string): Promise<string> {
  const r = await row();
  if (!r?.stripe_customer_id || !isCustomerId(r.stripe_customer_id)) throw new Error("No card on file yet: use Add a card.");
  const s = await stripe<{ url?: string }>("POST", "/v1/billing_portal/sessions", { customer: r.stripe_customer_id, return_url: `${base}/settings` });
  if (!s.url?.startsWith("https://billing.stripe.com/")) throw new Error("Stripe didn’t return the billing page.");
  return s.url;
}

/** The afterMembersChange slot: the bill's quantity follows the number of people, prorated. */
export async function syncSeats(): Promise<void> {
  if (!stripeReady()) return;
  const r = await row();
  if (r?.status === "comped" || !r?.stripe_subscription_id || !isSubscriptionId(r.stripe_subscription_id) || r.status === "canceled") return;
  const n = await people();
  const sub = await stripe<StripeSubscription>("GET", `/v1/subscriptions/${r.stripe_subscription_id}`);
  const item = sub.items?.data?.[0];
  if (!item || item.quantity === n) return;
  await stripe("POST", `/v1/subscription_items/${item.id}`, { quantity: n, proration_behavior: "create_prorations" });
  await db().from("ee_subscriptions").update({ seats: Math.min(1000, n), updated_at: new Date().toISOString() }).eq("stripe_subscription_id", r.stripe_subscription_id);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
async function tellOwner(subject: string, line: string) {
  try { if (await hasEmail()) await emailOwner(subject, `<p>${esc(line)}</p>`, line); } catch { /* a billing email that can't be sent never changes the row */ }
}

/** Records a Stripe subscription on its org's row (the org id we set at checkout). */
async function record(s: StripeSubscription, orgFromSession?: string): Promise<string> {
  const org = s.metadata?.org_id;
  if (!isOrgId(org) || (orgFromSession && orgFromSession !== org)) return "no org on the subscription";
  return withOrg(org, async () => {
    const { data: exists } = await db().from("orgs").select("id").maybeSingle();
    if (!exists) return "unknown org";
    const prev = await row();
    if (prev?.status === "comped") return "a comped business is never billed";
    if (prev?.stripe_customer_id && prev.stripe_customer_id !== s.customer) return "a different customer already pays for this org";
    const next = rowFromSubscription(s, prev, new Date().toISOString());
    if (!next) return "nothing to record";
    const { error } = await db().from("ee_subscriptions").upsert({ ...next, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) throw new Error(error.message);
    if (next.status === "past_due" && prev?.status !== "past_due") await tellOwner("OPERATOR: a payment didn’t go through", "Stripe couldn’t charge the card for this business’s OPERATOR plan. It will try again; update the card on Settings > Billing within 7 days, or runs pause until you do. Nothing is deleted.");
    if (next.status === "canceled" && prev?.status !== "canceled") await tellOwner("OPERATOR: the plan was canceled", "This business’s OPERATOR plan was canceled, so runs are paused. Nothing is deleted: add a card on Settings > Billing to pick up where you left off.");
    return `recorded ${next.status}`;
  });
}

/** The api slot's "stripe" route: POST /api/ee/stripe, signed by Stripe. */
export async function stripeWebhook(req: Request): Promise<Response> {
  const body = await req.text();
  if (!validSignature(body, req.headers.get("stripe-signature"), webhookSecret(), Math.floor(Date.now() / 1000))) return new Response("Bad signature", { status: 400 });
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }
  const obj = event.data?.object ?? {};
  let note = "ignored";
  try {
    if (event.type === "checkout.session.completed" && obj.mode === "subscription" && isSubscriptionId(obj.subscription)) {
      const sub = await stripe<StripeSubscription>("GET", `/v1/subscriptions/${obj.subscription}`);
      note = await record(sub, isOrgId(obj.client_reference_id) ? obj.client_reference_id : undefined);
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      note = await record(obj as unknown as StripeSubscription);
    }
  } catch (e) {
    // Stripe retries a 500, so a passing database problem catches up by itself
    return new Response(`Not recorded: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`, { status: 500 });
  }
  return Response.json({ received: true, note });
}
