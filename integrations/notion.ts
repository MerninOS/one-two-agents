import "server-only";
// Notion for agents and reports (docs/mcp-everywhere.md, slice 4). Every call goes to our own
// Notion MCP server (integrations/notion-server.ts) through integrations/mcp.ts, which opens the
// integration's key from the token vault for that call. The key reaches only pages shared with the
// agents' Notion integration. Reads are agent tools; pages and rows are reports, written by code.
import { settings } from "@/core/settings";
import { callLocalTool, localReady } from "@/integrations/mcp";
import type { Block, Props, Row } from "@/core/notion-blocks";

export { divider, h2, h3, li, notionPageId, p, prop, quote, rt, type Block, type Props, type Row } from "@/core/notion-blocks";

/** Whether Notion's key is in the vault and not paused. */
export const notionConnected = () => localReady("notion");

/** Creates a page under `parent` (default: the business's briefs page, Settings) and returns its URL. At most 100 blocks. */
export async function notionPage(title: string, children: Block[], parent?: string | null) {
  parent ||= (await settings()).notionBriefParent;
  if (!parent) throw new Error("set the Notion briefs page on Settings > Where things go");
  const page = await callLocalTool("notion", "notion_create_page", { parentId: parent, title, children }) as { url: string };
  return page.url;
}

/** Adds a row to a database, with the page body, and returns it. */
export const notionRow = async (databaseId: string, properties: Props, children: Block[]) =>
  await callLocalTool("notion", "notion_create_row", { databaseId, properties, children }) as Row;

/** Changes some properties of a row and leaves the rest alone (e.g. a Build Board card's Status). */
export const notionUpdateRow = async (pageId: string, properties: Props) =>
  await callLocalTool("notion", "notion_update_row", { pageId, properties }) as Row;

/** The newest row whose date property is exactly this day, or null. */
export const notionRowOn = async (databaseId: string, dateProp: string, date: string) =>
  await callLocalTool("notion", "notion_row_on", { databaseId, dateProp, date }) as Row | null;

/** Moves a row to Notion's trash (it can be restored there for 30 days). */
export const notionArchive = async (pageId: string) => await callLocalTool("notion", "notion_archive_row", { pageId }) as Row;

/**
 * The page's title and its text, read top level plus one level of nesting, stopping once `maxChars`
 * is reached. Read only. Throws when the page can't be read (not shared with the integration, deleted).
 */
export const notionPageText = async (pageId: string, maxChars = 6000) =>
  await callLocalTool("notion", "notion_page_text", { pageId, maxChars }) as { title: string; text: string; cut: boolean };
