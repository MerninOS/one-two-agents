import "server-only";
// Receipt files onto an existing Mercury charge, and only the gateway may import this file
// (eslint.config.mjs blocks every other importer). One call: attach a file to the charge Zak
// approved. Mercury's MCP server can only upload a receipt and let Mercury pick the charge, so
// files stay here (slice 5b); a charge's category and memo go through the gateway's own Mercury
// sign-in (MCP_SERVERS.mercury_write). No endpoint that creates, cancels or moves money is here,
// and none may be added. It uses its own token, MERCURY_WRITE_TOKEN.
import { env } from "@/core/env";

const BASE = "https://api.mercury.com/api/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hasMercuryWrite = () => !!env.mercuryWriteToken;

function token() {
  if (!env.mercuryWriteToken) throw new Error("MERCURY_WRITE_TOKEN is not set");
  return env.mercuryWriteToken;
}
function txnPath(id: string) {
  if (!UUID.test(id)) throw new Error("Not a Mercury transaction id");
  return `${BASE}/transaction/${id}`;
}
async function fail(res: Response, what: string): Promise<never> {
  const body = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error(`Mercury ${res.status} on ${what}${body ? `: ${body}` : ""}`);
}

/** POST /transaction/{id}/attachments, multipart, attachmentType "receipt". Returns Mercury's attachment id. */
export async function attachReceipt(id: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string | null> {
  const form = new FormData();
  form.append("file", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
  form.append("attachmentType", "receipt");
  const res = await fetch(`${txnPath(id)}/attachments`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" }, body: form, cache: "no-store" });
  if (!res.ok) await fail(res, "attach receipt");
  const j = await res.json().catch(() => ({})) as { attachmentId?: string };
  return j.attachmentId ?? null;
}
