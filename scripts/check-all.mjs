// `npm run check:all`: every check:* script in package.json, one after another; stops at the first failure.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const scripts = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).scripts).filter((s) => s.startsWith("check:") && s !== "check:all");
for (const s of scripts) execSync(`npm run -s ${s}`, { stdio: "inherit" });
console.log(`check:all ok (${scripts.length} checks)`);
