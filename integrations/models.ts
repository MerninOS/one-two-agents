import "server-only";
// Every model an agent may use, with its price and what it can do (docs/agent-setup.md, slice 3).
// Prices live here, in code, so cost lands in agent_runs the same way for every provider.
//
// Claude models go straight to the Claude API (integrations/anthropic.ts), so they keep effort,
// the server-side refusal fallback and Anthropic's own tools. Every other model goes through
// Vercel AI Gateway (integrations/gateway.ts). Gateway prices are the list prices its catalog
// showed on 2026-11-12, for prompts under 200K tokens; check them again when adding a model.
// Adding a model is a pull request on purpose: the Control Room can only pick from this list.

/** What a step can ask of a model. A step's menu names what it needs; only models with all of it are offered. */
export type Cap = "structured-output" | "anthropic-web-search" | "pdf" | "reasoning";

export interface ModelDef {
  id: string;
  label: string;
  provider: "Anthropic" | "OpenAI" | "Google";
  /** "anthropic": the Claude API with ANTHROPIC_API_KEY. "gateway": Vercel AI Gateway. */
  route: "anthropic" | "gateway";
  /** $ per token. */
  in: number;
  out: number;
  /** Tokens. */
  context: number;
  caps: readonly Cap[];
}

const M = 1e-6;
const LIST: ModelDef[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "Anthropic", route: "anthropic", in: 4 * M, out: 20 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "Anthropic", route: "anthropic", in: 2 * M, out: 10 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  // prompts up to 100K tokens; every agent's prompt is a few thousand
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "Anthropic", route: "anthropic", in: 0.1 * M, out: 0.5 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol", provider: "OpenAI", route: "gateway", in: 2 * M, out: 10 * M, context: 1_050_000, caps: ["structured-output", "pdf", "reasoning"] },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna", provider: "OpenAI", route: "gateway", in: 0.1 * M, out: 0.5 * M, context: 1_050_000, caps: ["structured-output", "pdf", "reasoning"] },
  { id: "google/gemini-4-argon", label: "Gemini 4 Argon", provider: "Google", route: "gateway", in: 2 * M, out: 10 * M, context: 1_000_000, caps: ["structured-output", "pdf", "reasoning"] },
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "Google", route: "gateway", in: 0.75 * M, out: 3.75 * M, context: 1_000_000, caps: ["structured-output", "pdf", "reasoning"] },
];

export const MODEL_LIST: readonly ModelDef[] = LIST;
export const MODEL_BY_ID: Readonly<Record<string, ModelDef>> = Object.fromEntries(LIST.map((m) => [m.id, m]));
export const modelDef = (id: string): ModelDef | null => MODEL_BY_ID[id] ?? null;

/** Model ids that can do everything a step needs, in list order. */
export const modelsFor = (needs: readonly Cap[]): string[] => LIST.filter((m) => needs.every((c) => m.caps.includes(c))).map((m) => m.id);
