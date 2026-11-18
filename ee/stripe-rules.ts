// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Stripe, the pure parts: checking a webhook's signature and turning Stripe's subscription into our
// ee_subscriptions row. No network and no clock of its own, so ee/check.ts tests them.
//
// Paying OPERATOR is not an agent action: no agent calls Stripe, and Stripe is not an MCP server or a
// gateway action type (docs/extensions.md, design "Hard rules").
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SubStatus } from "./plan-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isOrgId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const ID = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9]{6,64}$`);
export const isCustomerId = (v: unknown): v is string => typeof v === "string" && ID("cus").test(v);
export const isSubscriptionId = (v: unknown): v is string => typeof v === "string" && ID("sub").test(v);

/** Stripe signs each webhook (Stripe-Signature: t=...,v1=...): HMAC-SHA256 of "t.body". 5 minutes' leeway. */
export function validSignature(body: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const want = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return parts.some(([k, v]) => {
    if (k !== "v1" || !/^[0-9a-f]{64}$/.test(v ?? "")) return false;
    return timingSafeEqual(want, Buffer.from(v, "hex"));
  });
}

/** Form-encodes nested params the way Stripe's API takes them (a[b][0]=c). */
export function formEncode(params: Record<string, unknown>, prefix = ""): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") out.push(formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.filter(Boolean).join("&");
}

/** Stripe's subscription status as ours. "incomplete" (first payment pending) changes nothing yet. */
export function ourStatus(stripe: string): SubStatus | null {
  switch (stripe) {
    case "trialing": return "trialing";
    case "active": return "active";
    case "past_due": case "unpaid": return "past_due";
    case "canceled": case "incomplete_expired": return "canceled";
    default: return null;
  }
}

export interface StripeSubscription {
  id: string; customer: string; status: string; trial_end?: number | null; current_period_end?: number | null;
  metadata?: Record<string, string>;
  items?: { data?: { id: string; quantity?: number; current_period_end?: number | null }[] };
}
export interface SubRow {
  status: SubStatus; trial_ends_at: string | null; past_due_since: string | null; seats: number;
  stripe_customer_id: string; stripe_subscription_id: string; current_period_end: string | null;
}

const at = (sec: number | null | undefined) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/**
 * The row a Stripe subscription leaves. `prev` is the row before (for when a failed payment began).
 * null: nothing to record (an incomplete first payment, or ids that aren't Stripe's).
 */
export function rowFromSubscription(s: StripeSubscription, prev: { status: SubStatus; past_due_since: string | null } | null, nowIso: string): SubRow | null {
  const status = ourStatus(s.status);
  if (!status || !isSubscriptionId(s.id) || !isCustomerId(s.customer)) return null;
  const item = s.items?.data?.[0];
  return {
    status,
    trial_ends_at: at(s.trial_end),
    past_due_since: status === "past_due" ? (prev?.status === "past_due" && prev.past_due_since ? prev.past_due_since : nowIso) : null,
    seats: Math.min(1000, Math.max(1, Math.floor(item?.quantity ?? 1))),
    stripe_customer_id: s.customer,
    stripe_subscription_id: s.id,
    current_period_end: at(item?.current_period_end ?? s.current_period_end),
  };
}

/** Days left in our own trial, if Stripe can carry it on (Stripe needs a trial end at least 48 hours out). */
export function trialEndFor(trialEndsAt: string | null, nowMs: number): number | undefined {
  const end = trialEndsAt ? Date.parse(trialEndsAt) : NaN;
  return Number.isFinite(end) && end - nowMs > 48 * 3_600_000 ? Math.floor(end / 1000) : undefined;
}
