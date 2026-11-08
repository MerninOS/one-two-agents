import "server-only";
// Notion pages for agent output (briefs, lead lists), via the REST API with an
// internal integration shared with the parent page.
import { env } from "@/core/env";

export type Block = Record<string, unknown>;
export const rt = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];
export const h2 = (t: string): Block => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(t) } });
export const h3 = (t: string): Block => ({ object: "block", type: "heading_3", heading_3: { rich_text: rt(t) } });
export const li = (t: string): Block => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(t) } });
export const p = (t: string): Block => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(t) } });
export const quote = (t: string): Block => ({ object: "block", type: "quote", quote: { rich_text: rt(t) } });
export const divider = (): Block => ({ object: "block", type: "divider", divider: {} });

/** Creates a page under NOTION_BRIEF_PARENT_ID and returns its URL. Notion takes at most 100 blocks per request. */
export async function notionPage(title: string, children: Block[]) {
  if (!env.notionToken || !env.notionBriefParent) throw new Error("NOTION_TOKEN and NOTION_BRIEF_PARENT_ID must be set");
  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.notionToken}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
    body: JSON.stringify({ parent: { page_id: env.notionBriefParent }, properties: { title: { title: rt(title) } }, children: children.slice(0, 100) }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text().catch(() => "")}`);
  return (await res.json() as { url: string }).url;
}
