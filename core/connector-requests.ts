import "server-only";
// Connector requests (docs/custom-servers.md, slice 3). The owner asks for a built-in connector on
// Find a tool, and adding a server by address counts as an ask for that service too. One row per
// service, counted, with one Build Board card made on the first ask; later asks raise the count in
// the card's title. The card is best effort: a missing setting or a Notion error never stops the
// ask, it comes back as words. Closing a request moves its card to Done.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { h2, li, notionConnected, notionPageId, notionRow, notionUpdateRow, prop } from "@/integrations/notion";
import { REQUEST_CARD, checkServiceName, checkWhat, knownServer, requestCard, requestCardName, withAsk, type Ask } from "@/core/connector-rules";

export interface ConnectorRequest {
  id: string; service_key: string; name: string; asks: number; notes: Ask[]; board_url: string | null;
  state: "open" | "closed"; outcome: string | null; created_at: string; last_asked_at: string; closed_at: string | null;
}

export const REQUESTS_MISSING = "The connector_requests table isn’t in Supabase yet: apply the migration 20261201090000_connector_requests.sql.";
const COLS = "id, service_key, name, asks, notes, board_url, state, outcome, created_at, last_asked_at, closed_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const today = () => new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", month: "long", day: "numeric", year: "numeric" });
const words = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Open requests first, most asked first; then the closed ones. Null when the table isn't there. */
export async function listRequests(): Promise<ConnectorRequest[] | null> {
  const { data, error } = await db().from("connector_requests").select(COLS).order("asks", { ascending: false }).order("last_asked_at", { ascending: false }).limit(100);
  if (error) return null;
  const all = (data ?? []) as ConnectorRequest[];
  return [...all.filter((r) => r.state === "open"), ...all.filter((r) => r.state === "closed")];
}

async function byKey(key: string): Promise<ConnectorRequest | null> {
  const { data, error } = await db().from("connector_requests").select(COLS).eq("service_key", key).maybeSingle();
  if (error) throw new Error(/connector_requests/.test(error.message) ? REQUESTS_MISSING : error.message);
  return (data as ConnectorRequest | null) ?? null;
}

/** Makes the service's Build Board card, or says why not. */
async function newCard(name: string, ask: Ask): Promise<{ url: string } | { problem: string }> {
  if (!env.notionBuildBoardDb) return { problem: "NOTION_BUILD_BOARD_DB_ID isn't set in Vercel." };
  if (!(await notionConnected())) return { problem: "Notion isn't connected: paste its key on Connections." };
  try {
    const c = requestCard({ name, ask, date: today(), link: env.dashboardUrl ? `${env.dashboardUrl}/connections/find` : null, known: knownServer(name) });
    const row = await notionRow(env.notionBuildBoardDb, {
      Name: prop.title(c.name), Status: prop.status(REQUEST_CARD.status), Owner: prop.select(REQUEST_CARD.owner), Track: prop.select(REQUEST_CARD.track),
    }, c.sections.flatMap((s) => [h2(s.heading), ...s.lines.map(li)]));
    return { url: row.url };
  } catch (e) { return { problem: words(e) }; }
}

/**
 * One ask for a service: a new request with its card, or one more on the request already there (a
 * closed one opens again). The words are the owner's own, checked in code. Returns what happened.
 */
export async function askFor(input: { name: string; what: string; by: string; proposalId?: string | null }): Promise<string> {
  const n = checkServiceName(input.name);
  if ("problem" in n) throw new Error(n.problem);
  const w = checkWhat(input.what);
  if ("problem" in w) throw new Error(w.problem);
  const ask: Ask = { by: input.by.slice(0, 60), what: w.what, at: new Date().toISOString(), proposal: input.proposalId && UUID.test(input.proposalId) ? input.proposalId : null };
  const now = ask.at;
  const had = await byKey(n.key);
  if (!had) {
    const card = await newCard(n.name, ask);
    const { error } = await db().from("connector_requests").insert({ service_key: n.key, name: n.name, notes: [ask], board_url: "url" in card ? card.url : null, last_asked_at: now });
    if (error) {
      // someone asked for the same service at the same moment: count this one on theirs
      if (/duplicate|unique/i.test(error.message)) return askFor(input);
      throw new Error(error.message);
    }
    return "url" in card ? `Asked for ${n.name}, with a card on the Build Board.` : `Asked for ${n.name}. No Build Board card: ${card.problem}`;
  }
  const asks = had.asks + 1;
  const { data, error } = await db().from("connector_requests")
    .update({ asks, notes: withAsk(had.notes ?? [], ask), last_asked_at: now, state: "open", outcome: null, closed_at: null })
    .eq("id", had.id).eq("asks", had.asks).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) return askFor(input); // counted by someone else first; read it again
  let card = "";
  const page = notionPageId(had.board_url ?? "");
  if (page && (await notionConnected())) {
    await notionUpdateRow(page, { Name: prop.title(requestCardName(had.name, asks)), ...(had.state === "closed" ? { Status: prop.status(REQUEST_CARD.status) } : {}) })
      .catch(() => { card = " (Its Build Board card couldn’t be updated.)"; });
  }
  return `${had.name} has been asked for ${asks} times now.${had.state === "closed" ? " The request is open again." : ""}${card}`;
}

/** The owner closes a request: a built-in connector is ready, or it isn't wanted. Its card moves to Done. */
export async function closeRequest(id: string, why: "ready" | "not_needed"): Promise<string> {
  if (!UUID.test(id)) throw new Error("Unknown request.");
  const outcome = why === "ready" ? "A built-in connector is ready." : "Closed, not needed.";
  const { data, error } = await db().from("connector_requests").update({ state: "closed", outcome, closed_at: new Date().toISOString() }).eq("id", id).eq("state", "open").select("board_url, name");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That request isn’t open any more.");
  const page = notionPageId(data[0].board_url ?? "");
  if (page && (await notionConnected())) {
    const moved = await notionUpdateRow(page, { Status: prop.status("Done") }).then(() => true, () => false);
    if (!moved) return `${data[0].name}: ${outcome} Move its Build Board card to Done by hand.`;
  }
  return `${data[0].name}: ${outcome}`;
}
