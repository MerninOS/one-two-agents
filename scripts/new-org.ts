// Makes a new org with its first owner, empty or from picked department templates (core/install.ts).
// Run: npm run org:new -- --slug acme --name "Acme" --owner owner@acme.example [--templates finance,prospecting]
import { newOrg } from "../core/install";
import { templateList } from "../core/templates";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const slug = arg("slug"), name = arg("name"), owner = arg("owner");
const templates = (arg("templates") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!slug || !name || !owner) {
  console.error(`Usage: npm run org:new -- --slug <slug> --name "<name>" --owner <email> [--templates <${templateList().map((t) => t.id).join(",")}>]`);
  process.exit(1);
}
newOrg({ slug, name, ownerEmail: owner, templates }).then(({ orgId, counts }) => {
  console.log(`Made ${slug} (${orgId}).${Object.keys(counts).length ? ` Installed ${Object.entries(counts).map(([t, c]) => `${c} ${t}`).join(", ")}, all switched off.` : " It starts empty."}`);
}, (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
