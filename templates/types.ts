// The shape of a template pack (docs/templates.md): what one kind of business brings on top of
// core. Today a pack adds tools and goal measures; its crew, playbooks and tables come with the installer (later).
import type { MeasureRead } from "@/core/measures";
import type { ToolDef } from "@/core/tools/types";

export interface TemplatePack {
  /** Short id, lowercase. */
  id: string;
  name: string;
  about: string;
  /** Tools added to the tool list. Held to the same rules as core tools; ids never clash with core's. */
  tools: readonly ToolDef[];
  /** Goal measures this pack counts, by core/goal-rules.ts key. */
  measures?: Readonly<Record<string, () => Promise<MeasureRead>>>;
}
