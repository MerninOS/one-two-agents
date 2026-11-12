// Avery's menu: everything a setup may choose from (core/setup.ts). Adding a model to the
// list, a fact source or an output here is a code change on purpose: the Control Room can
// only pick from what is listed.
import type { AgentMenu } from "@/core/setup";
import { SOP } from "./prompt";

export const MENU: AgentMenu = {
  agentId: "chief_of_staff",
  steps: [{
    id: "judge",
    label: "Watch and focus",
    needs: "Structured output (a watch list, one focus, working memory)",
    // each needs a price in integrations/anthropic.ts before it can be listed
    models: ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"],
    model: "claude-sonnet-5-5",
    effort: "medium",
  }],
  numbers: {
    cover_warn_days: { label: "Low-green warning", box: "reads", unit: "days of cover", default: 21, min: 7, max: 60 },
  },
  reads: [
    { id: "kpis", label: "Yesterday’s numbers", detail: "The last 8 daily snapshots Morgan wrote (kpi_snapshots)", integration: "supabase" },
    { id: "runs", label: "Other agents’ runs", detail: "Every agent run in the last 24 hours (agent_runs)", integration: "supabase" },
    { id: "approvals", label: "Approvals waiting", detail: "How many, and how old the oldest is (approvals)", integration: "supabase" },
    { id: "drafts", label: "New outreach drafts", detail: "Rowan’s Gmail drafts from the last 24 hours (wholesale_leads)", integration: "supabase" },
    { id: "orders", label: "Open orders", detail: "Paid, roasting, packing and QC hold, from Shopify", integration: "shopify" },
    { id: "green", label: "Green cover", detail: "Green lots on hand and the last 30 days of use, from Shopify", integration: "shopify" },
  ],
  outputs: [
    { id: "email", label: "Email to Zak", detail: "One brief to the address fixed in BRIEF_TO. The code has no recipient field.", integration: "email", env: ["RESEND_API_KEY", "BRIEF_FROM", "BRIEF_TO"] },
    { id: "briefs_db", label: "Notion: Briefs database", detail: "One row per day; a second run the same day replaces the row", integration: "notion", env: ["NOTION_TOKEN", "NOTION_BRIEFS_DB_ID"] },
    { id: "brief_page", label: "Notion: page per day", detail: "Used only when the Briefs database isn’t set", integration: "notion", env: ["NOTION_TOKEN", "NOTION_BRIEF_PARENT_ID"] },
  ],
  fixed: [
    { box: "reads", label: "Green use window", value: "30 days" },
    { box: "reads", label: "Snapshot history", value: "8 days" },
    { box: "thinking", label: "Answer shape", value: "Watch list, focus, working memory", note: "The code reads this shape, so it stays in code" },
    { box: "thinking", label: "If the model can’t be reached", value: "Fixed rules write the watch list and focus" },
    { box: "thinking", label: "Dry run", value: "Never calls the model" },
    { box: "writes", label: "Sections, in order", value: "Numbers, Waiting on you, What ran, Watch, Today’s focus" },
    { box: "writes", label: "Order of writes", value: "Notion first, then the email, so the email can link to its copy" },
  ],
  instructions: SOP,
};
