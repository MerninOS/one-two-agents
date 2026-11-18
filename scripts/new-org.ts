// Makes a new org with its first owner, empty or from a template pack's crew (core/install.ts).
// Run: npm run org:new -- --slug acme --name "Acme Coffee" --owner owner@acme.example [--pack <id>]
import { newOrg, crewPacks } from "../core/install";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const slug = arg("slug"), name = arg("name"), owner = arg("owner"), pack = arg("pack") ?? null;
if (!slug || !name || !owner) {
  console.error(`Usage: npm run org:new -- --slug <slug> --name "<name>" --owner <email> [--pack <${crewPacks().map((p) => p.id).join("|")}>]`);
  process.exit(1);
}
newOrg({ slug, name, ownerEmail: owner, packId: pack }).then(({ orgId, counts }) => {
  console.log(`Made ${slug} (${orgId}).${Object.keys(counts).length ? ` Installed ${Object.entries(counts).map(([t, c]) => `${c} ${t}`).join(", ")}, all switched off.` : " It starts empty."}`);
}, (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
