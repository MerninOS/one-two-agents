// One Two's goal measures, as the goal picker lists them (core/goal-rules.ts MeasureDef). Pure. The
// readers are in ./measures.ts, counted in code like every measure.
import type { MeasureDef } from "@/core/goal-rules";

export const ONE_TWO_MEASURE_DEFS: readonly MeasureDef[] = [
  { key: "lowest_cover_days", label: "Lowest days of green cover", how: "for each listed green lot, pounds on hand divided by what orders used per day over the last 30 days; the lowest lot counts.", unit: "days", shape: "floor", available: true, hint: "coffee" },
];
