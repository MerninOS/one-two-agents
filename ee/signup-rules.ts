// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Invite-only sign-up (card 128 slice 3c), the pure parts: sign-up codes and the form. No database,
// so ee/check.ts tests them.
import { createHash, randomBytes } from "node:crypto";

/** Letters and digits that can't be misread (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_DAYS = 30;

/** A new code, XXXX-XXXX-XXXX (about 59 bits). Shown once; only its hash is kept. */
export function newCode(bytes: Buffer = randomBytes(12)): string {
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

/** A code as typed (any case, spaces or dashes) in its one form, or null. */
export function normalCode(typed: unknown): string | null {
  const s = String(typed ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[2-9A-HJKMNP-Z]{12}$/.test(s) ? s : null;
}

export const codeHash = (normal: string) => createHash("sha256").update(`operator-signup:${normal}`).digest("hex");

/** A slug for a new business from its name, with a random tail so two businesses never clash. */
export function slugFor(name: string, tail: string = randomBytes(3).toString("hex")): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/, "");
  return `${base.length >= 2 ? base : "business"}-${tail}`;
}

export interface SignupForm { code: string; business: string; ownerName: string; email: string }

/** The form, checked: the fields or what to fix. */
export function checkSignup(f: Record<string, unknown>): { ok: SignupForm } | { problem: string } {
  const code = normalCode(f.code);
  const business = String(f.business ?? "").trim().replace(/\s+/g, " ");
  const ownerName = String(f.ownerName ?? "").trim().replace(/\s+/g, " ");
  const email = String(f.email ?? "").trim().toLowerCase();
  if (!code) return { problem: "Enter the sign-up code you were given (12 letters and numbers)." };
  if (!business || business.length > 120) return { problem: "Enter the business’s name (up to 120 characters)." };
  if (!ownerName || ownerName.length > 80) return { problem: "Enter your name (up to 80 characters)." };
  if (!/^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i.test(email) || email.length > 200) return { problem: "Enter your email address." };
  return { ok: { code, business, ownerName, email } };
}
