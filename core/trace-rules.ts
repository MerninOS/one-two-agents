// Traces (docs/usage.md, slice 3): which facts a span may carry, worked out with no network so
// `npm run check:traces` can test it. A span carries only ids, names and numbers from this list,
// never an input, an output, a prompt or a reply, and every string is scrubbed and clipped.
import { scrubSecrets } from "@/core/mcp-rules";

/** The span names, one per kind of work. */
export const SPANS = ["job", "run", "model_call", "tool_call"] as const;
export type SpanName = (typeof SPANS)[number];

/** The only attributes a span may carry, and their kind. */
export const ATTRS = {
  "operator.org": "id",
  "operator.job": "id",
  "operator.job_kind": "name",
  "operator.run": "id",
  "operator.agent": "name",
  "operator.trigger": "name",
  "operator.chain": "name",
  "operator.tool": "name",
  "operator.server": "name",
  "operator.tool_kind": "name",
  "operator.model": "name",
  "operator.status": "name",
  "operator.tokens_in": "number",
  "operator.tokens_out": "number",
  "operator.cost_usd": "number",
} as const;
export type AttrKey = keyof typeof ATTRS;
export type SpanAttrs = Partial<Record<AttrKey, string | number | null | undefined>>;

const NAME = /^[A-Za-z0-9_.:\-/]{1,80}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The attributes as a span gets them: unknown keys dropped, strings scrubbed and checked, numbers finite. */
export function spanAttrs(raw: SpanAttrs): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const kind = (ATTRS as Record<string, string>)[k];
    if (!kind || v == null) continue;
    if (kind === "number") { if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.round(v * 1e6) / 1e6; continue; }
    if (typeof v !== "string") continue;
    const s = scrubSecrets(v).slice(0, 80);
    if ((kind === "id" ? ID : NAME).test(s)) out[k] = s;
  }
  return out;
}

/** An error's message for a span: scrubbed and cut short, since it may quote a reply. */
export const spanError = (e: unknown) => scrubSecrets(e instanceof Error ? e.message : String(e)).slice(0, 200);

const URLISH = /(^|\.)(url|target|full|query|route|path)$|^http\.(url|target)$/i;

/**
 * Every attribute any span carries (ours, Next.js's own, fetch's), as it leaves the app: a URL loses
 * its query string, since a sign-in callback carries a code there, and every string is scrubbed.
 */
export function cleanExported(attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "string") out[k] = scrubSecrets(URLISH.test(k) ? v.replace(/[?#].*$/s, "") : v).slice(0, 500);
    else if (Array.isArray(v)) out[k] = v.map((x) => (typeof x === "string" ? scrubSecrets(x).slice(0, 500) : x));
    else out[k] = v;
  }
  return out;
}
