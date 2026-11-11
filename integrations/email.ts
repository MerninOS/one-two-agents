import "server-only";
// Email to Zak, and only to Zak: the morning brief and (later) alerts. It goes through
// Resend's API from a sending address on the One Two domain, so no agent ever holds a
// Gmail send scope. There is deliberately no recipient argument: the address comes from
// BRIEF_TO, and nothing a model, a web page or an inbound email says can change it.
// Messages to anyone else are gateway action types (core/gateway), not this file.
import { env } from "@/core/env";

export const hasEmail = () => !!(env.resendKey && env.briefFrom && env.briefTo);

/** Sends one email to the fixed BRIEF_TO address and returns Resend's message id. */
export async function emailZak(subject: string, html: string, text: string) {
  if (!hasEmail()) throw new Error("RESEND_API_KEY, BRIEF_FROM and BRIEF_TO must be set");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.briefFrom, to: [env.briefTo], subject, html, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json() as { id: string }).id;
}
