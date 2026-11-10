import "server-only";
// The only Mercury writes in this repo, and only the gateway may import this file
// (eslint.config.mjs blocks every other importer). Two calls, both on a transaction that
// already exists: set its note and/or category, and attach a receipt file. No endpoint that
// creates, cancels or moves money is here, and none may be added.
//
// It uses its own token, MERCURY_WRITE_TOKEN (a Custom token with only the transaction
// write scope), so the read-only MERCURY_API_TOKEN the agents use stays read-only.
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

/** PATCH /transaction/{id} with only note and/or categoryId. A field left undefined is not sent, so Mercury keeps it. */
export async function patchTransaction(id: string, patch: { note?: string; categoryId?: string }) {
  const body: Record<string, string> = {};
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.categoryId !== undefined) body.categoryId = patch.categoryId;
  if (!Object.keys(body).length) return;
  const res = await fetch(txnPath(id), {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) await fail(res, "update transaction");
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
