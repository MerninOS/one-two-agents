// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The current business's plan, read from its ee_subscriptions row through db() (scoped to the org).
import "server-only";
import { db } from "@/core/db";
import { HOME_ORG_ID, orgId } from "@/core/tenancy";
import type { PlanAsk } from "@/core/extension-types";
import { planBlockFor, planState, type PlanState, type SubStatus, type Subscription } from "./plan-rules";

export async function subscription(): Promise<Subscription | null> {
  const { data, error } = await db().from("ee_subscriptions").select("status, trial_ends_at, past_due_since, seats, current_period_end, stripe_subscription_id").maybeSingle();
  if (error) throw new Error(/ee_subscriptions|relation|schema cache/.test(error.message) ? "The billing migration (20261212090000_ee_subscriptions.sql) isn’t applied yet." : error.message);
  if (!data) return null;
  return {
    status: data.status as SubStatus, trialEndsAt: data.trial_ends_at, pastDueSince: data.past_due_since,
    seats: Number(data.seats), currentPeriodEnd: data.current_period_end, hasCard: !!data.stripe_subscription_id,
  };
}

/** The home org is never billed, so it never reads a row (and can't be paused by one). */
export async function currentPlan(now = Date.now()): Promise<PlanState> {
  if ((await orgId()) === HOME_ORG_ID) return planState(null, { home: true, now });
  return planState(await subscription(), { home: false, now });
}

export async function planBlock(ask: PlanAsk): Promise<string | null> {
  return planBlockFor(await currentPlan(), ask);
}
