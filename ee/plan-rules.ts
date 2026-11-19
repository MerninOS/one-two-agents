// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The plan (card 128, decided on 2026-11-18): one plan at $20 a month that covers the owner, plus $5
// a month for each other person, after a 14-day trial. Pure: no database and no clock of its own, so
// ee/check.ts can test every case.
//
// A plan only adds a "no" on top of core (docs/extensions.md). Running out pauses runs and stops the
// crew growing; it never deletes anything, and approvals already waiting can still be tapped.
import type { PlanAsk } from "@/core/extension-types";

export const PLAN = { baseUsd: 20, seatUsd: 5, trialDays: 14, graceDays: 7 } as const;
const DAY = 86_400_000;

/** A Stripe-kept status, or "comped": set by us for a business that is never billed (card 135). */
export type SubStatus = "trialing" | "active" | "past_due" | "canceled" | "comped";
export interface Subscription {
  status: SubStatus;
  trialEndsAt: string | null;
  pastDueSince: string | null;
  seats: number;
  currentPeriodEnd: string | null;
  hasCard: boolean;
}

export type Lapse = "trial_over" | "unpaid" | "canceled";
export type PlanState =
  | { kind: "comped" }
  | { kind: "none" }
  | { kind: "trial"; until: string; daysLeft: number }
  | { kind: "active"; renews: string | null }
  | { kind: "grace"; until: string }
  | { kind: "lapsed"; why: Lapse };

/** The monthly price for a team of `people` (the owner is included in the base). */
export const monthlyUsd = (people: number) => PLAN.baseUsd + PLAN.seatUsd * Math.max(0, Math.floor(people) - 1);

/** Where a business stands. A comped row is never billed; a business with no row has no plan. */
export function planState(sub: Subscription | null, opts: { now: number }): PlanState {
  if (!sub) return { kind: "none" };
  if (sub.status === "comped") return { kind: "comped" };
  const at = (s: string | null) => (s ? Date.parse(s) : NaN);
  if (sub.status === "active") return { kind: "active", renews: sub.currentPeriodEnd };
  if (sub.status === "trialing") {
    const end = at(sub.trialEndsAt);
    // without an end date the trial can't be shown to be live
    if (Number.isFinite(end) && end > opts.now) return { kind: "trial", until: sub.trialEndsAt!, daysLeft: Math.ceil((end - opts.now) / DAY) };
    return { kind: "lapsed", why: "trial_over" };
  }
  if (sub.status === "past_due") {
    const since = at(sub.pastDueSince);
    const until = (Number.isFinite(since) ? since : opts.now) + PLAN.graceDays * DAY;
    if (until > opts.now) return { kind: "grace", until: new Date(until).toISOString() };
    return { kind: "lapsed", why: "unpaid" };
  }
  return { kind: "lapsed", why: "canceled" };
}

const WHY: Record<Lapse | "none", string> = {
  none: "This business has no plan yet.",
  trial_over: "The free trial is over.",
  unpaid: "The last payment didn’t go through and the 7-day grace period is over.",
  canceled: "The plan was canceled.",
};
const WHAT: Record<PlanAsk["kind"], string> = {
  run: "Runs are paused.",
  invite: "Adding people is paused.",
  agent_on: "Agents can’t go on duty.",
  custom_server: "Adding servers is paused.",
};
const NEXT = "Add a card on Settings > Billing to keep going; nothing has been deleted.";

/** Why the plan says no to this ask, or null. Only "none" and "lapsed" ever say no. */
export function planBlockFor(state: PlanState, ask: PlanAsk): string | null {
  if (state.kind !== "none" && state.kind !== "lapsed") return null;
  return `${WHY[state.kind === "none" ? "none" : state.why]} ${WHAT[ask.kind]} ${NEXT}`;
}

/** One line for the Settings card. */
export function planWords(state: PlanState, people: number): string {
  const price = `$${monthlyUsd(people)}/month for ${people} ${people === 1 ? "person" : "people"} ($${PLAN.baseUsd} with the owner, plus $${PLAN.seatUsd} for each other person)`;
  switch (state.kind) {
    case "comped": return "Comped: no charge and no limits.";
    case "none": return `No plan yet. ${price}.`;
    case "trial": return `Free trial: ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left. Then ${price}.`;
    case "active": return `Active: ${price}.`;
    case "grace": return `The last payment didn’t go through. Update the card before ${state.until.slice(0, 10)} or runs pause. ${price}.`;
    case "lapsed": return `${WHY[state.why]} Runs are paused until a card is added. ${price}.`;
  }
}
