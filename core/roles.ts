// People and roles (docs/tenancy.md, slice 2). Pure: no database, no env, so `npm run check:roles`
// can test it. A member's role decides what they may do; the server checks it on every page and action.

export const ROLES = ["viewer", "approver", "owner"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = { viewer: "Viewer", approver: "Approver", owner: "Owner" };
export const ROLE_WORDS: Record<Role, string> = {
  viewer: "Sees every page. Changes nothing.",
  approver: "Approves and rejects cards, teaches agents, runs dry runs, and can stop anything.",
  owner: "Everything: real runs, schedules, caps, vendors, the builder, Connections, the org chart and People.",
};

/** A signed-in person, as every page and action sees them. */
export interface Member { id: string; email: string; role: Role }

export const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

/** True when `role` may do what needs `min`. */
export const atLeast = (role: Role, min: Role) => ROLES.indexOf(role) >= ROLES.indexOf(min);

/** What a member sees when their role can't do something. */
export const refusal = (role: Role, min: Role) =>
  `${min === "approver" ? "Approvers and owners" : "Owners"} only: you’re signed in as ${role === "approver" ? "an approver" : `a ${role}`}. Ask an owner.`;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A sign-in address, lowercased and trimmed; null when it isn't one. */
export function normalEmail(raw: unknown): string | null {
  const e = String(raw ?? "").trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/**
 * Why a change to the member list can't be made, or null. An org always keeps at least one owner,
 * so the last owner can't be removed or made something else.
 */
export function memberChangeProblem(members: Pick<Member, "id" | "role">[], id: string, next: Role | "removed"): string | null {
  const m = members.find((x) => x.id === id);
  if (!m) return "That person isn’t a member.";
  if (m.role === "owner" && next !== "owner" && members.filter((x) => x.role === "owner").length <= 1) {
    return next === "removed" ? "That’s the last owner. Add another owner first." : "That’s the last owner. Make someone else an owner first.";
  }
  return null;
}

/** A page to open after sign-in: a path on this site only, never another host. */
export function safeNext(next: unknown): string {
  const n = String(next ?? "");
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") && !n.startsWith("/login") && !n.startsWith("/auth/") ? n : "/";
}
