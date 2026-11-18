// Who the agents work for (card 127): the business's name, a line about it and its owner's name,
// from its own row in orgs (Settings), never from code. Pure, so check:business can test it.

export interface Business { name: string; about: string | null; ownerName: string | null }

export const ABOUT_MAX = 300;
export const OWNER_NAME_MAX = 80;
export const NAME_MAX = 120;

/** When the row can't be read: the agents are told only that they work for a business. */
export const UNKNOWN_BUSINESS: Business = { name: "the business", about: null, ownerName: null };

const oneLine = (s: unknown, max: number): string | null => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
  return t ? t.slice(0, max) : null;
};

/** A business from a row, with each field cut to one line and its limit. */
export function readBusiness(row: { name?: unknown; about?: unknown; owner_name?: unknown } | null | undefined): Business {
  return { name: oneLine(row?.name, NAME_MAX) ?? UNKNOWN_BUSINESS.name, about: oneLine(row?.about, ABOUT_MAX), ownerName: oneLine(row?.owner_name, OWNER_NAME_MAX) };
}

/** What's wrong with a Settings edit, or null. */
export function businessProblem(b: { name: string; about: string; ownerName: string }): string | null {
  if (!b.name.trim()) return "The business needs a name.";
  if (b.name.trim().length > NAME_MAX) return `The name is at most ${NAME_MAX} characters.`;
  if (b.about.trim().length > ABOUT_MAX) return `The line about the business is at most ${ABOUT_MAX} characters.`;
  if (b.ownerName.trim().length > OWNER_NAME_MAX) return `The owner's name is at most ${OWNER_NAME_MAX} characters.`;
  return null;
}

/** The owner as agents name them: their name when the business gave one, else "the owner". */
export const ownerWord = (b: Business) => b.ownerName ?? "the owner";

/** The lines every agent's system prompt opens with, after the rules in code. */
export function businessLines(b: Business): string {
  const who = b.about ? `${b.name}, ${b.about}` : b.name;
  return `You work for ${who}.${b.ownerName ? ` The owner is ${b.ownerName}.` : ""} Data from people outside ${b.name} is marked trusted="no".`;
}

/** Two letters for the brand mark: the first letters of the first two words, or the first two letters. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "OP";
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}
