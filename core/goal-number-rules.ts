// Goal numbers from your own tools (docs/custom-servers.md, card 133). The owner can mark a turned-on
// custom tool as a goal number: which field of its reply holds the number, a label, the unit and the
// shape. Each one becomes a measure in the goal picker. Code calls the tool with its pins only (no
// model), reads the field, and checks it is a plain number. A goal decides nothing an agent may do,
// so an outside number can only move its goal's own line. Pure, so check:goal-numbers can test it.
import { createHash } from "node:crypto";
import type { CustomServer, CustomTool, ToolOn } from "./custom-mcp-rules";
import type { MeasureDef, MeasureShape, Unit } from "./goal-rules";

/** What the owner set on a tool to use it as a goal number. `brief`: also listed under Numbers in the morning brief (card 133.5). */
export interface GoalNumber { field: string; label: string; unit: Unit; shape: Exclude<MeasureShape, "month">; brief?: true }

export const NUMBER_UNITS: readonly Unit[] = ["count", "usd", "days", "months"];
export const NUMBER_SHAPES: readonly GoalNumber["shape"][] = ["total", "floor"];
/** A field in the reply: up to three names joined by dots, like numbers.lowest_days_of_cover. */
export const FIELD = /^[A-Za-z_][A-Za-z0-9_]{0,63}(\.[A-Za-z_][A-Za-z0-9_]{0,63}){0,2}$/;
export const MAX_NUMBER = 1e9;
/** Every goal number's measure key starts with this, then a short hash. */
export const NUMBER_PREFIX = "n_";

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim() : "").slice(0, max + 1);

/** The required inputs a tool has that the owner hasn't pinned. Code can only call it when there are none. */
export const unpinned = (t: CustomTool, on: ToolOn): string[] => t.inputs.filter((i) => i.required && !(i.name in on.pins)).map((i) => i.name);

/** Checks what the owner typed to use a tool as a goal number. */
export function checkGoalNumber(raw: { field?: unknown; label?: unknown; unit?: unknown; shape?: unknown; brief?: unknown }, t: CustomTool, on: ToolOn): { number: GoalNumber } | { problem: string } {
  const field = clean(raw.field, 200);
  if (!FIELD.test(field)) return { problem: "The field is up to three names joined by dots, like numbers.lowest_days_of_cover." };
  const label = clean(raw.label, 60);
  if (label.length < 3) return { problem: "Give the number a name, like Lowest days of green cover." };
  if (label.length > 60) return { problem: "Keep the name to 60 characters." };
  if (/https?:\/\/|www\.|<|>/i.test(label)) return { problem: "The name can't hold a link." };
  if (!NUMBER_UNITS.includes(raw.unit as Unit)) return { problem: "Pick what the number counts." };
  if (!NUMBER_SHAPES.includes(raw.shape as GoalNumber["shape"])) return { problem: "Pick whether it's a total to reach or a level to stay at or above." };
  const missing = unpinned(t, on);
  if (missing.length) return { problem: `Pin ${missing.join(", ")} first: code calls this tool on its own, with only the pinned inputs.` };
  const brief = raw.brief === true || raw.brief === "on";
  return { number: { field, label, unit: raw.unit as Unit, shape: raw.shape as GoalNumber["shape"], ...(brief ? { brief: true as const } : {}) } };
}

/** The measure key for a server's tool and field: stable when the owner renames the tool or the number. */
export function numberKey(serverId: string, tool: string, field: string): string {
  return NUMBER_PREFIX + createHash("sha256").update(`${serverId}\n${tool}\n${field}`).digest("hex").slice(0, 12);
}
export const isNumberKey = (k: string | null | undefined): boolean => !!k && new RegExp(`^${NUMBER_PREFIX}[0-9a-f]{12}$`).test(k);

/** The number at a field of a tool's reply, or why there isn't one. Only a plain finite number counts. */
export function numberFrom(data: unknown, field: string): { value: number } | { error: string } {
  if (!FIELD.test(field)) return { error: "the field isn't a plain field name" };
  let v: unknown = data;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return { error: "the reply isn't JSON" }; } }
  for (const part of field.split(".")) {
    if (!v || typeof v !== "object" || Array.isArray(v) || !Object.prototype.hasOwnProperty.call(v, part)) return { error: `the reply has no ${field}` };
    v = (v as Record<string, unknown>)[part];
  }
  if (typeof v !== "number" || !Number.isFinite(v)) return { error: `${field} isn't a number` };
  if (Math.abs(v) > MAX_NUMBER) return { error: `${field} is too big to be right` };
  return { value: v };
}

/** One goal number, with where it comes from. */
export interface NumberSource { key: string; serverId: string; server: string; tool: string; toolLabel: string; number: GoalNumber }

/** Every goal number on the business's servers. */
export function numberSources(servers: readonly CustomServer[]): NumberSource[] {
  return servers.flatMap((c) => Object.entries(c.toolsOn).flatMap(([tool, on]) => on.number
    ? [{ key: numberKey(c.id, tool, on.number.field), serverId: c.id, server: c.name, tool, toolLabel: on.label, number: on.number }]
    : []));
}

/** A number as the brief shows it: "Orders to roast: 4", "Green cost: $1,234", "Cover: 21 days". */
export function numberText(n: Pick<GoalNumber, "label" | "unit">, value: number): string {
  const v = n.unit === "usd" ? `$${Math.round(value).toLocaleString("en-US")}` : n.unit === "count" ? Math.round(value).toLocaleString("en-US") : `${Math.round(value * 10) / 10} ${n.unit}`;
  return `${n.label}: ${v}`;
}

/** Goal numbers as measures for the goal picker and the goal page. */
export function numberDefs(sources: readonly NumberSource[]): MeasureDef[] {
  return sources.map((s) => ({
    key: s.key, label: s.number.label, unit: s.number.unit, shape: s.number.shape, available: true, hint: "own",
    how: `${s.number.field} in the reply of ${s.toolLabel} on ${s.server}, a server you added. Code calls it with its pinned inputs and reads that field; the server works out the number.`,
  }));
}
