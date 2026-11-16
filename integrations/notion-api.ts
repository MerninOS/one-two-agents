import "server-only";
// Notion's REST API for our own Notion MCP server (docs/mcp-everywhere.md, slice 4). Every function
// takes the integration key as an argument: the key comes out of the token vault per call, so
// nothing here reads a setting. Only integrations/notion-server.ts imports this (lint enforces it).
import type { Block, Props, Row } from "@/core/notion-blocks";
import { rt } from "@/core/notion-blocks";

const TIMEOUT_MS = 25_000;

async function notion<T>(token: string, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1/${path}`, {
    method,
    // a request carrying the key never follows a redirect
    redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return await res.json() as T;
}

/** Who the key belongs to. Must be an integration (a bot), never a person's sign-in. */
export async function me(token: string): Promise<{ name: string; workspace: string }> {
  const u = await notion<{ type?: string; name?: string; bot?: { workspace_name?: string } }>(token, "GET", "users/me");
  if (u.type !== "bot") throw new Error("that key isn't an integration's key");
  return { name: (u.name ?? "integration").slice(0, 80), workspace: (u.bot?.workspace_name ?? "").slice(0, 80) };
}

/** A page under `parentId`, and its URL. Notion takes at most 100 blocks per request. */
export async function createPage(token: string, parentId: string, title: string, children: Block[]) {
  const page = await notion<{ id: string; url: string }>(token, "POST", "pages", { parent: { page_id: parentId }, properties: { title: { title: rt(title) } }, children: children.slice(0, 100) });
  return { id: page.id, url: page.url };
}

const rowOf = (r: Row): Row => ({ id: r.id, url: r.url, properties: r.properties });

/** A row in a database, with its page body. */
export const createRow = async (token: string, databaseId: string, properties: Props, children: Block[]) =>
  rowOf(await notion<Row>(token, "POST", "pages", { parent: { database_id: databaseId }, properties, children: children.slice(0, 100) }));

/** Changes some properties of a row and leaves the rest alone. */
export const updateRow = async (token: string, pageId: string, properties: Props) => rowOf(await notion<Row>(token, "PATCH", `pages/${pageId}`, { properties }));

/** Moves a row to Notion's trash (it can be restored there for 30 days). */
export const archiveRow = async (token: string, pageId: string) => rowOf(await notion<Row>(token, "PATCH", `pages/${pageId}`, { archived: true }));

/** The newest row whose date property is exactly this day, or null. */
export async function rowOn(token: string, databaseId: string, dateProp: string, date: string): Promise<Row | null> {
  const r = await notion<{ results: Row[] }>(token, "POST", `databases/${databaseId}/query`, {
    filter: { property: dateProp, date: { equals: date } },
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    page_size: 1,
  });
  return r.results[0] ? rowOf(r.results[0]) : null;
}

type Rich = { plain_text?: string }[];
interface BlockRow { id: string; type: string; has_children?: boolean; [k: string]: unknown }
const PREFIX: Record<string, string> = { heading_1: "# ", heading_2: "## ", heading_3: "### ", bulleted_list_item: "- ", numbered_list_item: "- ", to_do: "- ", quote: "> ", callout: "" };

/**
 * The page's title and its text, read top level plus one level of nesting, stopping once `maxChars`
 * is reached. Throws when the page can't be read (not shared with the integration, deleted).
 */
export async function pageText(token: string, pageId: string, maxChars: number): Promise<{ title: string; text: string; cut: boolean }> {
  const page = await notion<{ properties?: Record<string, { type: string; title?: Rich }> }>(token, "GET", `pages/${pageId}`);
  const titleProp = Object.values(page.properties ?? {}).find((v) => v.type === "title");
  const title = (titleProp?.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || "Untitled";
  const lines: string[] = [];
  let size = 0, cut = false;
  const walk = async (id: string, depth: number) => {
    let cursor: string | undefined;
    do {
      const res = await notion<{ results: BlockRow[]; has_more: boolean; next_cursor: string | null }>(token, "GET", `blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
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
