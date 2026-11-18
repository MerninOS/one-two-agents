// A small made-up crew for the installer's checks (check:install): two departments, a chief of
// staff, a head and a specialist, using only core tools and measures. Not a template pack.
import type { PackCrew } from "../../templates/types";

const spec = (name: string, tools: string[], directive: string) => ({
  name, model: "claude-haiku-5-5", effort: "low", tools, limits: { maxSteps: 8, maxCostUsd: 0.25 },
  mandate: `${name}'s job`, directive, goodResult: "", notionPages: [], outputName: name, readsFrom: [], reportPage: null,
});

export const SAMPLE_CREW: PackCrew = {
  departments: [
    { id: "finance", name: "Finance", sort: 1, lead_checks_drafts: false },
    { id: "sales", name: "Sales", sort: 2, lead_checks_drafts: true },
  ],
  agents: [
    { id: "chief", name: "Ada", role: "Chief of Staff", model: "claude-haiku-5-5", icon: null, hue: null, daily_budget_usd: 0.5, manual_only: false },
    { id: "cfo", name: "Bo", role: "CFO", model: "claude-haiku-5-5", icon: null, hue: null, daily_budget_usd: 0.5, manual_only: false },
    { id: "scout", name: "Cy", role: "Scout", model: "claude-haiku-5-5", icon: null, hue: null, daily_budget_usd: 0.5, manual_only: true },
  ],
  specs: {
    chief: spec("Ada", ["goal_progress", "team_report"], "Read each department and say what matters today."),
    cfo: spec("Bo", ["mercury_balances", "goal_progress"], "Say how much cash there is, using only the tool's numbers."),
    scout: spec("Cy", ["web_search", "goal_progress"], "Find three businesses that might buy from us."),
  },
  playbooks: {
    chief: [{ tool: "goal_progress", input: {} }],
    cfo: [{ tool: "mercury_balances", input: {} }],
  },
  seats: [
    { key: "chief", parent: null, department: null, title: "Chief of Staff", sub: "", holder: "agent", agent: "chief", sort: 0 },
    { key: "cfo", parent: null, department: "finance", title: "CFO", sub: "", holder: "agent", agent: "cfo", sort: 0 },
    { key: "sales_head", parent: null, department: "sales", title: "Head of sales", sub: "", holder: "owner", agent: null, sort: 0 },
    { key: "scout", parent: "sales_head", department: "sales", title: "Scout", sub: "", holder: "agent", agent: "scout", sort: 1 },
    { key: "follow_ups", parent: "sales_head", department: "sales", title: "Follow-ups", sub: "", holder: "open", agent: null, sort: 2 },
  ],
  flow: { chains: [{ on: true, key: "morning", name: "Morning", start: { days: "daily", time: "07:00", type: "schedule" }, steps: [{ agent: "cfo" }, { agent: "chief", passAlong: true }] }] },
  goals: [
    { department: "finance", title: "Grow months of runway to 1 year", measure: "runway_months", target: 12 },
    { department: "sales", title: "More orders", measure: "orders_month", target: 100 },
  ],
};
