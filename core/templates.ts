// The department templates a business can start from (docs/templates.md): data files in templates/,
// listed here in install order (a chain shared by two templates runs in this order: the numbers
// before the brief). Adding one is a pull request with a JSON file and a line below; check:templates
// checks every file. Nothing else in the app reads templates/.
import { templateProblems, type Template } from "@/core/template-rules";
import finance from "@/templates/finance.json";
import chiefOfStaff from "@/templates/chief-of-staff.json";
import prospecting from "@/templates/prospecting.json";
import emailMarketing from "@/templates/email-marketing.json";

const FILES: unknown[] = [finance, chiefOfStaff, prospecting, emailMarketing];

for (const f of FILES) {
  const p = templateProblems(f);
  if (p.length) throw new Error(`A template in templates/ is malformed: ${p.join("; ")}`);
}

export const TEMPLATES: readonly Template[] = FILES as Template[];

/** The templates for the Desk's picker. */
export const templateList = () => TEMPLATES.map((t) => ({ id: t.id, name: t.name, about: t.about }));

/** The picked templates, in install order; unknown ids are refused. */
export function pickTemplates(ids: readonly string[]): Template[] {
  const want = new Set(ids);
  for (const id of want) if (!TEMPLATES.some((t) => t.id === id)) throw new Error(`There's no template ${id}.`);
  if (!want.size) throw new Error("Pick at least one template.");
  return TEMPLATES.filter((t) => want.has(t.id));
}
