// Words that name the business a deployment is for. Shared code and the starting migrations may not
// contain them. The list itself never lives in the public repo (card 136): CI reads it from the
// BRAND_WORDS secret, and a checkout reads an untracked .brand.json (or, in the old private repo,
// private/brand.json). Each is {"words": ["regex", "(?i)regex", ...]} or, for the secret, the array.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const toRegex = (w) => (w.startsWith("(?i)") ? new RegExp(w.slice(4), "i") : new RegExp(w));

/** @returns {RegExp[]} */
export function brandWords(root = ".") {
  const fromEnv = process.env.BRAND_WORDS?.trim();
  if (fromEnv) {
    const parsed = JSON.parse(fromEnv);
    return (Array.isArray(parsed) ? parsed : parsed.words).map(toRegex);
  }
  for (const f of [join(root, ".brand.json"), join(root, "private", "brand.json")]) {
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).words.map(toRegex);
  }
  if (process.env.BRAND_REQUIRED === "1") throw new Error("BRAND_REQUIRED is set but there are no brand words (the BRAND_WORDS secret or .brand.json)");
  return [];
}
