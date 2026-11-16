// Notion shapes (docs/mcp-everywhere.md, slice 4). Pure: block and property builders the agents
// use to write reports, and the checks the Notion server makes on every request, so
// `npm run check:mcp` can test them.

export type Block = Record<string, unknown>;
export const rt = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];
export const h2 = (t: string): Block => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(t) } });
export const h3 = (t: string): Block => ({ object: "block", type: "heading_3", heading_3: { rich_text: rt(t) } });
export const li = (t: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(t) } });
export const p = (t: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(t) } });
export const quote = (t: string): Block => ({ object: "block", type: "quote", quote: { rich_text: rt(t) } });
export const divider = (): Block => ({ object: "block", type: "divider", divider: {} });

// ---- Database rows. Property values in the shapes Notion's API takes.

export type Props = Record<string, unknown>;
export const prop = {
  title: (t: string) => ({ title: rt(t) }),
  text: (t: string) => ({ rich_text: rt(t) }),
  /** A blank cell when there is no number, never a zero. */
  num: (n: number | string | null | undefined) => ({ number: n == null || n === "" || !Number.isFinite(Number(n)) ? null : Number(n) }),
  date: (d: string | null | undefined) => ({ date: d ? { start: d } : null }),
  check: (b: boolean) => ({ checkbox: b }),
  status: (name: string) => ({ status: { name } }),
  select: (name: string) => ({ select: { name } }),
};
export interface Row { id: string; url: string; properties: Record<string, { checkbox?: boolean }> }

/** A Notion page id (32 hex characters, with or without dashes) out of an id or a notion.so / notion.site link, or null. */
export function notionPageId(input: string): string | null {
  const m = input.replace(/-/g, "").match(/([0-9a-f]{32})(?:[?#].*)?$/i) ?? input.replace(/-/g, "").match(/([0-9a-f]{32})/i);
  return m ? m[1].toLowerCase() : null;
}

// ---- What the Notion server accepts. Every request is checked here before it reaches Notion.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const id32 = (x: unknown) => (typeof x === "string" && /^[0-9a-f]{32}$/.test(x.replace(/-/g, "").toLowerCase()) ? x.replace(/-/g, "").toLowerCase() : null);
const MAX_BLOCKS = 100;

export type NotionArgs =
  | { tool: "notion_page_text"; pageId: string; maxChars: number }
  | { tool: "notion_row_on"; databaseId: string; dateProp: string; date: string }
  | { tool: "notion_create_page"; parentId: string; title: string; children: Block[] }
  | { tool: "notion_create_row"; databaseId: string; properties: Props; children: Block[] }
  | { tool: "notion_update_row"; pageId: string; properties: Props }
  | { tool: "notion_archive_row"; pageId: string };

const blocks = (x: unknown): Block[] | string => {
  if (x === undefined) return [];
  if (!Array.isArray(x)) return "children must be a list of blocks";
  if (x.some((b) => !b || typeof b !== "object" || typeof (b as Json).type !== "string")) return "every block needs a type";
  return (x as Block[]).slice(0, MAX_BLOCKS);
};
const props = (x: unknown): Props | string => {
  const o = obj(x);
  if (!Object.keys(o).length) return "properties are required";
  if (Object.keys(o).some((k) => k.length > 100)) return "a property name is too long";
  return o;
};

/** The checked arguments for one Notion tool, or why not. */
export function checkNotionArgs(tool: string, raw: unknown): NotionArgs | { problem: string } {
  const a = obj(raw);
  const bad = (problem: string) => ({ problem });
  switch (tool) {
    case "notion_page_text": {
      const pageId = id32(a.pageId);
      const maxChars = a.maxChars === undefined ? 6000 : Number(a.maxChars);
      if (!pageId) return bad("pageId must be a Notion page id");
      if (!Number.isInteger(maxChars) || maxChars < 100 || maxChars > 20000) return bad("maxChars must be 100 to 20000");
      return { tool, pageId, maxChars };
    }
    case "notion_row_on": {
      const databaseId = id32(a.databaseId);
      if (!databaseId) return bad("databaseId must be a Notion database id");
      if (typeof a.dateProp !== "string" || !a.dateProp || a.dateProp.length > 100) return bad("dateProp must be a property name");
      if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) return bad("date must be YYYY-MM-DD");
      return { tool, databaseId, dateProp: a.dateProp, date: a.date };
    }
    case "notion_create_page": {
      const parentId = id32(a.parentId);
      if (!parentId) return bad("parentId must be a Notion page id");
      if (typeof a.title !== "string" || !a.title.trim()) return bad("title is required");
      const children = blocks(a.children);
      if (typeof children === "string") return bad(children);
      return { tool, parentId, title: a.title.slice(0, 2000), children };
    }
    case "notion_create_row": {
      const databaseId = id32(a.databaseId);
      if (!databaseId) return bad("databaseId must be a Notion database id");
      const properties = props(a.properties);
      if (typeof properties === "string") return bad(properties);
      const children = blocks(a.children);
      if (typeof children === "string") return bad(children);
      return { tool, databaseId, properties, children };
    }
    case "notion_update_row": {
      const pageId = id32(a.pageId);
      if (!pageId) return bad("pageId must be a Notion page id");
      const properties = props(a.properties);
      if (typeof properties === "string") return bad(properties);
      return { tool, pageId, properties };
    }
    case "notion_archive_row": {
      const pageId = id32(a.pageId);
      if (!pageId) return bad("pageId must be a Notion page id");
      return { tool, pageId };
    }
    default:
      return bad(`${tool} isn't a Notion tool`);
  }
}

/** An internal integration secret as Notion issues them (ntn_… now, secret_… before 2024). Checked before it is ever sent. */
export const looksLikeNotionKey = (s: string) => /^(ntn_|secret_)[A-Za-z0-9]{20,120}$/.test(s);
