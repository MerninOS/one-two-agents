import Link from "next/link";
import { ACCESS, BY_ID, CREW, HARD_RULES, INTEGRATIONS, type IntegrationId } from "@/dashboard/crew";
import { requireSession } from "@/dashboard/data";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar } from "@/dashboard/components/ui";

const LABEL = { read: "Read", draft: "Draft", write: "Write", uses: "Uses" } as const;
const LEGEND: [keyof typeof LABEL, string][] = [["read", "Reads data. Changes nothing."], ["draft", "Proposes. Zak approves or sends."], ["write", "Writes its own tables or pages."], ["uses", "Uses the service, e.g. a model."]];

export default async function Access({ searchParams }: { searchParams: Promise<{ cell?: string }> }) {
  await requireSession();
  const [agentId, intId] = ((await searchParams).cell ?? "").split(":");
  const sel = BY_ID[agentId] && INTEGRATIONS.find((i) => i.id === intId) ? { a: BY_ID[agentId], i: INTEGRATIONS.find((i) => i.id === intId)!, v: ACCESS[agentId]?.[intId as IntegrationId] } : null;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}><h1 className="h1">Who can touch what</h1><span style={{ fontSize: 13.5 }} className="muted">Access is shown here, not granted here.</span></div>
      <div className="card dark" style={{ gap: 12 }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="lock" size={15} />Hard rules for every agent · locked</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "6px 24px" }}>
          {HARD_RULES.map((r, n) => <span key={r} className="row" style={{ gap: 10, fontSize: 13, lineHeight: 1.45, color: "#D6D6DC", alignItems: "flex-start" }}><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".06em", color: "#8A8A93", width: 48, flex: "none", paddingTop: 2 }}>RULE {n + 1}</span>{r}</span>)}
        </div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: "minmax(0,1fr) 300px" }}>
        <div className="card" style={{ padding: 16, overflowX: "auto" }}>
          <div style={{ minWidth: 760 }}>
            <div className="matrix" style={{ paddingBottom: 10 }}>
              <span />
              {INTEGRATIONS.map((i) => <span key={i.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 11.5, textAlign: "center" }} className="ink2"><Icon name={i.icon} size={15} />{i.name}</span>)}
            </div>
            {CREW.map((a) => (
              <div key={a.id} className="matrix rule" style={{ padding: "6px 0", opacity: a.built ? 1 : 0.7 }}>
                <span className="row" style={{ gap: 9 }}><Avatar a={a} size={28} /><span style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 13, fontWeight: 600 }}>{a.name}</span><span className="muted" style={{ fontSize: 11 }}>{a.role}</span></span></span>
                {INTEGRATIONS.map((i) => {
                  const v = ACCESS[a.id]?.[i.id];
                  const on = sel?.a.id === a.id && sel.i.id === i.id;
                  return <Link key={i.id} href={`/access?cell=${a.id}:${i.id}`} scroll={false} className={`mcell ${v ? `lv-${v[0]}` : "lv-none"}`} style={{ textDecoration: "none", outline: on ? "2px solid var(--acc)" : undefined }}>{v ? LABEL[v[0]] : "—"}</Link>;
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="stack">
          <div className="card" style={{ gap: 8 }}>
            {!sel ? <><span className="card-t">Pick a cell</span><span style={{ fontSize: 13 }} className="ink2">See the exact scope for that agent and integration.</span></> : (
              <>
                <span className="card-t">{sel.a.name} · {sel.i.name}</span>
                <span className="muted" style={{ fontSize: 12 }}>Level · {sel.v ? LABEL[sel.v[0]] : "None"}{sel.a.built ? "" : " · planned"}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{sel.v ? sel.v[1] : `${sel.a.name} has no access to ${sel.i.name}.`}</span>
                <span className="muted rule" style={{ fontSize: 12, lineHeight: 1.5, paddingTop: 8 }}>{sel.i.scope}</span>
              </>
            )}
          </div>
          <div className="card" style={{ gap: 8 }}>
            {LEGEND.map(([k, t]) => <span key={k} className="row" style={{ fontSize: 12.5 }}><span className={`mcell lv-${k}`} style={{ width: 56, height: 24, fontSize: 11.5 }}>{LABEL[k]}</span>{t}</span>)}
          </div>
        </div>
      </div>
    </>
  );
}
