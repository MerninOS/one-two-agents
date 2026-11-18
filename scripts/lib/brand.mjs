// Words that name a business, from each template pack's brand.json (templates/<pack>/brand.json).
// Shared code and the starting migration may not contain them. A repo with no packs has none.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** @returns {RegExp[]} */
export function brandWords(root = ".") {
  const dir = join(root, "templates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => join(dir, d, "brand.json"))
    .filter((f) => existsSync(f) && statSync(f).isFile())
    .flatMap((f) => JSON.parse(readFileSync(f, "utf8")).words)
    .map((w) => (w.startsWith("(?i)") ? new RegExp(w.slice(4), "i") : new RegExp(w)));
}
