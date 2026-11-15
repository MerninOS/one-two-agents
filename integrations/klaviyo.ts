import "server-only";
// Klaviyo reads over its MCP server (docs/company-mode.md, slice 6), read-only: lists, a list's
// size, and campaign and flow results. Every count and rate is added up in code from the raw reply
// (core/mcp-rules.ts), never by a model.
import { callMcpTool } from "@/integrations/mcp";
import { REPORT_STATS, listSize, namedRows, nextCursor, reportRows, reportTotals, type ReportRow } from "@/core/mcp-rules";

const PAGES = 10;

/** Every list's id and name (the server pages 10 at a time). */
export async function klaviyoLists(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < PAGES; i++) {
    const page = await callMcpTool("klaviyo", "get_lists", { fields_list: ["name"], ...(cursor ? { page_cursor: cursor } : {}) });
    out.push(...namedRows(page));
    cursor = nextCursor(page);
    if (!cursor) break;
  }
  return out;
}

/** How many profiles are on one list. */
export async function klaviyoListSize(listId: string) {
  const r = listSize(await callMcpTool("klaviyo", "get_list", { id: listId, additional_fields_list: ["profile_count"] }));
  if (!r) throw new Error("Klaviyo didn't say how many profiles are on that list");
  return r;
}

/** The "Placed Order" metric, which campaign and flow results count orders and revenue by. */
async function placedOrder(): Promise<string> {
  let cursor: string | null = null;
  for (let i = 0; i < PAGES; i++) {
    const page = await callMcpTool("klaviyo", "get_metrics", { fields_metric: ["name"], ...(cursor ? { page_cursor: cursor } : {}) });
    const m = namedRows(page).find((x) => x.name.toLowerCase() === "placed order");
    if (m) return m.id;
    cursor = nextCursor(page);
    if (!cursor) break;
  }
  throw new Error("Klaviyo has no “Placed Order” metric to count orders by");
}

/** Campaign or flow results over a period: one row per message, and totals worked out in code. */
export async function klaviyoReport(kind: "campaign" | "flow", period: string): Promise<{ rows: ReportRow[]; totals: Record<string, number> }> {
  const metric = await placedOrder();
  const raw = await callMcpTool("klaviyo", kind === "campaign" ? "get_campaign_report" : "get_flow_report", {
    statistics: [...REPORT_STATS],
    value_statistics: ["conversion_value"],
    conversion_metric_id: metric,
    timeframe: { key: period },
  });
  const rows = reportRows(raw, kind);
  return { rows, totals: reportTotals(rows) };
}
