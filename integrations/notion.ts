import "server-only";
// Notion pages and database rows for agent output (briefs, lead lists), via the REST API
// with an internal integration shared with the parent page.
import { env } from "@/core/env";

export type Block = Record<string, unknown>;
export const rt = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];
export const h2 = (t: string): Block => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(t) } });
export const h3 = (t: string): Block => ({ object: "block", type: "heading_3", heading_3: { rich_text: rt(t) } });
export const li = (t: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(t) } });
export const p = (t: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(t) } });
export const quote = (t: string): Block => ({ object: "block", type: "quote", quote: { rich_text: rt(t) } });
export const divider = (): Block => ({ object: "block", type: "divider", divider: {} });

async function notion<T>(method: "POST" | "PATCH", path: string, body: unknown): Promise<T> {
  if (!env.notionToken) throw new Error("NOTION_TOKEN must be set");
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.notionToken}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return await res.json() as T;
}

/** Creates a page under NOTION_BRIEF_PARENT_ID and returns its URL. Notion takes at most 100 blocks per request. */
export async function notionPage(title: string, children: Block[]) {
  if (!env.notionBriefParent) throw new Error("NOTION_TOKEN and NOTION_BRIEF_PARENT_ID must be set");
  const page = await notion<{ url: string }>("POST", "pages", { parent: { page_id: env.notionBriefParent }, properties: { title: { title: rt(title) } }, children: children.slice(0, 100) });
  return page.url;
}

// ---- Database rows. Property values in the shapes Notion's API takes.

export type Props = Record<string, unknown>;
export const prop = {
  title: (t: string) => ({ title: rt(t) }),
  text: (t: string) => ({ rich_text: rt(t) }),
  /** A blank cell when there is no number, never a zero. */
  num: (n: number | string | null | undefined) => ({ number: n == null || n === "" || !Number.isFinite(Number(n)) ? null : Number(n) }),
  date: (d: string | null | undefined) => ({ date: d ? { start: d } : null }),
  check: (b: boolean) => ({ checkbox: b }),
};
export interface Row { id: string; url: string; properties: Record<string, { checkbox?: boolean }> }

/** Adds a row to a database, with the page body, and returns it. */
export const notionRow = (databaseId: string, properties: Props, children: Block[]) =>
  notion<Row>("POST", "pages", { parent: { database_id: databaseId }, properties, children: children.slice(0, 100) });

/** The newest row whose date property is exactly this day, or null. */
export async function notionRowOn(databaseId: string, dateProp: string, date: string) {
  const r = await notion<{ results: Row[] }>("POST", `databases/${databaseId}/query`, {
    filter: { property: dateProp, date: { equals: date } },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 1,
  });
  return r.results[0] ?? null;
}

/** Changes some properties of a row and leaves the rest alone. */
export const notionSetProps = (pageId: string, properties: Props) => notion<Row>("PATCH", `pages/${pageId}`, { properties });

/** Moves a row to Notion's trash (it can be restored there for 30 days). */
export const notionArchive = (pageId: string) => notion<Row>("PATCH", `pages/${pageId}`, { archived: true });
