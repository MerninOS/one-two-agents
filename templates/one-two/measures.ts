import "server-only";
// One Two's goal measures (core/goal-rules.ts keys), counted in code like every measure.
import type { MeasureRead } from "@/core/measures";
import { cover } from "./green";

export const ONE_TWO_MEASURES: Record<string, () => Promise<MeasureRead>> = {
  /** The lowest days of green cover across listed lots, at the last 30 days' use. */
  lowest_cover_days: async () => {
    const rows = await cover(30);
    const known = rows.filter((r) => r.daysOfCover != null).map((r) => r.daysOfCover!);
    if (!known.length) return { reading: { error: rows.length ? "no listed lot was used in the last 30 days" : "no listed green lots" }, detail: null };
    return { reading: { value: Math.min(...known) }, detail: { lots: rows.map((r) => ({ lot: r.lot, days: r.daysOfCover })).sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)) } };
  },
};
