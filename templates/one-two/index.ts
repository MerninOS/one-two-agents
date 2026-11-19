// One Two Coffee Lab's template pack (docs/templates.md): the first business on OPERATOR, and an
// example another business can learn from. Core never reaches into it; it is registered in
// templates/index.ts.
import type { TemplatePack } from "@/templates/types";
import { ONE_TWO_CREW } from "./crew";
import { ONE_TWO_MEASURES } from "./measures";
import { ONE_TWO_TOOLS } from "./tools";
import { ONE_TWO_PLANNED } from "./planned";

export const oneTwo: TemplatePack = {
  id: "one-two",
  name: "One Two Coffee Lab",
  about: "A small-batch coffee roaster: green lot cover and reorders, daily numbers, the morning brief, books and receipts, wholesale leads.",
  tools: ONE_TWO_TOOLS,
  tables: ["kpi_snapshots"],
  measures: ONE_TWO_MEASURES,
  crew: ONE_TWO_CREW,
  planned: ONE_TWO_PLANNED,
};
