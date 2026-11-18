// Avery's chat, the front door (docs/company-mode.md, slice 5). Pure: no database, no network, so
// `npm run check:chat` can test it.
//
// The owner talks to the agent in the company seat (Avery) from any screen. Each message is one logged run
// inside her budget. She reads the company's data with read tools, and can do only two things:
// save a rule the person dictates (in their own words, checked here against what they typed) and file a
// proposal (which does nothing until he says yes). She can't run, send, spend or change an agent.

export const MAX_MESSAGE = 1000;
export const MAX_REPLY = 3000;
/** Earlier messages the model sees with a new one. */
export const HISTORY_TURNS = 10;
/** Most rules and proposals one message may save. */
export const MAX_RULES = 3;
export const MAX_FILED = 3;

export interface ChatLine { role: "owner" | "avery"; text: string }

const norm = (s: string) => s.toLowerCase().replace(/[“”"‘’'`]/g, "").replace(/\s+/g, " ").replace(/[\s.!?,;:]+$/, "").trim();

/** Tidies what the owner typed: one paragraph break at most, no control characters, at most MAX_MESSAGE. */
export function cleanMessage(raw: unknown): { text: string } | { problem: string } {
  const text = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { problem: "Write something first." };
  if (text.length > MAX_MESSAGE) return { problem: `Keep it to ${MAX_MESSAGE} characters (this is ${text.length}).` };
  return { text };
}

/**
 * A rule is saved only in the owner's words: the words must appear in what they typed in this message
 * (ignoring case, quotes, spacing and the closing full stop). Avery picks which of his words, never
 * new ones.
 */
export function inOwnWords(words: string, message: string): boolean {
  const w = norm(words), m = norm(message);
  return w.length >= 3 && m.includes(w);
}

const EVERYONE = /^(everyone|everybody|every agent|all agents|the crew|the whole crew|all)$/i;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export interface ChatReach { agents: { id: string; name: string }[]; departments: { id: string; name: string }[] }
export type RuleWho = { scope: "agent"; agentId: string; name: string } | { scope: "department"; deptId: string; name: string } | { scope: "crew" };

/** Who a dictated rule is for: an agent by name, a department by name ("Sales" or "all of Sales"), or everyone. */
export function resolveRuleWho(who: string, reach: ChatReach): RuleWho | { problem: string } {
  const w = who.trim().replace(/^all of\s+/i, "").replace(/^(the )?(.+?)( department| team)?$/i, "$2");
  if (EVERYONE.test(who.trim()) || EVERYONE.test(w)) return { scope: "crew" };
  const a = reach.agents.find((x) => same(x.name, w) || same(x.id, w));
  if (a) return { scope: "agent", agentId: a.id, name: a.name };
  const d = reach.departments.find((x) => same(x.name, w) || same(x.id, w));
  if (d) return { scope: "department", deptId: d.id, name: d.name };
  return { problem: `${who} isn't an agent, a department or everyone` };
}

/** The department a proposal from the chat is for, by name. Null when none was named. */
export function deptNamed(name: string | undefined, departments: { id: string; name: string }[]): { id: string | null } | { problem: string } {
  if (!name?.trim()) return { id: null };
  const d = departments.find((x) => same(x.name, name.replace(/^the\s+/i, "").replace(/\s+department$/i, "")) || same(x.id, name));
  return d ? { id: d.id } : { problem: `${name} isn't a department on the chart` };
}

/**
 * The message the model gets: the earlier conversation (oldest first, at most HISTORY_TURNS lines)
 * and the owner's new message. Her earlier replies are her own words, shown as such.
 */
export function chatPrompt(history: ChatLine[], message: string, today: string): string {
  const earlier = history.slice(-HISTORY_TURNS).map((l) => `${l.role === "owner" ? "Them" : "You"}: ${l.text.replace(/\s+/g, " ").slice(0, 600)}`).join("\n");
  return [
    `Today is ${today} (Central time). A person from the business is talking to you in the Control Room chat.`,
    earlier ? `Earlier in this conversation:\n${earlier}` : "",
    `Their new message:\n${message}`,
    "Read what you need with your tools, then call finish with your reply to them.",
  ].filter(Boolean).join("\n\n");
}

/** What code adds under her reply, from what it actually saved after the run. */
export function savedLines(reports: { tool: string; ok: boolean; note: string }[]): string[] {
  return reports.filter((r) => r.note && r.note !== "nothing to save" && r.note !== "no proposals")
    .flatMap((r) => r.note.split(" | ").map((n) => n.trim()).filter(Boolean));
}
