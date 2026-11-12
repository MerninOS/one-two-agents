// Rowan's menu: everything a setup may choose from (core/setup.ts). The highest value of every
// number is today's limit in code, so a setup can make a run smaller and cheaper, never bigger.
// Areas and kinds of business are fixed lists: a page Rowan reads can't add one.
import type { AgentMenu } from "@/core/setup";
import { modelsFor } from "@/integrations/models";
import { AREAS, PER_RUN, SAFETY, SOP } from "./prompt";

/** Limits in code (the Guardrails box shows them). A setup's numbers stay at or under these. */
export const MAX_TURNS = 6, MAX_SEARCHES = 10, MAX_FETCHES = 20;

const AREA_OPTIONS = ["Austin", "Lakeway", "Bee Cave", "West Lake Hills", "Dripping Springs", "Cedar Park", "Leander", "Round Rock", "Georgetown", "Pflugerville", "Buda", "Kyle", "San Marcos"];
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_");

/** The kinds of business Rowan may look for. The id is stored; the words go to the model. */
export const BUSINESS_TYPES = [
  { id: "cafes", label: "Independent cafes" },
  { id: "trailers", label: "Coffee trailers" },
  { id: "bakeries", label: "Bakeries" },
  { id: "restaurants", label: "Restaurants with a real coffee program" },
  { id: "offices", label: "Offices" },
  { id: "gyms", label: "Gyms" },
  { id: "hotels", label: "Boutique hotels" },
  { id: "private_label", label: "Shops that could sell bags under their own name" },
] as const;

export const MENU: AgentMenu = {
  agentId: "wholesale_hunter",
  steps: [{
    id: "hunt",
    label: "Search, read and draft",
    needs: "Anthropic's web search and page reading, then structured output (the leads and drafts)",
    // the web tools are Anthropic's own, so only Claude models can do this step
    requires: ["anthropic-web-search"],
    models: modelsFor(["anthropic-web-search"]),
    model: "claude-opus-5-5",
    effort: "medium",
    fallback: null,
    fallbackOff: true,
  }],
  numbers: {
    leads_per_run: { label: "Leads per run", box: "writes", unit: "leads", default: PER_RUN, min: 1, max: PER_RUN },
    max_searches: { label: "Web searches", box: "thinking", unit: "per run", default: MAX_SEARCHES, min: 2, max: MAX_SEARCHES },
    max_fetches: { label: "Pages read", box: "thinking", unit: "per run", default: MAX_FETCHES, min: 4, max: MAX_FETCHES },
    max_turns: { label: "Model turns", box: "thinking", unit: "per run", default: MAX_TURNS, min: 2, max: MAX_TURNS },
  },
  choices: {
    areas: {
      label: "Areas", box: "reads", detail: "Where Rowan looks. Fixed list in code",
      options: AREA_OPTIONS.map((a) => ({ id: slug(a), label: a })),
      default: AREAS.map(slug), min: 1, max: 6,
    },
    business_types: {
      label: "Kinds of business", box: "thinking", detail: "Who counts as a fit. Fixed list in code",
      options: BUSINESS_TYPES, default: BUSINESS_TYPES.map((b) => b.id), min: 1, max: BUSINESS_TYPES.length,
    },
  },
  reads: [
    { id: "offer", label: "Offer facts", detail: "Our coffees, green lots and private label terms, from Shopify. The emails may only claim these", integration: "shopify", locked: true },
    { id: "pipeline", label: "Leads already found", detail: "Every business in wholesale_leads, so nobody is found twice", integration: "supabase", locked: true },
    { id: "web", label: "Web search and pages", detail: "Anthropic's web search near Austin, and the pages of each candidate. Untrusted: read, never obeyed", integration: "web", locked: true },
  ],
  outputs: [
    { id: "pipeline", label: "Lead pipeline", detail: "A row per lead in wholesale_leads. The next run reads it, so it stays on", integration: "supabase", locked: true },
    { id: "notion", label: "Notion page", detail: "A page per run with every lead and draft, under the page you pick", integration: "notion", env: ["NOTION_TOKEN"] },
    { id: "gmail", label: "Gmail drafts", detail: "A draft to each lead with a public email, in zak@onetwocoffeelab.com. Never sent", integration: "gmail", env: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"] },
  ],
  sections: [],
  notion: { output: "notion", dbProps: {}, envPage: "NOTION_LEADS_PARENT_ID", pageOnly: true },
  fixed: [
    { box: "thinking", label: "Answer shape", value: "record_leads: business, website, email, fit score and the draft", note: "The code checks every lead, so the shape stays in code" },
    { box: "thinking", label: "If the model declines", value: "The Claude API reruns the request on another Claude model it picks" },
    { box: "thinking", label: "Dry run", value: "Never calls the model or searches" },
    { box: "guardrails", label: "Leads checked in code", value: "Dedupe by website, email shape, fit score 1 to 5" },
    { box: "writes", label: "Email", value: "Drafts only, from Zak's account", note: "integrations/gmail.ts has no send. A first email to a new person always waits for Zak" },
  ],
  instructions: SOP,
  safety: SAFETY,
};
