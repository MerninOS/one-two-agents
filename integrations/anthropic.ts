import "server-only";
// One place for the Claude client, model ids and per-token prices, so cost lands in
// agent_runs the same way for every agent. Keep PRICES in step with the models used;
// add a model here (with its price) before an agent uses it.
import Anthropic from "@anthropic-ai/sdk";

export { Anthropic };

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;
export type Model = (typeof MODELS)[keyof typeof MODELS];
/** True for a model id that has a price here, so its cost can be computed. */
export const isModel = (id: string): id is Model => (Object.values(MODELS) as string[]).includes(id);

/** $ per token in and out. */
const PRICES: Record<Model, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4 / 1e6, out: 20 / 1e6 },
  "claude-sonnet-5-5": { in: 2 / 1e6, out: 10 / 1e6 },
  // prompts up to 100K tokens; Bookkeeper's are a few thousand
  "claude-haiku-5-5": { in: 0.1 / 1e6, out: 0.5 / 1e6 },
};
export const WEB_SEARCH_USD = 0.01; // per search

export const claude = () => new Anthropic(); // reads ANTHROPIC_API_KEY

/** Every input token a response billed, cache reads and writes included. */
export const inputTokens = (u: Anthropic.Beta.BetaUsage | Anthropic.Usage) =>
  u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

export const costUsd = (model: Model, tokensIn: number, tokensOut: number, searches = 0) =>
  Number((tokensIn * PRICES[model].in + tokensOut * PRICES[model].out + searches * WEB_SEARCH_USD).toFixed(4));
