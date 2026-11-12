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

async function notion<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  if (!env.notionToken) throw new Error("NOTION_TOKEN must be set");
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.notionToken}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return await res.json() as T;
}

/** Creates a page under `parent` (default NOTION_BRIEF_PARENT_ID) and returns its URL. Notion takes at most 100 blocks per request. */
export async function notionPage(title: string, children: Block[], parent = env.notionBriefParent) {
  if (!parent) throw new Error("NOTION_TOKEN and NOTION_BRIEF_PARENT_ID must be set");
  const page = await notion<{ url: string }>("POST", "pages", { parent: { page_id: parent }, properties: { title: { title: rt(title) } }, children: children.slice(0, 100) });
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

// ---- Reading a page as plain text (agent memory: a standing order may point at a page to load).

/** A Notion page id (32 hex characters, with or without dashes) out of an id or a notion.so / notion.site link, or null. */
export function notionPageId(input: string): string | null {
  const m = input.replace(/-/g, "").match(/([0-9a-f]{32})(?:[?#].*)?$/i) ?? input.replace(/-/g, "").match(/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

type Rich = { plain_text?: string }[];
interface BlockRow { id: string; type: string; has_children?: boolean; [k: string]: unknown }

const PREFIX: Record<string, string> = { heading_1: "# ", heading_2: "## ", heading_3: "### ", bulleted_list_item: "- ", numbered_list_item: "- ", to_do: "- ", quote: "> ", callout: "" };

/**
 * The page's title and its text, read top level plus one level of nesting, stopping once `maxChars`
 * is reached. Read only. Throws when the page can't be read (not shared with the integration, deleted).
 */
export async function notionPageText(pageId: string, maxChars = 6000): Promise<{ title: string; text: string; cut: boolean }> {
  const page = await notion<{ properties?: Record<string, { type: string; title?: Rich }> }>("GET", `pages/${pageId}`);
  const titleProp = Object.values(page.properties ?? {}).find((v) => v.type === "title");
  const title = (titleProp?.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || "Untitled";
  const lines: string[] = [];
  let size = 0, cut = false;
  const walk = async (id: string, depth: number) => {
    let cursor: string | undefined;
    do {
      const res = await notion<{ results: BlockRow[]; has_more: boolean; next_cursor: string | null }>("GET", `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
      for (const b of res.results) {
        if (size >= maxChars) { cut = true; return; }
        const body = b[b.type] as { rich_text?: Rich } | undefined;
        const text = (body?.rich_text ?? []).map((t) => t.plain_text ?? "").join("").trim();
        if (text) { const line = `${"  ".repeat(depth)}${PREFIX[b.type] ?? ""}${text}`; lines.push(line); size += line.length + 1; }
        if (b.has_children && depth < 1 && b.type !== "child_page" && b.type !== "child_database") await walk(b.id, depth + 1);
      }
      cursor = res.has_more ? res.next_cursor ?? undefined : undefined;
    } while (cursor && size < maxChars);
    if (cursor) cut = true;
  };
  await walk(pageId, 0);
  let text = lines.join("\n");
  if (text.length > maxChars) { text = text.slice(0, maxChars); cut = true; }
  return { title, text, cut };
}

// ---- Finding where an output may go (agent setup: the Notion target picker). Read only.

export interface NotionPlace {
  kind: "database" | "page";
  /** 32 hex characters, no dashes */
  id: string;
  title: string;
  url: string;
  /** A database's properties, name to Notion type. */
  props?: Record<string, string>;
}

type Found = { object: "page" | "database"; id: string; url: string; archived?: boolean; in_trash?: boolean; title?: Rich; properties?: Record<string, { type: string; title?: Rich }> };

const place = (r: Found): NotionPlace => {
  const id = r.id.replace(/-/g, "");
  if (r.object === "database") {
    return { kind: "database", id, url: r.url, title: (r.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || "Untitled", props: Object.fromEntries(Object.entries(r.properties ?? {}).map(([k, v]) => [k, v.type])) };
  }
  const t = Object.values(r.properties ?? {}).find((v) => v.type === "title");
  return { kind: "page", id, url: r.url, title: (t?.title ?? []).map((x) => x.plain_text ?? "").join("").trim() || "Untitled" };
};

/**
 * Pages and databases the integration can see, matching `query` (blank: the most recently
 * edited). Only what was shared with the integration ever shows up, so nothing here widens access.
 */
export async function notionSearch(query: string, limit = 20): Promise<NotionPlace[]> {
  const r = await notion<{ results: Found[] }>("POST", "search", { query: query.slice(0, 100), page_size: Math.min(limit, 50), sort: { direction: "descending", timestamp: "last_edited_time" } });
  return r.results.filter((x) => !x.archived && !x.in_trash && (x.object === "page" || x.object === "database")).map(place);
}

/** One page or database by id, as the integration sees it. Throws when it isn't shared or doesn't exist. */
export async function notionPlace(kind: "database" | "page", id: string): Promise<NotionPlace> {
  const r = await notion<Found>("GET", `${kind === "database" ? "databases" : "pages"}/${id}`);
  if (r.archived || r.in_trash) throw new Error(`That ${kind} is in Notion's trash.`);
  return place({ ...r, object: kind });
}

/** The properties a database is missing, compared with what an output writes (name to type). Empty when it fits. */
export const missingProps = (have: Record<string, string> | undefined, need: Record<string, string>) =>
  Object.entries(need).filter(([k, t]) => have?.[k] !== t).map(([k, t]) => `${k} (${t.replace("rich_text", "text")})`);
