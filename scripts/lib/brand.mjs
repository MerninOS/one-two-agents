// Words that name the business this repo is deployed for (private/brand.json). Shared code and the
// starting migration may not contain them. The public repo has no private/ folder, so none.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** @returns {RegExp[]} */
export function brandWords(root = ".") {
  const f = join(root, "private", "brand.json");
  if (!existsSync(f)) return [];
  return JSON.parse(readFileSync(f, "utf8")).words.map((w) => (w.startsWith("(?i)") ? new RegExp(w.slice(4), "i") : new RegExp(w)));
}
