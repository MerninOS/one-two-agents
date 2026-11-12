// Avery's menu: everything a setup may choose from (core/setup.ts). Adding a model (to
// integrations/models.ts), a fact source or an output is a code change on purpose: the
// Control Room can only pick from what is listed.
import type { AgentMenu } from "@/core/setup";
import { modelsFor } from "@/integrations/models";
import { SAFETY, SOP } from "./prompt";

export const MENU: AgentMenu = {
  agentId: "chief_of_staff",
  steps: [{
    id: "judge",
    label: "Watch and focus",
    needs: "Structured output (a watch list, one focus, working memory)",
    // every model in integrations/models.ts that can return this shape, any provider
    requires: ["structured-output"],
    models: modelsFor(["structured-output"]),
    model: "claude-sonnet-5-5",
    effort: "medium",
    fallback: null,
  }],
  numbers: {
    cover_warn_days: { label: "Low-green warning", box: "reads", unit: "days of cover", default: 21, min: 7, max: 60 },
    green_days: { label: "Green use window", box: "reads", unit: "days", default: 30, min: 7, max: 90 },
    kpi_days: { label: "Snapshot history", box: "reads", unit: "days", default: 8, min: 2, max: 30 },
  },
  reads: [
    { id: "kpis", label: "Yesterday’s numbers", detail: "The latest daily snapshots Morgan wrote (kpi_snapshots), as many days as Snapshot history", integration: "supabase" },
    { id: "runs", label: "Other agents’ runs", detail: "Every agent run in the last 24 hours (agent_runs)", integration: "supabase" },
    { id: "approvals", label: "Approvals waiting", detail: "How many, and how old the oldest is (approvals)", integration: "supabase" },
    { id: "drafts", label: "New outreach drafts", detail: "Rowan’s Gmail drafts from the last 24 hours (wholesale_leads)", integration: "supabase" },
    { id: "orders", label: "Open orders", detail: "Paid, roasting, packing and QC hold, from Shopify", integration: "shopify" },
    { id: "green", label: "Green cover", detail: "Green lots on hand and their use over the Green use window, from Shopify", integration: "shopify" },
  ],
  outputs: [
    { id: "email", label: "Email to Zak", detail: "One brief to the address fixed in BRIEF_TO. The code has no recipient field.", integration: "email", env: ["RESEND_API_KEY", "BRIEF_FROM", "BRIEF_TO"] },
    { id: "notion", label: "Notion copy", detail: "A row in a Briefs database (a second run the same day replaces it), or a page per day under a page you pick", integration: "notion", env: ["NOTION_TOKEN"] },
  ],
  // the email and the Notion copy use the same sections in the same order
  sections: [
    { id: "focus", label: "Today’s focus", detail: "One action and why, written by the model", locked: true },
    { id: "waiting", label: "Waiting on you", detail: "Approvals, Rowan’s drafts, failed runs, orders, QC holds, green never deducted. Each line only from the sources that are on" },
    { id: "numbers", label: "Numbers", detail: "Revenue, orders, cash, repeat rate and green margin from Morgan’s snapshot", needs: ["kpis"] },
    { id: "watch", label: "Watch", detail: "Up to five things to keep an eye on, written by the model" },
    { id: "ran", label: "What ran", detail: "The other agents’ runs in the last 24 hours", needs: ["runs"] },
  ],
  notion: {
    output: "notion",
    // briefRow() in index.ts writes these; a database without them would reject the row
    dbProps: { Name: "title", Date: "date", Focus: "rich_text", "Focus done": "checkbox", Revenue: "number", Orders: "number", AOV: "number", Cash: "number", "Repeat rate": "number", "Green margin": "number", "Numbers from": "date", "Approvals waiting": "number", "Failed runs": "number", Emailed: "checkbox" },
    envDb: "NOTION_BRIEFS_DB_ID",
    envPage: "NOTION_BRIEF_PARENT_ID",
  },
  fixed: [
    { box: "reads", label: "Approvals and drafts window", value: "Waiting now, and drafts from the last 24 hours" },
    { box: "thinking", label: "Answer shape", value: "Watch list, focus, working memory", note: "The code reads this shape, so it stays in code" },
    { box: "thinking", label: "If no model can be reached", value: "Fixed rules write the watch list and focus" },
    { box: "thinking", label: "If the model declines", value: "The Claude API reruns the request on another Claude model it picks" },
    { box: "thinking", label: "Dry run", value: "Never calls the model" },
    { box: "writes", label: "Email recipient", value: "BRIEF_TO only", note: "integrations/email.ts has no recipient argument, so no setup can change who gets it" },
    { box: "writes", label: "Order of writes", value: "Notion first, then the email, so the email can link to its copy" },
  ],
  instructions: SOP,
  safety: SAFETY,
};
