import "server-only";
// Gmail drafts for agent outreach. The OAuth grant only needs the gmail.compose
// scope; agents create drafts and never call send, so Zak sends every email.
import { env } from "@/core/env";

export const hasGmail = () => !!(env.gmailClientId && env.gmailClientSecret && env.gmailRefreshToken);

async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.gmailClientId!, client_secret: env.gmailClientSecret!,
      refresh_token: env.gmailRefreshToken!, grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json() as { access_token: string }).access_token;
}

// RFC 2047 so non-ASCII subjects survive
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

/** Creates a plain-text draft in the connected mailbox and returns its draft id. */
export async function createDraft(to: string, subject: string, body: string) {
  const mime = [
    `To: ${to}`,
    `Subject: ${header(subject.replace(/[\r\n]+/g, " "))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body).toString("base64"),
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { raw: Buffer.from(mime).toString("base64url") } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json() as { id: string }).id;
}
