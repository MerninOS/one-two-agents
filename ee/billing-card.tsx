// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Billing (the SettingsCards slot): where the business stands and what it pays. Adding a
// card and the Stripe portal come with slice 3b.
import "server-only";
import { listMembers } from "@/core/members";
import { currentPlan } from "./plan";
import { planWords } from "./plan-rules";

export async function BillingCard() {
  const [plan, people] = await Promise.all([
    currentPlan().then((p) => ({ p, problem: null as string | null }), (e: unknown) => ({ p: null, problem: e instanceof Error ? e.message : String(e) })),
    listMembers().then((m) => Math.max(1, m.length), () => 1),
  ]);
  return (
    <div className="card" style={{ padding: "16px 22px", gap: 6 }}>
      <span className="card-t">Billing</span>
      <span className="sub">{plan.p ? planWords(plan.p, people) : plan.problem}</span>
      {plan.p && plan.p.kind !== "exempt" && <span className="muted" style={{ fontSize: 12 }}>A plan never changes what the crew may do: caps, approval cards and the hard rules stay the same on every plan.</span>}
    </div>
  );
}
