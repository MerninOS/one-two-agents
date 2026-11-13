"use client";
// The agent builder screen (docs/agent-builder.md, slice 2): an agent's eight parts (Trigger,
// Sources, Standards, Directive, Thinking, Actions, Guardrails, Output) as one draft, with a free
// tool check, a Preview explore run of the draft, and Save as the next version. Everything here
// picks from lists that come from code; the server checks the draft again before it runs or saves.
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AgentSpec } from "@/core/agent-spec";
import type { BuilderMenu, PlaybookView, Standard } from "@/dashboard/builder";
import type { ActionResult } from "../actions";
import { Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";

type Act<T extends unknown[] = []> = (...a: T) => Promise<ActionResult>;

const KIND: Record<string, string> = { read: "Read", calculate: "Calculate", report: "Report", action: "Action" };
const kindStyle = (k: string) => (k === "calculate" ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : k === "action" ? { background: "var(--red-soft)", color: "var(--red-ink)" } : { background: "var(--mint-soft)", color: "var(--mint-ink)" });
const GROUP_ORDER = ["shopify", "calculate", "mercury", "supabase", "agents", "notion", "email", "web", "gmail"];
const GROUP_LABEL: Record<string, string> = { shopify: "Shopify", calculate: "Calculate (plain code, no model)", mercury: "Mercury", supabase: "Control Room data", agents: "Other agents’ outputs", notion: "Notion", email: "Email to Zak", web: "Web", gmail: "Gmail" };
const notionId = (link: string) => (link.replace(/-/g, "").match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase();

type MenuTool = BuilderMenu["tools"][number];
function ToolRow({ t, on, toggle, blocked }: { t: MenuTool; on: boolean; toggle: () => void; blocked?: string | null }) {
  return (
    <label className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14, cursor: blocked ? "not-allowed" : "pointer", opacity: blocked ? 0.6 : 1 }}>
      <input type="checkbox" checked={on} disabled={!!blocked && !on} onChange={toggle} style={{ width: 18, height: 18 }} />
      <span style={{ flex: "1 1 220px", minWidth: 0 }}>{t.label}<span className="muted" style={{ display: "block", fontSize: 12 }}>{blocked ?? t.detail}</span></span>
      <span className="pill sm" style={kindStyle(t.kind)}>{KIND[t.kind]}</span>
      {!t.trusted && <span className="pill sm" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }} title="Written by people outside One Two. It reaches the model as data, never instructions.">Untrusted</span>}
      <span className="muted" style={{ fontSize: 12, minWidth: 80, textAlign: "right" }}>{t.connected ? "Connected" : "Missing key"}</span>
    </label>
  );
}
const OUT_TOKENS: Record<string, number> = { low: 500, medium: 900, high: 1500 };
const money = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

function Section({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ gap: 14 }}>
      <div className="row wrap" style={{ gap: 12 }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--ink)", color: "var(--ws)", fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{n}</span>
        <span className="card-t" style={{ fontSize: 17 }}>{title}</span>
        <span className="sub" style={{ flex: "1 1 240px" }}>{sub}</span>
      </div>
      {children}
    </section>
  );
}

function useAct() {
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r); router.refresh();
  });
  return { toast, setToast, busy, run };
}

/** A rough guide to what one explore run costs: a turn per tool call plus a wrap-up, each turn re-reading what came before. */
function estimate(spec: AgentSpec, menu: BuilderMenu) {
  const m = menu.models.find((x) => x.id === spec.model);
  if (!m) return null;
  const turns = Math.min(spec.limits.maxSteps, Math.max(1, spec.tools.length)) + 1;
  let usd = 0;
  for (let i = 0; i < turns; i++) usd += (2500 + 1200 * i) * m.in + OUT_TOKENS[spec.effort] * m.out;
  return Math.min(usd, spec.limits.maxCostUsd);
}

export interface BuilderProps {
  agentId: string;
  saved: AgentSpec | null;
  savedVersion: number | null;
  nextVersion: number;
  menu: BuilderMenu;
  standards: Standard[];
  /** Other agents built in the app, which this one may read from. */
  others: { id: string; name: string; outputName: string; hasOutput: boolean }[];
  lastOutput: { name: string; summary: string; numbers: { label: string; value: number; tool: string }[]; at: string; finished: boolean } | null;
  controls: boolean;
  dryRun: Act<[unknown]>;
  preview: Act<[unknown, boolean, boolean]>;
  /** The approved playbook a Preview follows, if any, and whether the agent is on hold. */
  playbook: { version: number; steps: number } | null;
  pendingPlaybook: number | null;
  /** Morgan and Avery: whether runs use their own code or the runner. */
  engine?: { onRunner: boolean } | null;
  save: Act<[unknown, string, boolean]>;
  addStandard: Act<[string, string]>;
  forget: Act<[string]>;
  budget: React.ReactNode;
}

export function Builder(p: BuilderProps) {
  const start: AgentSpec = p.saved ?? { name: "Untitled agent", mandate: "", directive: "", goodResult: "", model: p.menu.models[p.menu.models.length - 1]?.id ?? "", effort: "low", tools: [], notionPages: [], limits: { maxSteps: p.menu.limits.maxSteps.default, maxCostUsd: p.menu.limits.maxCostUsd.default }, outputName: "result", readsFrom: [], reportPage: null };
  const [d, setD] = useState<AgentSpec>(start);
  const change = (x: Partial<AgentSpec>) => setD((cur) => ({ ...cur, ...x }));
  const dirty = JSON.stringify(d) !== JSON.stringify(start);
  const { toast, setToast, busy, run } = useAct();
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const [check, setCheck] = useState<ActionResult | null>(null);
  const [newStd, setNewStd] = useState(""), [stdLink, setStdLink] = useState("");
  const [pageLink, setPageLink] = useState(""), [pageLabel, setPageLabel] = useState("");
  const [repLink, setRepLink] = useState(""), [repLabel, setRepLabel] = useState("");
  const [deliver, setDeliver] = useState(false);

  const grantable = p.menu.tools.filter((t) => t.grantable);
  const sources = grantable.filter((t) => t.kind === "read" || t.kind === "calculate");
  const actionTools = grantable.filter((t) => t.kind === "action");
  const reportTools = grantable.filter((t) => t.kind === "report");
  const blockedFor = (t: MenuTool) => (t.agents && !t.agents.includes(p.agentId) ? `The gateway lets only ${t.agents.map((a) => p.menu.agentNames[a] ?? a).join(" and ")} propose this (hard rule). It arrives for them when they move to the runner.` : null);
  const groups = GROUP_ORDER.map((g) => ({ g, tools: sources.filter((t) => t.group === g) })).filter((x) => x.tools.length);
  const delivers = d.tools.some((id) => grantable.find((t) => t.id === id && (t.kind === "report" || t.kind === "action")));
  const toggle = (id: string) => change({ tools: d.tools.includes(id) ? d.tools.filter((x) => x !== id) : [...d.tools, id] });
  const est = useMemo(() => estimate(d, p.menu), [d, p.menu]);
  const model = p.menu.models.find((m) => m.id === d.model);
  const L = p.menu.limits;
  const stepsOk = Number.isInteger(d.limits.maxSteps) && d.limits.maxSteps >= L.maxSteps.min && d.limits.maxSteps <= L.maxSteps.max;
  const costOk = Number.isFinite(d.limits.maxCostUsd) && d.limits.maxCostUsd >= L.maxCostUsd.min && d.limits.maxCostUsd <= L.maxCostUsd.max;
  const notionMissing = d.tools.includes("notion_read_page") && !d.notionPages.length;
  const readsMissing = d.tools.includes("agent_output") && !d.readsFrom.length;
  const toggleSource = (a: { id: string; name: string; outputName: string }) => change({ readsFrom: d.readsFrom.some((x) => x.agentId === a.id) ? d.readsFrom.filter((x) => x.agentId !== a.id) : [...d.readsFrom, { agentId: a.id, label: `${a.name}: ${a.outputName}` }].slice(0, 10) });
  const reportPageMissing = d.tools.includes("report_notion_page") && !d.reportPage;
  const problems = [reportPageMissing && "pick the Notion page to write under, or untick Write a Notion page", !d.directive.trim() && "the directive is empty", !stepsOk && `steps per run must be from ${L.maxSteps.min} to ${L.maxSteps.max}`, !costOk && `cost per run must be from $${L.maxCostUsd.min} to $${L.maxCostUsd.max}`, notionMissing && "list at least one Notion page, or untick Read a Notion page", readsMissing && "pick at least one agent to read from, or untick Read another agent's output"].filter(Boolean) as string[];
  const looser = p.saved ? [
    ...d.tools.filter((id) => !p.saved!.tools.includes(id)).map((id) => grantable.find((t) => t.id === id)).filter((t) => t && (t.kind === "report" || t.kind === "action")).map((t) => `adds ${t!.kind === "action" ? "the action" : "the report"} “${t!.label}”`),
    d.tools.includes("report_notion_page") && p.saved.tools.includes("report_notion_page") && d.reportPage?.id !== p.saved.reportPage?.id && `writes to a different Notion page (${d.reportPage?.label ?? "none"})`,
    d.limits.maxCostUsd > p.saved.limits.maxCostUsd && `cost per run goes from $${p.saved.limits.maxCostUsd.toFixed(2)} to $${d.limits.maxCostUsd.toFixed(2)}`,
    d.limits.maxSteps > p.saved.limits.maxSteps && `steps per run go from ${p.saved.limits.maxSteps} to ${d.limits.maxSteps}`,
  ].filter(Boolean) as string[] : [];

  const addPage = () => {
    const id = notionId(pageLink);
    if (!id) { setToast({ ok: false, text: "That doesn’t look like a Notion page link. In Notion use Share, then Copy link." }); return; }
    if (d.notionPages.some((x) => x.id === id)) return;
    change({ notionPages: [...d.notionPages, { id, label: pageLabel.trim() || "Notion page" }].slice(0, 10) });
    setPageLink(""); setPageLabel("");
  };
  const setReportPage = () => {
    const id = notionId(repLink);
    if (!id) { setToast({ ok: false, text: "That doesn’t look like a Notion page link. In Notion use Share, then Copy link." }); return; }
    change({ reportPage: { id, label: repLabel.trim() || "Notion page" } });
    setRepLink(""); setRepLabel("");
  };
  const doSave = (confirmed: boolean) => run(() => p.save(d, note, confirmed), (r) => { if (r.ok) setNote(""); });
  const onSave = () => {
    if (looser.length && !p.controls) { setToast({ ok: false, text: `Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this: ${looser.join("; ")}.` }); return; }
    if (looser.length) setConfirm({ c: { title: `Save as v${p.nextVersion}?`, body: "This version lets a run spend more than the active one.", lines: looser.map((x) => ({ k: "Change", v: x })), confirmLabel: `Save v${p.nextVersion}`, kind: "dark" }, go: () => doSave(true) });
    else doSave(false);
  };
  const deliverLine = deliver && delivers ? "If it finishes, its reports go out and its proposals become approval cards for you." : "Nothing is written or sent.";
  const onPreview = (explore: boolean) => setConfirm({
    c: {
      title: explore ? "Re-explore?" : "Run a preview?",
      body: !explore && p.playbook
        ? `Follows playbook v${p.playbook.version}: code makes its ${p.playbook.steps} tool calls on live data, then ${model?.label ?? d.model} writes the result. If a step fails it explores instead. Up to $${d.limits.maxCostUsd.toFixed(2)}. ${deliverLine} It counts against today’s budget.`
        : `A real explore run of this ${dirty ? "unsaved draft" : "version"} on ${model?.label ?? d.model}: the model picks its own tool calls, up to ${d.limits.maxSteps} and $${d.limits.maxCostUsd.toFixed(2)}. ${deliverLine} It counts against today’s budget. Afterwards code drafts a playbook from the calls that worked.`,
      confirmLabel: explore ? "Re-explore" : "Run preview", kind: "dark",
    },
    go: () => run(() => p.preview(d, explore, deliver && delivers)),
  });

  return (
    <div className="builder">
      <div className="stack" style={{ gap: 16, minWidth: 0 }}>
        <div className="card" style={{ gap: 14 }}>
          <div className="ted-grid">
            <label className="ted-field"><span className="ted-k">Name</span><input className="input" value={d.name} maxLength={80} onChange={(e) => change({ name: e.target.value })} /></label>
            <label className="ted-field"><span className="ted-k">One line on its job</span><input className="input" value={d.mandate} maxLength={200} onChange={(e) => change({ mandate: e.target.value })} placeholder="Shows on the agent list" /></label>
          </div>
        </div>

        <Section n={1} title="Trigger" sub="When it runs">
          {[
            { k: "hand", label: "By hand", detail: "Preview from this screen. Each run is an explore run: the model picks its own steps.", on: true },
            { k: "after", label: "After another agent’s run", detail: "Joins the Crew canvas once its first playbook is approved." },
            { k: "schedule", label: "On a schedule", detail: "Weekdays at a time you pick, once its first playbook is approved." },
          ].map((t) => (
            <label key={t.k} className="soft-box" style={{ alignItems: "flex-start", opacity: t.on ? 1 : 0.55 }}>
              <input type="radio" checked={!!t.on} disabled={!t.on} readOnly style={{ marginTop: 3 }} />
              <span className="stack" style={{ gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</span><span className="sub">{t.detail}</span></span>
            </label>
          ))}
          {p.engine && <span className="sub">{p.engine.onRunner ? "Switched to the runner: its crew chains and schedule now run this spec, following the approved playbook." : "Its crew chains and schedule still run its own code. Use Compare and Switch below the builder to move it to this spec."}</span>}
          <span className="sub">{p.playbook ? `Playbook v${p.playbook.version} is approved. Running after another agent or on a schedule comes when the four agents move to the runner; until then it runs when you press Preview.` : "Explore runs are by hand only. An agent can run on its own only after you approve its first playbook, and it starts off duty even then."}</span>
        </Section>

        <Section n={2} title="Sources" sub="What it may read. Only ticked tools are handed to the model.">
          {groups.map(({ g, tools }) => (
            <div key={g} className="stack" style={{ gap: 0 }}>
              <span className="ted-k" style={{ paddingBottom: 4 }}>{GROUP_LABEL[g] ?? g}</span>
              {tools.map((t) => <ToolRow key={t.id} t={t} on={d.tools.includes(t.id)} toggle={() => toggle(t.id)} />)}
            </div>
          ))}
          {d.tools.includes("notion_read_page") && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="ted-k">Notion pages it may open</span>
              {d.notionPages.map((pg) => (
                <div key={pg.id} className="row wrap" style={{ gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{pg.label} <span className="muted" style={{ fontSize: 12 }}>{pg.id.slice(0, 8)}…</span></span>
                  <button type="button" className="btn ghost xs" onClick={() => change({ notionPages: d.notionPages.filter((x) => x.id !== pg.id) })}>Remove</button>
                </div>
              ))}
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="input" style={{ flex: "2 1 220px" }} placeholder="Notion page link" value={pageLink} onChange={(e) => setPageLink(e.target.value)} />
                <input className="input" style={{ flex: "1 1 140px" }} placeholder="Short name" value={pageLabel} maxLength={80} onChange={(e) => setPageLabel(e.target.value)} />
                <button type="button" className="btn outline sm" onClick={addPage}>Add page</button>
              </div>
              <span className="sub">It can open only these pages, picked by id, never a link it finds. Share each page with the agents’ Notion integration in Notion.</span>
            </div>
          )}
          {d.tools.includes("agent_output") && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="ted-k">Agents it may read from</span>
              {p.others.length === 0 && <span className="sub">No other agents built here yet.</span>}
              {p.others.map((a) => (
                <label key={a.id} className="row wrap" style={{ gap: 10, fontSize: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={d.readsFrom.some((x) => x.agentId === a.id)} onChange={() => toggleSource(a)} style={{ width: 18, height: 18 }} />
                  <span style={{ flex: 1 }}>{a.name}: {a.outputName}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{a.hasOutput ? "Has an output" : "No output yet"}</span>
                </label>
              ))}
              <span className="sub">It reads the latest finished output. The words arrive as another agent’s, never as instructions; the numbers keep their trail back to the tool that computed them.</span>
            </div>
          )}
          <span className="sub">Need something not on the list, like Klaviyo or Instagram? New tools are a code change on purpose, so a web page or an email can never add one. Ask Claude and it shows up here for every agent.</span>
        </Section>

        <Section n={3} title="Standards" sub="Standing orders and crew rules it must uphold, loaded on every run">
          {p.standards.length === 0 && <span className="sub">None yet.</span>}
          {p.standards.map((s) => (
            <div key={s.id} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14 }}>
              <span className="tag">{s.grp === "crew" ? "CREW RULE" : "STANDING ORDER"}</span>
              <span style={{ flex: "1 1 260px", minWidth: 0, lineHeight: 1.5 }}>{s.text}{s.notionPageId && <span className="muted" style={{ fontSize: 12 }}> · reads a linked Notion page</span>}</span>
              {s.grp === "standing_order" && <button type="button" className="btn ghost xs" disabled={busy} onClick={() => run(() => p.forget(s.id))}>Forget</button>}
            </div>
          ))}
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" style={{ flex: "3 1 260px" }} placeholder="Add a standing order" maxLength={280} value={newStd} onChange={(e) => setNewStd(e.target.value)} />
            <input className="input" style={{ flex: "1 1 160px" }} placeholder="Notion link (optional)" value={stdLink} onChange={(e) => setStdLink(e.target.value)} />
            <button type="button" className="btn outline sm" disabled={busy || !newStd.trim()} onClick={() => run(() => p.addStandard(newStd, stdLink), (r) => { if (r.ok) { setNewStd(""); setStdLink(""); } })}>Add</button>
          </div>
          <span className="sub">Saved straight away in the same store as the Memory tab, not as part of a version. Crew rules apply to every agent and are edited there.</span>
        </Section>

        <Section n={4} title="Directive" sub="The job, in your words">
          <label className="ted-field">
            <span className="row wrap" style={{ justifyContent: "space-between", gap: 8 }}><span className="ted-k">What it should do</span><span className="sub">{d.directive.length} of 4,000</span></span>
            <textarea className="input ted-text" rows={7} maxLength={4000} value={d.directive} onChange={(e) => change({ directive: e.target.value })} />
          </label>
          <label className="ted-field">
            <span className="ted-k">What a good result looks like</span>
            <textarea className="input ted-text" rows={3} maxLength={1000} value={d.goodResult} onChange={(e) => change({ goodResult: e.target.value })} />
          </label>
          <div className="ted-field">
            <span className="ted-k"><Icon name="lock" size={12} /> Safety block · locked, always sent first</span>
            <span className="setup-long" style={{ marginTop: 0 }}>{p.menu.safety}</span>
          </div>
        </Section>

        <Section n={5} title="Thinking" sub="Which Claude model reasons, and how hard">
          <div className="ted-grid">
            <label className="ted-field">
              <span className="ted-k">Model</span>
              <select className="input" value={d.model} onChange={(e) => change({ model: e.target.value })}>
                {p.menu.models.map((m) => <option key={m.id} value={m.id}>{m.label} · ${+(m.in * 1e6).toFixed(2)} in, ${+(m.out * 1e6).toFixed(2)} out per million</option>)}
              </select>
              <span className="sub">Claude models only, straight to the Claude API.</span>
            </label>
            <div className="ted-field">
              <span className="ted-k">Effort</span>
              <div className="seg" role="radiogroup" aria-label="Effort">
                {p.menu.efforts.map((e) => <button key={e} type="button" role="radio" aria-checked={d.effort === e} className={d.effort === e ? "on" : ""} onClick={() => change({ effort: e })}>{e}</button>)}
              </div>
              <span className="sub">How hard Claude thinks before each step. More effort, more tokens.</span>
            </div>
          </div>
        </Section>

        <Section n={6} title="Actions" sub="What it may do. Anything that leaves One Two waits for your approval.">
          <div className="stack" style={{ gap: 0 }}>
            {actionTools.map((t) => <ToolRow key={t.id} t={t} on={d.tools.includes(t.id)} toggle={() => toggle(t.id)} blocked={blockedFor(t)} />)}
            {!actionTools.length && <span className="sub">No action tools on the list yet.</span>}
          </div>
          <span className="sub">An action is only ever a proposal. During a run the model stages it; after a run that finishes (with Deliver on, for a preview) code sends each one to the gateway, which checks its own allow-list and puts an approval card in Approvals. It names a charge or a category only as a row a tool returned in that run, so a merchant name or a web page can never choose one. Up to 10 a run. Rejecting one puts the agent’s next playbook back on your approval. Sending, paying and posting aren’t action types yet, so no agent can have them.</span>
        </Section>

        <Section n={7} title="Guardrails" sub="Hard stops, enforced in code whatever the model wants">
          <div className="ted-grid">
            <label className="ted-field">
              <span className="ted-k">Tool calls per run</span>
              <input className="input" type="number" min={L.maxSteps.min} max={L.maxSteps.max} step={1} value={d.limits.maxSteps} onChange={(e) => change({ limits: { ...d.limits, maxSteps: Number(e.target.value) } })} />
              <span className="sub" style={stepsOk ? undefined : { color: "var(--red-ink)" }}>Up to {L.maxSteps.max} (ceiling in code). After the last one it gets one turn to finish.</span>
            </label>
            <label className="ted-field">
              <span className="ted-k">Cost per run ($)</span>
              <input className="input" type="number" min={L.maxCostUsd.min} max={L.maxCostUsd.max} step={0.05} value={d.limits.maxCostUsd} onChange={(e) => change({ limits: { ...d.limits, maxCostUsd: Number(e.target.value) } })} />
              <span className="sub" style={costOk ? undefined : { color: "var(--red-ink)" }}>Up to ${L.maxCostUsd.max.toFixed(2)} (ceiling in code). It stops before a turn that could go over.</span>
            </label>
          </div>
          {p.budget}
          <div className="soft-box" style={{ alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.5 }}>
            <Icon name="lock" size={15} style={{ marginTop: 2, flex: "none" }} />
            <span>Locked for every agent: the crew hard rules on the Access page. No sending, paying or posting outside the approval queue; caps of $500 a purchase, $1,500 a month and 20 emails a day; a first email to a new person always waits for you. Lowering a limit takes effect right away; raising one needs a confirm and Controls on.</span>
          </div>
        </Section>

        <Section n={8} title="Output" sub="What each run leaves behind, for you and for other agents">
          <label className="ted-field">
            <span className="ted-k">Output name</span>
            <input className="input" value={d.outputName} maxLength={60} onChange={(e) => change({ outputName: e.target.value })} />
            <span className="sub">Other agents will see it as “{d.name}: {d.outputName || "result"}”.</span>
          </label>
          <div className="stack" style={{ gap: 0 }}>
            <span className="ted-k" style={{ paddingBottom: 4 }}>Reports: where the result goes after a run that finishes</span>
            {reportTools.map((t) => <ToolRow key={t.id} t={t} on={d.tools.includes(t.id)} toggle={() => toggle(t.id)} />)}
          </div>
          {d.tools.includes("report_notion_page") && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="ted-k">Notion page to write under</span>
              {d.reportPage ? (
                <div className="row wrap" style={{ gap: 8, fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{d.reportPage.label} <span className="muted" style={{ fontSize: 12 }}>{d.reportPage.id.slice(0, 8)}…</span></span>
                  <button type="button" className="btn ghost xs" onClick={() => change({ reportPage: null })}>Change</button>
                </div>
              ) : (
                <div className="row wrap" style={{ gap: 8 }}>
                  <input className="input" style={{ flex: "2 1 220px" }} placeholder="Notion page link" value={repLink} onChange={(e) => setRepLink(e.target.value)} />
                  <input className="input" style={{ flex: "1 1 140px" }} placeholder="Short name" value={repLabel} maxLength={80} onChange={(e) => setRepLabel(e.target.value)} />
                  <button type="button" className="btn outline sm" onClick={setReportPage}>Use page</button>
                </div>
              )}
              <span className="sub">Each finished run adds one page under it, titled with the agent, the output name and the date. Share the page with the agents’ Notion integration in Notion.</span>
            </div>
          )}
          <span className="sub">Reports carry only the finished result and its traced numbers, and reach only you or our own Notion. The model never calls them, so a run that stops early sends nothing.</span>
          <span className="sub">Each run saves its result in its own words plus the key numbers behind it. A number can only come from a tool result in the same run: the model names the step, code copies the value. A number it can’t trace is left out and counted in the summary.</span>
          {p.lastOutput ? (
            <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
              <span className="ted-k">Latest output · {p.lastOutput.at}{p.lastOutput.finished ? "" : " · stopped early, so other agents skip it"}</span>
              <span style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{p.lastOutput.summary}</span>
              {p.lastOutput.numbers.map((n, i) => <span key={i} style={{ fontSize: 13.5 }}>{n.label}: <b>{n.value}</b> <span className="muted" style={{ fontSize: 12 }}>from {n.tool}</span></span>)}
              {!p.lastOutput.numbers.length && <span className="sub">No numbers in this one.</span>}
            </div>
          ) : <span className="sub">No output yet. Press Preview to make one.</span>}
        </Section>
      </div>

      <aside className="builder-side">
        <div className="card" style={{ gap: 12 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className="card-t">{p.savedVersion ? `v${p.savedVersion} active` : "Not saved"}</span>
            {dirty && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }}>Draft changed</span>}
          </div>
          <div className="stack" style={{ gap: 4, fontSize: 14 }}>
            <span className="ted-k">Explore run estimate</span>
            <span>{est == null ? "?" : `About ${money(est)}`}, never more than ${d.limits.maxCostUsd.toFixed(2)}</span>
            <span className="sub">From {model?.label ?? "the model"} prices and {d.tools.length} ticked tool{d.tools.length === 1 ? "" : "s"}. Real runs below show the real cost.</span>
          </div>
          <div className="stack" style={{ gap: 4, fontSize: 14 }}>
            <span className="ted-k">Playbook</span>
            <span className="sub">{p.playbook ? `v${p.playbook.version} approved, ${p.playbook.steps} steps. Preview follows it.` : "None approved yet. Preview explores, then code drafts a playbook from the calls that worked."}{p.pendingPlaybook ? ` v${p.pendingPlaybook} waits for your approval below.` : ""}</span>
          </div>
          {problems.length > 0 && <div className="ted-warn">Fix first: {problems.join("; ")}.</div>}
          <button type="button" className="btn outline" disabled={busy || problems.length > 0} onClick={() => start2Check()}>
            <Icon name="play" size={15} />Tool check · free
          </button>
          {check && <span className="sub" style={{ color: check.ok ? undefined : "var(--red-ink)", lineHeight: 1.5 }}>{check.text}</span>}
          <button type="button" className="btn dark" disabled={busy || problems.length > 0 || !p.controls} title={p.controls ? undefined : "Needs DASHBOARD_CONTROLS=on"} onClick={() => onPreview(false)}>{busy ? "Working…" : p.playbook ? `Preview · follows v${p.playbook.version}` : "Preview · explore run"}</button>
          {p.playbook && <button type="button" className="btn outline" disabled={busy || problems.length > 0 || !p.controls} onClick={() => onPreview(true)}>Re-explore</button>}
          {delivers && (
            <label className="row" style={{ gap: 8, fontSize: 13.5, cursor: "pointer" }}>
              <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span>Deliver: send reports and queue proposals if the preview finishes</span>
            </label>
          )}
          {!p.controls && <span className="sub">Preview needs DASHBOARD_CONTROLS=on, since it spends money.</span>}
          <div className="rule" />
          <input className="input" placeholder="What changed? (for the version list)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn primary" disabled={busy || !dirty || problems.length > 0 || !note.trim()} onClick={onSave}>Save as v{p.nextVersion}</button>
          <span className="sub">Saving adds a version; it doesn’t put the agent on duty.</span>
        </div>
      </aside>
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );

  function start2Check() {
    setCheck({ ok: true, text: "Checking each ticked tool…" });
    run(() => p.dryRun(d), (r) => setCheck(r));
  }
}

/** New agent: a name, one line on its job, and what to start from. Saved as v1, off duty. */
export function NewAgentForm({ create, from }: { create: (name: string, mandate: string, from: string) => Promise<ActionResult & { id?: string }>; from: { id: string; name: string }[] }) {
  const [name, setName] = useState(""), [mandate, setMandate] = useState(""), [src, setSrc] = useState("blank");
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const go = () => start(async () => {
    const r = await create(name, mandate, src).catch((e) => ({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }) as ActionResult & { id?: string });
    setToast(r);
    if (r.ok && r.id) router.push(`/build/${r.id}`);
  });
  return (
    <div className="card" style={{ gap: 14 }}>
      <span className="card-t">New agent</span>
      <div className="ted-grid">
        <label className="ted-field"><span className="ted-k">Name</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Green Buyer" /></label>
        <label className="ted-field"><span className="ted-k">Start from</span>
          <select className="input" value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="blank">Blank</option>
            {from.map((f) => <option key={f.id} value={f.id}>A copy of {f.name}</option>)}
          </select>
        </label>
      </div>
      <label className="ted-field"><span className="ted-k">One line on its job</span><input className="input" value={mandate} maxLength={200} onChange={(e) => setMandate(e.target.value)} placeholder="Checks green coffee cover and says what to reorder" /></label>
      <div className="row wrap" style={{ gap: 10 }}>
        <button type="button" className="btn dark" disabled={busy || !name.trim()} onClick={go}>{busy ? "Creating…" : "Create, off duty"}</button>
        <span className="sub">It’s saved as v1 and can’t run on its own. You fill in the eight parts next.</span>
      </div>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Versions, newest first. Making an earlier one active adds no new version. */
export function SpecVersions({ versions, activate, controls }: { versions: { version: number; note: string | null; createdAt: string; active: boolean; createdBy: string; problems: string[]; looser: string[]; when: string }[]; activate: (version: number, confirmed: boolean) => Promise<ActionResult>; controls: boolean }) {
  const { toast, setToast, busy, run } = useAct();
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const pick = (v: (typeof versions)[number]) => {
    if (v.looser.length && !controls) { setToast({ ok: false, text: `Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to allow this: ${v.looser.join("; ")}.` }); return; }
    if (v.looser.length) setConfirm({ c: { title: `Make v${v.version} active?`, body: "It lets a run spend more than the active version.", lines: v.looser.map((x) => ({ k: "Change", v: x })), confirmLabel: `Use v${v.version}`, kind: "dark" }, go: () => run(() => activate(v.version, true)) });
    else run(() => activate(v.version, false));
  };
  return (
    <div className="card" style={{ gap: 6 }}>
      <span className="card-t">Versions</span>
      {versions.map((v) => (
        <div key={v.version} className="row wrap rule" style={{ gap: 10, padding: "10px 0", fontSize: 14 }}>
          <span style={{ fontWeight: 600, minWidth: 30 }}>v{v.version}</span>
          <span style={{ flex: "1 1 220px", minWidth: 0 }}>{v.note ?? "No note"}<span className="muted" style={{ display: "block", fontSize: 12 }}>{v.when} · {v.createdBy}{v.problems.length ? ` · can’t be used: ${v.problems.join("; ")}` : ""}</span></span>
          {v.active ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Active</span>
            : <button type="button" className="btn ghost xs" disabled={busy || v.problems.length > 0} onClick={() => pick(v)}>Make active</button>}
        </div>
      ))}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Playbooks: the approved one, a draft waiting for approval (Zak can drop steps), and the history. */
/** Morgan and Avery (slice 6): compare their own code with the runner, then switch which one runs. */
export function EnginePanel({ name, onRunner, controls, compare, switchTo }: { name: string; onRunner: boolean; controls: boolean; compare: Act; switchTo: Act<[boolean, boolean]> }) {
  const { toast, setToast, busy, run } = useAct();
  const [cmp, setCmp] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<{ c: Confirm; go: () => void } | null>(null);
  const onSwitch = () => {
    if (onRunner) { run(() => switchTo(false, false)); return; }
    if (!controls) { setToast({ ok: false, text: "Controls are off. Set DASHBOARD_CONTROLS=on in Vercel to switch." }); return; }
    setConfirm({ c: { title: `Switch ${name} to the runner?`, body: `From its next run, on the schedule, in a chain or by hand, ${name} follows its approved playbook on the runner and delivers through its report tools. Its own code stays, and you can switch back here at any time.`, confirmLabel: "Switch", kind: "dark" }, go: () => run(() => switchTo(true, true)) });
  };
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="card-t">Runs on</span>
        <span className="pill sm" style={onRunner ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : { background: "var(--soft)", color: "var(--ink2)" }}>{onRunner ? "The runner (this spec and playbook)" : "Its own code"}</span>
      </div>
      <span className="sub">{name} was rebuilt here from its own code, with a starting playbook. Compare runs both as free dry runs on today’s data: no model, nothing sent. Preview (above) shows what the runner’s model would write. Switch when they match.</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn outline" disabled={busy} onClick={() => { setCmp({ ok: true, text: "Running both dry runs…" }); run(compare, (r) => setCmp(r)); }}>Compare · free</button>
        <button type="button" className={onRunner ? "btn outline" : "btn dark"} disabled={busy || (!onRunner && !controls)} onClick={onSwitch}>{onRunner ? "Switch back to its own code" : "Switch to the runner"}</button>
      </div>
      {cmp && <span className="sub" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, color: cmp.ok ? undefined : "var(--red-ink)" }}>{cmp.text}</span>}
      {confirm && <Modal c={confirm.c} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

export function PlaybookPanel({ view, approve, reject }: { view: PlaybookView; approve: (id: number, keep: number[]) => Promise<ActionResult>; reject: (id: number) => Promise<ActionResult> }) {
  const { toast, setToast, busy, run } = useAct();
  const q = view.pending;
  const [keep, setKeep] = useState<number[]>(q ? q.steps.map((_, i) => i) : []);
  const statusLook: Record<string, { label: string; bg: string; ink: string }> = {
    approved: { label: "Approved", bg: "var(--mint-soft)", ink: "var(--mint-ink)" }, proposed: { label: "Waiting for you", bg: "var(--yel-soft)", ink: "var(--yel-ink)" },
    rejected: { label: "Rejected", bg: "var(--red-soft)", ink: "var(--red-ink)" }, replaced: { label: "Replaced", bg: "var(--soft)", ink: "var(--ink2)" },
  };
  return (
    <div className="card" style={{ gap: 12 }}>
      <span className="card-t">Playbook</span>
      <span className="sub">An explore run lets the model pick its own tool calls. Code saves the calls that worked as a playbook. Once you approve one, runs follow it: code makes the same calls on fresh data and the model only writes the result, which is cheaper and steadier. If a step fails, the run explores instead. After your first approval, a playbook from a Re-explore applies on its own and shows what changed; a run that falls back or doesn’t finish puts the agent on hold, so the next one waits for you again.</span>
      {view.hold && <div className="ted-warn">On hold: {view.hold}. The next playbook waits for your approval.</div>}
      {q && (
        <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span className="ted-k">v{q.version} · waiting for your approval · {q.when}</span>
          {q.changes && <span style={{ fontSize: 13.5 }}>{q.changes}</span>}
          {q.steps.map((st, i) => (
            <label key={i} className="row" style={{ gap: 10, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={keep.includes(i)} onChange={() => setKeep(keep.includes(i) ? keep.filter((x) => x !== i) : [...keep, i].sort((a, b) => a - b))} style={{ width: 18, height: 18 }} />
              <span>{i + 1}. {st}</span>
            </label>
          ))}
          <span className="row" style={{ gap: 10, fontSize: 14 }}><Icon name="cpu" size={15} /><span>{q.steps.length + 1}. The model writes the result from what these returned</span></span>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn dark sm" disabled={busy || !keep.length} onClick={() => run(() => approve(q.id, keep))}>{keep.length === q.steps.length ? "Approve" : `Approve ${keep.length} of ${q.steps.length} steps`}</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => run(() => reject(q.id))}>Reject</button>
          </div>
        </div>
      )}
      {view.active ? (
        <div className="stack" style={{ gap: 4 }}>
          <span className="ted-k">v{view.active.version} · approved{view.active.auto ? " on its own" : ""} · {view.active.when}</span>
          {view.active.steps.map((st, i) => <span key={i} style={{ fontSize: 14 }}>{i + 1}. {st}</span>)}
          <span style={{ fontSize: 14 }}>{view.active.steps.length + 1}. The model writes the result</span>
        </div>
      ) : !q && <span className="sub">None yet. Press Preview to explore; code drafts one from the calls that worked.</span>}
      {view.history.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>History</summary>
          {view.history.map((h) => (
            <div key={h.id} className="row wrap rule" style={{ gap: 10, padding: "8px 0", fontSize: 13.5 }}>
              <span style={{ fontWeight: 600, minWidth: 30 }}>v{h.version}</span>
              <span style={{ flex: "1 1 220px" }}>{h.changes ?? `${h.steps.length} steps`}<span className="muted" style={{ display: "block", fontSize: 12 }}>{h.when}{h.auto ? " · applied on its own" : ""}</span></span>
              <span className="pill sm" style={{ background: statusLook[h.status]?.bg, color: statusLook[h.status]?.ink }}>{statusLook[h.status]?.label ?? h.status}</span>
            </div>
          ))}
        </details>
      )}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
