import Link from "next/link";
import { notFound } from "next/navigation";
import { costUsd, MODELS } from "@/integrations/anthropic";
import { dryRun } from "@/dashboard/actions";
import { BY_ID } from "@/dashboard/crew";
import { getFloor, getRun, leadsForRun } from "@/dashboard/data";
import { dur, m4, num, utcStr, when } from "@/dashboard/format";
import { RUN_LOOK } from "@/dashboard/status";
import { DryRun } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { RunCanvas } from "@/dashboard/components/RunCanvas";
import { Avatar, Summary } from "@/dashboard/components/ui";

export default async function Replay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const a = BY_ID[run.agent_id];
  if (!a) notFound();
  const f = await getFloor();
  const others = f.runs.filter((r) => r.agent_id === a.id && r.status !== "skipped" && r.id !== run.id).slice(0, 6);
  const leads = a.id === "wholesale_hunter" ? await leadsForRun(run.id) : null;
  const look = RUN_LOOK[run.status];

  // Where the money went, split in code with the same prices the agents bill with.
  const model = Object.values(MODELS).find((m) => a.model?.startsWith(m));
  const inUsd = model ? costUsd(model, run.tokens_in, 0) : 0;
  const outUsd = model ? costUsd(model, 0, run.tokens_out) : 0;
  const rest = Math.max(0, Number((run.cost_usd - inUsd - outUsd).toFixed(4)));
  const money = [
    { label: "Input: prompt and pages read", amount: inUsd, sub: `${num(run.tokens_in)} tokens`, color: "var(--acc)" },
    { label: "Output", amount: outUsd, sub: `${num(run.tokens_out)} tokens`, color: "var(--mint)" },
    { label: a.id === "wholesale_hunter" ? "Web searches" : "Other", amount: rest, sub: a.id === "wholesale_hunter" ? `about ${Math.round(rest / 0.01)} at $0.01` : "", color: "var(--ink2)" },
  ];

  const title = run.status === "skipped" ? `Skipped · ${when(run.started_at)}` : run.status === "failed" ? `Failed · ${when(run.started_at)}` : `${run.trigger === "manual" ? "Manual" : run.trigger === "approval" ? "Approval" : "Scheduled"} run · ${when(run.started_at)}`;
  const stats = [
    ["Started", `${when(run.started_at)} CT`, utcStr(run.started_at)],
    ["Duration", dur(run.started_at, run.ended_at), ""],
    ["Cost", m4(run.cost_usd), ""],
    ["Tokens", `${num(run.tokens_in)} in · ${num(run.tokens_out)} out`, ""],
    ["Trigger", run.trigger === "cron" ? "Vercel Schedule" : run.trigger === "manual" ? "Zak pressed Run" : run.trigger === "approval" ? "Zak approved changes (gateway)" : run.trigger, ""],
  ];

  return (
    <>
      <div className="card dark" style={{ borderRadius: 24, padding: 24, gap: 20 }}>
        <div className="row wrap" style={{ gap: 14 }}>
          <Avatar a={a} size={48} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 240 }}>
            <span style={{ fontSize: 12.5, color: "#9A9AA3" }}>Run replay · {a.name}, {a.role}</span>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>{title}</span>
          </div>
          <span className="pill" style={{ background: "#24242A" }}><span className="dot" style={{ background: look.dot }} />{look.label}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
          {stats.map(([k, v, t]) => <div key={k} title={t || undefined} style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 12, color: "#8A8A93" }}>{k}</span><span style={{ fontSize: 16, fontWeight: 600 }}>{v}</span></div>)}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span title="Needs run transcripts" style={{ width: 44, height: 44, borderRadius: 999, background: "#2A2A30", display: "grid", placeItems: "center", flex: "none", opacity: 0.6 }}><Icon name="play" size={17} style={{ color: "#F4F4F6" }} /></span>
          <div style={{ position: "relative", flex: 1, height: 40 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 17, height: 6, borderRadius: 999, background: "#2A2A30" }} />
            <div style={{ position: "absolute", left: 0, top: 17, height: 6, width: "100%", borderRadius: 999, background: "linear-gradient(90deg,#F5D35C,#F2884B)", opacity: run.status === "skipped" ? 0.2 : 1 }} />
          </div>
          <span style={{ fontSize: 12.5, color: "#B9B9C2", whiteSpace: "nowrap" }}>Steps need transcripts</span>
        </div>
      </div>

      {others.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="sub" style={{ marginRight: 4 }}>Other runs</span>
          {others.map((o) => <Link key={o.id} href={`/runs/${o.id}`} className="btn ghost xs" style={{ height: 32, fontSize: 12.5 }}>{when(o.started_at)}{o.status === "failed" ? " · failed" : ""}</Link>)}
        </div>
      )}

      {run.status !== "skipped" && model && (
        <div className="card" style={{ gap: 12 }}>
          <div className="card-h"><span className="card-t">Where the money went</span><span className="muted" style={{ fontSize: 12 }}>Computed in code</span><span style={{ fontSize: 15, fontWeight: 600 }}>{m4(run.cost_usd)}</span></div>
          <div className="bar" style={{ height: 14, borderRadius: 999 }}>{money.filter((m) => m.amount > 0).map((m) => <span key={m.label} style={{ flex: m.amount, background: m.color }} />)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {money.map((m) => <div key={m.label} className="row" style={{ alignItems: "flex-start", gap: 8 }}><span className="dot" style={{ width: 8, height: 8, marginTop: 5, background: m.color }} /><div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontSize: 12.5 }} className="ink2">{m.label}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{m4(m.amount)}</span><span className="muted" style={{ fontSize: 11.5 }}>{m.sub}</span></div></div>)}
          </div>
        </div>
      )}

      {run.status !== "skipped" && <div className="card" style={{ padding: 16 }}><RunCanvas a={a} run={run} leads={leads} /></div>}

      <div className="grid2">
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">Summary</span>
          <span style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}><Summary text={run.summary ?? (run.status === "running" ? "Working now…" : "No summary.")} /></span>
          {run.error && <div style={{ padding: "12px 14px", borderRadius: 14, background: "var(--red-soft)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, color: "var(--red-ink)", overflowWrap: "anywhere" }}>{run.error}</div>}
          {leads != null && <div className="row wrap" style={{ gap: 6 }}><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>{leads} leads in wholesale_leads</span></div>}
          <div className="row wrap"><DryRun action={dryRun.bind(null, a.id)} /></div>
        </div>
        <div className="card dashed" style={{ padding: "40px 28px", alignItems: "center", textAlign: "center", gap: 8 }}>
          <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center" }}><Icon name="history" /></span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Steps need run transcripts</span>
          <span style={{ fontSize: 13, maxWidth: 340 }} className="ink2">Coming later. Each tool call and gateway decision will appear here for every run, with a scrubber to play it back.</span>
        </div>
      </div>
    </>
  );
}
