import "server-only";
// Vercel AI Gateway (docs/agent-setup.md, slice 3): every non-Claude model in
// integrations/models.ts is called here, through the gateway's Anthropic Messages endpoint, so
// one client and one response shape serve every provider.
//
// Sign-in: AI_GATEWAY_API_KEY when it is set (local runs, or to bill a separate key), otherwise
// the deployment's own Vercel OIDC token, which Vercel rotates; it is read fresh on every call.
// No provider key (OpenAI, Google) is ever needed here or stored in the app.
import { getVercelOidcToken } from "@vercel/oidc";
import { Anthropic } from "./anthropic";

export const GATEWAY_URL = "https://ai-gateway.vercel.sh";

/** True when a gateway call can sign in: a key is set, or the code is running on Vercel. */
export const hasGateway = () => !!process.env.AI_GATEWAY_API_KEY?.trim() || !!process.env.VERCEL;

export async function gateway(): Promise<Anthropic> {
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  let apiKey = key;
  if (!apiKey) {
    try { apiKey = await getVercelOidcToken(); }
    catch (e) { throw new Anthropic.AnthropicError(`AI Gateway sign-in failed: no AI_GATEWAY_API_KEY and no Vercel OIDC token (${e instanceof Error ? e.message : String(e)})`); }
  }
  return new Anthropic({ apiKey, baseURL: GATEWAY_URL, maxRetries: 1 });
}
