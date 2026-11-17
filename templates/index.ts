import "server-only";
// The installed template packs (docs/templates.md). This is the one place core learns about a pack:
// core/tools/catalog.ts adds each pack's tools to the tool list, and core/measures.ts reads its goal measures. Adding a pack is a pull request.
import { oneTwo } from "./one-two";
import type { TemplatePack } from "./types";
import type { MeasureRead } from "@/core/measures";
import type { ToolDef } from "@/core/tools/types";

export const PACKS: readonly TemplatePack[] = [oneTwo];

/** Every installed pack's tools, in pack order. */
export const packTools = (): ToolDef[] => PACKS.flatMap((p) => [...p.tools]);

/** The first installed pack's reader for a goal measure, or null when no pack counts it. */
export function packMeasure(key: string): (() => Promise<MeasureRead>) | null {
  for (const p of PACKS) { const m = p.measures?.[key]; if (m) return m; }
  return null;
}
