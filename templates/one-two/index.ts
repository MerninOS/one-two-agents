// One Two Coffee Lab's template pack (docs/templates.md): the first business on OPERATOR, and an
// example another business can learn from. Core never reaches into it; it is registered in
// templates/index.ts.
import type { TemplatePack } from "@/templates/types";
import { ONE_TWO_CREW } from "./crew";
import { ONE_TWO_PLANNED } from "./planned";

export const oneTwo: TemplatePack = {
  id: "one-two",
  name: "One Two Coffee Lab",
  about: "A small-batch coffee roaster: daily numbers, the morning brief, books and receipts, wholesale leads. Its coffee numbers come from its own server (MerninOS/blended /api/agents-mcp).",
  tools: [],
  tables: [],
  crew: ONE_TWO_CREW,
  planned: ONE_TWO_PLANNED,
};
