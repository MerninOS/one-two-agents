// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Billing (the SettingsCards slot): where the business stands, what it pays, and for the
// owner the buttons to Stripe's own pages (Checkout to add a card, the portal to change or cancel).
import "server-only";
import { listMembers } from "@/core/members";
import { requireSession } from "@/dashboard/data";
import { currentPlan, subscription } from "./plan";
import { planWords } from "./plan-rules";
import { stripeReady } from "./stripe";
import { addCard, manageBilling } from "./billing-actions";

export async function BillingCard({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  const [me, plan, sub, people] = await Promise.all([
    requireSession(),
    currentPlan().then((p) => ({ p, problem: null as string | null }), (e: unknown) => ({ p: null, problem: e instanceof Error ? e.message : String(e) })),
    subscription().catch(() => null),
    listMembers().then((m) => Math.max(1, m.length), () => 1),
  ]);
  const billed = plan.p && plan.p.kind !== "exempt";
  const hasCard = !!sub?.hasCard && sub.status !== "canceled";
  return (
    <div className="card" style={{ padding: "16px 22px", gap: 8 }}>
      <span className="card-t">Billing</span>
      <span className="sub">{plan.p ? planWords(plan.p, people) : plan.problem}</span>
      {query.billing === "added" && <span className="sub" style={{ color: "var(--mint-ink)" }}>Thanks, the card is on file. It can take a minute to show here.</span>}
      {query.billing_problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.billing_problem.slice(0, 200)}</span>}
      {billed && me.role === "owner" && (stripeReady()
        ? <form action={hasCard ? manageBilling : addCard}><button className="btn sm">{hasCard ? "Manage billing" : "Add a card"}</button></form>
        : <span className="muted" style={{ fontSize: 12 }}>Billing isn’t set up on this deployment yet.</span>)}
      {billed && <span className="muted" style={{ fontSize: 12 }}>Adding or removing people changes the bill from the next day, prorated. A plan never changes what the crew may do: caps, approval cards and the hard rules are the same on every plan.</span>}
    </div>
  );
}
