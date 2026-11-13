// The shape of a tool on the tool list (docs/agent-builder.md). A tool is a small, specific
// ability written in code. An agent built in the app can only be handed tools from this list,
// and the model can only call the tools its spec grants. Adding a tool is a pull request on
// purpose, so nothing a model reads (a web page, an email, another agent's words) can add one.

/**
 * read: fetches data. calculate: plain code that works numbers out, no model, so numbers are
 * always computed in code. report: writes to Zak or our own stores (slice 5). action: only
 * through core/gateway (slice 5).
 */
export type ToolKind = "read" | "calculate" | "report" | "action";

/** Groups on the builder screen, one per integration. */
export type ToolGroup = "shopify" | "mercury" | "supabase" | "notion" | "calculate" | "agents" | "web" | "gmail";

/** One input the model may pass. Kept to plain shapes so code can check every value. */
export type Param =
  | { name: string; type: "int"; min: number; max: number; default: number; description: string }
  | { name: string; type: "enum"; options: readonly string[]; default?: string; description: string };

export interface ToolCtx {
  agentId: string;
  /** Notion pages the spec allows notion_read_page to open: the model picks one of these ids, never a URL. */
  notionPages: { id: string; label: string }[];
  /** Agents whose latest output agent_output may read: the model picks one of these ids. */
  outputSources: { agentId: string; label: string }[];
}

export interface ToolResult {
  /** What the model sees. Serialised and cut to a size limit by the runner. */
  data: unknown;
  /** Numbers this tool computed in code. Later slices only let outputs and checks use numbers from here. */
  numbers?: Record<string, number>;
}

export interface ToolDef {
  id: string;
  label: string;
  /** One line for the builder screen and the model. */
  detail: string;
  kind: ToolKind;
  group: ToolGroup;
  params: readonly Param[];
  /** When the inputs depend on the spec (Notion pages the spec allows), this replaces params. */
  paramsFor?: (ctx: ToolCtx) => Param[];
  /**
   * False when what comes back is written by people outside One Two (web pages, emails, merchant
   * names, lead websites, another agent's summary). The runner labels it as untrusted data, and
   * slice 5 stops a run that read it from choosing a recipient, URL, product or category.
   */
  trusted: boolean;
  /** Which settings must be present, by name (core/env.ts); the builder shows Connected or Missing key. */
  needs: readonly string[];
  /** Rough cost of one call outside the model, in dollars (0 for most). */
  costUsd: number;
  run: (input: Record<string, string | number>, ctx: ToolCtx) => Promise<ToolResult>;
}

export const paramsOf = (t: ToolDef, ctx: ToolCtx): readonly Param[] => (t.paramsFor ? t.paramsFor(ctx) : t.params);

/** The checked input: every param present and inside its range or list, extra keys dropped. Null with the reason when a value is wrong. */
export function checkInput(params: readonly Param[], raw: unknown): { input: Record<string, string | number> } | { problem: string } {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const input: Record<string, string | number> = {};
  for (const p of params) {
    const v = src[p.name];
    if (p.type === "int") {
      if (v === undefined || v === null) { input[p.name] = p.default; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < p.min || n > p.max) return { problem: `${p.name} must be a whole number from ${p.min} to ${p.max}` };
      input[p.name] = n;
    } else {
      if (v === undefined || v === null) {
        if (p.default === undefined) return { problem: `${p.name} is required` };
        input[p.name] = p.default; continue;
      }
      if (typeof v !== "string" || !p.options.includes(v)) return { problem: `${p.name} must be one of: ${p.options.join(", ")}` };
      input[p.name] = v;
    }
  }
  return { input };
}

/** JSON Schema for the Claude API, from the params. */
export function inputSchema(params: readonly Param[]) {
  const properties: Record<string, unknown> = {};
  for (const p of params) {
    properties[p.name] = p.type === "int"
      ? { type: "integer", minimum: p.min, maximum: p.max, description: `${p.description} Default ${p.default}.` }
      : { type: "string", enum: [...p.options], description: p.description };
  }
  return { type: "object" as const, properties, required: params.filter((p) => p.type === "enum" && p.default === undefined).map((p) => p.name), additionalProperties: false };
}
