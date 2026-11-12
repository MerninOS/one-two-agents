import "server-only";
// The Claude client, the Claude model ids agents use in code, and cost from the price list in
// integrations/models.ts (every provider's prices live there).
import Anthropic from "@anthropic-ai/sdk";
import { modelDef } from "./models";

export { Anthropic };

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;
export type Model = (typeof MODELS)[keyof typeof MODELS];
/** True for a model id with a price in integrations/models.ts, so its cost can be computed. */
export const isModel = (id: string): boolean => !!modelDef(id);

export const WEB_SEARCH_USD = 0.01; // per search
/** $ per token in and out, for estimates shown in the Control Room. Null for a model without a price. */
export const priceOf = (id: string): { in: number; out: number } | null => { const m = modelDef(id); return m ? { in: m.in, out: m.out } : null; };

export const claude = () => new Anthropic(); // reads ANTHROPIC_API_KEY

/** Every input token a response billed, cache reads and writes included. */
export const inputTokens = (u: Anthropic.Beta.BetaUsage | Anthropic.Usage) =>
  u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

/** Cost in code from the price list, for any provider. Throws for a model without a price: an agent checks before it calls one. */
export function costUsd(model: string, tokensIn: number, tokensOut: number, searches = 0) {
  const m = modelDef(model);
  if (!m) throw new Error(`No price for ${model} in integrations/models.ts`);
  return Number((tokensIn * m.in + tokensOut * m.out + searches * WEB_SEARCH_USD).toFixed(4));
}
