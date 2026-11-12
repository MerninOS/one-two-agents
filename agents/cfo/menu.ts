// Morgan's menu. Morgan calls no model: every number is computed in code from Shopify and
// Mercury, so there is nothing to tune yet. The menu is here so the Setup tab shows the same
// boxes for every agent, with each part marked as fixed in code.
import type { AgentMenu } from "@/core/setup";

export const MENU: AgentMenu = {
  agentId: "cfo",
  steps: [],
  numbers: {},
  reads: [
    { id: "orders", label: "Yesterday’s orders", detail: "Every channel, from Shopify (read-only app), with what each order took out of green inventory", integration: "shopify", locked: true },
    { id: "lots", label: "Green lots and roast loss", detail: "Green cost per pound and roast loss, from Shopify", integration: "shopify", locked: true },
    { id: "cash", label: "Cash", detail: "Balances of the business accounts, from Mercury’s read-only token", integration: "mercury", locked: true },
  ],
  outputs: [
    { id: "snapshot", label: "Daily snapshot", detail: "One row a day in kpi_snapshots. Avery’s brief reads it, so it stays on", integration: "supabase", locked: true },
  ],
  sections: [],
  fixed: [
    { box: "thinking", label: "Method", value: "Plain code. No model is called, so nothing is estimated" },
    { box: "reads", label: "Day", value: "Yesterday, Chicago time" },
    { box: "writes", label: "Numbers", value: "Revenue, orders, AOV, cash, repeat rate, green margin", note: "Computed in agents/cfo/index.ts" },
  ],
  instructions: "",
  instructionsLocked: true,
  safety: "Morgan calls no model. Money, margins and cover are computed in code.",
};
