import "server-only";
// Avery's chat, the front door (docs/company-mode.md, slice 5). The owner types to the agent in the company
// seat from any screen; each message is one run through withRun, so it is logged in agent_runs and
// stays inside her daily budget. The run uses the shared runner (core/runner.ts) with:
//
// - her active spec's model and cost cap, her read and calculate tools, Goal progress, and The crew
//   now (below);
// - two chat-only report tools, offered nowhere else (they are not in the builder's tool list):
//   Save a rule, whose words must be the owner's own from this message (checked in code), and File a
//   proposal, which goes through fileProposal like a head's and does nothing until his yes.
//
// Nothing here runs, starts or changes an agent, and nothing sends, pays or posts. Rules and
// proposals are saved only after a run that finishes; code, not the model, says what it saved.
import { db } from "@/core/db";
import { loadSpec, type AgentSpec } from "@/core/agent-spec";
import { loadMemory } from "@/core/memory";
import { agentNames, companySeat, liveAgentIds, loadOrg, seatOf, type Org } from "@/core/org";
import { planReaction } from "@/core/reaction-rules";
import { saveRule } from "@/core/reactions";
import { runExplore } from "@/core/runner";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, type Business } from "@/core/business-rules";
import { withRun } from "@/core/runs";
import { chicagoDate, dayTitle } from "@/core/time";
import { TOOLS } from "@/core/tools/catalog";
import type { ToolDef } from "@/core/tools/types";
import { weekOf } from "@/core/plan-rules";
import { MAX_FILED, MAX_REPLY, MAX_RULES, chatPrompt, deptNamed, inOwnWords, resolveRuleWho, savedLines, type ChatLine, type ChatReach } from "@/core/chat-rules";

export const CHAT_MISSING = "The chat table isn’t in Supabase yet: apply the migration 20261124090000_avery_chat.sql. Until then Avery answers but the conversation isn’t kept.";
export interface ChatRow { id: string; role: "owner" | "avery"; text: string; run_id: string | null; notes: string[]; created_at: string }

/** The latest messages, oldest first. Null when the table isn't there. */
export async function chatHistory(limit = 30): Promise<ChatRow[] | null> {
  const { data, error } = await db().from("avery_chat").select("id, role, text, run_id, notes, created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) return null;
  return ((data ?? []) as ChatRow[]).map((r) => ({ ...r, notes: Array.isArray(r.notes) ? r.notes : [] })).reverse();
}

/** What the owner asked, for the replay of the chat run that answered it. Null when it isn't kept. */
export async function askedIn(runId: string): Promise<string | null> {
  const { data: reply } = await db().from("avery_chat").select("created_at").eq("run_id", runId).eq("role", "avery").maybeSingle();
  if (!reply) return null;
  const { data } = await db().from("avery_chat").select("text").eq("role", "owner").lt("created_at", reply.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.text as string | undefined) ?? null;
}

async function keep(row: { role: "owner" | "avery"; text: string; run_id?: string | null; notes?: string[] }): Promise<boolean> {
  const { error } = await db().from("avery_chat").insert({ role: row.role, text: row.text.slice(0, 4000), run_id: row.run_id ?? null, notes: row.notes ?? [] });
  return !error;
}

/** Who holds the company seat, from the chart. */
async function frontDoor(): Promise<{ org: Org; agentId: string; spec: AgentSpec } | { problem: string }> {
  const org = await loadOrg();
  if (!org) return { problem: "The org chart isn't set up, so there is no company seat for Avery." };
  const seat = companySeat(org);
  if (!seat || seat.holder !== "agent" || !seat.agentId) return { problem: "Nobody holds the company seat. Put Avery in it on Crew > Org chart." };
  const loaded = await loadSpec(seat.agentId);
  if (!loaded) return { problem: "The agent in the company seat has no saved version." };
  return { org, agentId: seat.agentId, spec: loaded.spec };
}

const directive = (name: string, biz: Business) => `You are ${name}, chief of staff at ${biz.name}, talking in the Control Room with a person from the business. Answer their questions about the company from your tools: goals, department reports, this week's plans, proposals, the crew and the numbers. Short plain sentences, at most about 120 words. No flattery, no exclamation marks.

Besides answering you can do only two things:
- When they tell you a rule for an agent, a department or everyone ("Rowan: skip chains", "Quinn keeps putting Costco in supplies, it's groceries"), save it with Save a rule. The words must be their own, copied from their message; who is the agent, the department or everyone they mean. If it isn't clear who should follow it, ask them instead of saving.
- When they want to hire, give an agent a read tool, get a new tool built, or retire an agent or close a seat, file it with File a proposal. Nothing happens until an owner says yes on Proposals. Ask first if you don't know enough to fill it in.

You never run, start, stop or change an agent, and you never send, buy or post. If they ask for that, tell them where in the Control Room they can do it. Code saves rules and proposals only after you finish and adds a line under your reply saying what it saved, so don't say you saved anything yourself.`;

/** The crew now: who sits where, on duty or not, how each agent's last run went, this week's plans and the proposals waiting. */
function crewNowTool(org: Org): ToolDef {
  return {
    id: "crew_now", label: "The crew now", detail: "Every department with its seats (who holds each, on duty or not, the last run), this week's plan and review per department, agents not in a department, and the proposals waiting for a decision",
    kind: "read", group: "agents", params: [], trusted: false, needs: [], costUsd: 0,
    run: async () => {
      const live = await liveAgentIds();
      const ids = [...live];
      const [names, agents, runs, plans, props] = await Promise.all([
        agentNames(ids),
        db().from("agents").select("id, enabled").in("id", ids),
        db().from("agent_runs").select("agent_id, status, started_at, summary, error").in("agent_id", ids).not("trigger", "in", "(preview,chat)").order("started_at", { ascending: false }).limit(300),
        db().from("plans").select("department_id, summary, items, review").eq("week_of", weekOf(chicagoDate(0))),
        db().from("proposals").select("title, kind, from_agent, created_at").eq("state", "pending").order("created_at").limit(30),
      ]);
      const onDuty = new Map((agents.data ?? []).map((a) => [a.id as string, !!a.enabled]));
      const last = new Map<string, { status: string; at: string; said: string }>();
      for (const r of runs.data ?? []) if (!last.has(r.agent_id)) last.set(r.agent_id, { status: r.status, at: r.started_at, said: String(r.error ?? r.summary ?? "").replace(/\s+/g, " ").slice(0, 240) });
      const who = (id: string | null | undefined) => (id ? { agent: names[id] ?? id, onDuty: onDuty.get(id) ?? false, lastRun: last.get(id) ?? null } : null);
      const planOf = (deptId: string) => {
        const p = (plans.data ?? []).find((x) => x.department_id === deptId);
        if (!p) return null;
        const items = (Array.isArray(p.items) ? p.items : []) as { title: string; who: string; kind: string; doneAt?: string }[];
        return { words: p.summary, lines: items.map((i) => ({ job: i.title, who: i.who, ...(i.kind === "owner" ? { done: !!i.doneAt } : {}) })), review: p.review };
      };
      const departments = org.departments.map((d) => ({
        department: d.name,
        seats: org.seats.filter((s) => s.departmentId === d.id).map((s) => ({ seat: s.title, head: s.parentId == null, holder: s.holder === "agent" ? who(s.agentId) : s.holder === "owner" ? "a person" : "open" })),
        planThisWeek: planOf(d.id),
      }));
      const loose = ids.filter((id) => !seatOf(org, id)).map((id) => who(id));
      const waiting = (props.data ?? []).map((p) => ({ title: p.title, kind: p.kind, from: p.from_agent ? names[p.from_agent] ?? p.from_agent : "a person" }));
      return {
        data: { departments, notInADepartment: loose, proposalsWaiting: props.error ? "the proposals table isn't there" : waiting },
        numbers: { agents_on_duty: [...onDuty.values()].filter(Boolean).length, agents: ids.length, open_seats: org.seats.filter((s) => s.holder === "open").length, proposals_waiting: waiting.length },
      };
    },
  };
}

/** Save a rule: the person's words for an agent, a department or everyone. Checked against their message in code. */
function saveRuleTool(message: string, reach: ChatReach, companyId: string): ToolDef {
  return {
    id: "save_rule", label: "Save a rule", detail: "Saves a rule the person just dictated, in their own words, for an agent, a department or everyone. Saved after you finish; code says what it saved",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "words", type: "text", maxLength: 280, description: "The rule, copied word for word from their message. Never your own words." },
      { name: "who", type: "text", maxLength: 60, description: "An agent's name, a department's name, or everyone." },
      { name: "keep", type: "enum", options: ["always", "days_30", "next_run"], default: "always", description: "How long: always, 30 days, or the next run only. Only an agent's own rule can be short-lived." },
    ],
    collect: (input, held) => {
      if (held.length >= MAX_RULES) return { problem: `at most ${MAX_RULES} rules from one message` };
      if (!inOwnWords(String(input.words), message)) return { problem: "the words must be their own, copied from their message" };
      const w = resolveRuleWho(String(input.who), reach);
      if ("problem" in w) return w;
      return { row: input };
    },
    deliver: async (o, ctx) => {
      const notes: string[] = [];
      for (const r of o.rows) {
        const w = resolveRuleWho(String(r.who), reach);
        if ("problem" in w) { notes.push(`Not saved (“${r.words}”): ${w.problem}.`); continue; }
        const got = planReaction({ verdict: "not", text: String(r.words), scope: w.scope, keep: String(r.keep ?? "always") }, { hasDept: true });
        if ("error" in got || !got.plan.rule) { notes.push(`Not saved (“${r.words}”): ${"error" in got ? got.error : "no words"}`); continue; }
        try {
          await saveRule({ scope: w.scope, agentId: w.scope === "agent" ? w.agentId : companyId, deptId: w.scope === "department" ? w.deptId : null, keep: got.plan.rule.keep, text: got.plan.rule.text, tag: `chat:${ctx.runId ?? ""}` });
          const forWho = w.scope === "crew" ? "every agent" : w.name;
          const when = got.plan.rule.keep === "next_run" ? ", for the next run only" : got.plan.rule.keep === "days_30" ? ", for 30 days" : "";
          notes.push(`Saved for ${forWho} in your words${when}: “${got.plan.rule.text}”. Undo on the Memory tab.`);
        } catch (e) { notes.push(`Not saved (“${r.words}”): ${e instanceof Error ? e.message : e}`); }
      }
      return notes.join(" | ") || "nothing to save";
    },
  };
}

/** File a proposal: the same checks as a head's Propose to the owner, plus which department it is for. */
function fileProposalTool(reach: ChatReach): ToolDef {
  const base = TOOLS.propose;
  return {
    id: "file_proposal", label: "File a proposal", detail: "Files a proposal for an owner to decide on Proposals: hire an agent, give an agent a read tool, build a new tool, or retire an agent or close a seat. Nothing happens until an owner says yes",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      ...base.params,
      { name: "department", type: "text", maxLength: 60, optional: true, description: "hire for a new seat: the department it joins (it goes under that department's head)." },
    ],
    collect: (input, held) => {
      if (held.length >= MAX_FILED) return { problem: `at most ${MAX_FILED} proposals from one message` };
      const d = deptNamed(input.department as string | undefined, reach.departments);
      if ("problem" in d) return d;
      return base.collect!(input, held);
    },
    deliver: async (o, ctx) => {
      if (!o.rows.length) return "no proposals";
      const { fileProposal } = await import("@/core/proposals");
      const notes: string[] = [];
      for (const r of o.rows) {
        const d = deptNamed(r.department as string | undefined, reach.departments);
        try {
          await fileProposal(r, { agentId: ctx.agentId, runId: ctx.runId ?? null, source: "agent", deptId: "id" in d ? d.id : null });
          notes.push(`Filed for you to decide: ${r.title}. It waits on Proposals.`);
        } catch (e) { notes.push(`Not filed (${r.title}): ${e instanceof Error ? e.message : e}`); }
      }
      return notes.join(" | ");
    },
  };
}

export interface ChatAnswer { ok: boolean; reply: string; notes: string[]; runId: string | null; costUsd: number; kept: boolean }

/** One message to Avery: a logged run (trigger "chat") inside her budget. Saves both sides of the conversation. */
export async function askAvery(message: string): Promise<ChatAnswer> {
  const door = await frontDoor();
  if ("problem" in door) return { ok: false, reply: door.problem, notes: [], runId: null, costUsd: 0, kept: false };
  const { org, agentId, spec: base } = door;
  const history = (await chatHistory(12)) ?? [];
  const kept = await keep({ role: "owner", text: message });
  const live = await liveAgentIds();
  const names = await agentNames([...live]);
  const reach: ChatReach = { agents: [...live].map((id) => ({ id, name: names[id] ?? id })), departments: org.departments.map((d) => ({ id: d.id, name: d.name })) };
  const chatTools = [crewNowTool(org), saveRuleTool(message, reach, agentId), fileProposalTool(reach)];
  const reads = base.tools.filter((id) => (TOOLS[id]?.kind === "read" || TOOLS[id]?.kind === "calculate") && !TOOLS[id]?.server);
  const spec: AgentSpec = {
    ...base,
    directive: directive(base.name, await loadBusiness().catch(() => UNKNOWN_BUSINESS)),
    goodResult: "A short plain answer, at most about 120 words. Every number exactly as a tool gave it.",
    effort: "low",
    tools: [...new Set([...reads, "goal_progress", ...chatTools.map((t) => t.id)])],
    limits: { maxSteps: Math.min(base.limits.maxSteps, 8), maxCostUsd: base.limits.maxCostUsd },
    outputName: "chat reply",
  };
  let block = "";
  try { block = (await loadMemory(agentId)).block; } catch { /* chat without her notes is fine */ }
  const today = chicagoDate(0);
  let reports: { tool: string; ok: boolean; note: string }[] = [];
  let finished = false, said: string | null = null;
  const res = await withRun(agentId, "chat", async (runId) => {
    const r = await runExplore(spec, {
      agentId, runId, memoryBlock: block, deliver: true, chat: true,
      prompt: chatPrompt(history.map((h): ChatLine => ({ role: h.role, text: h.text })), message, `${dayTitle(today)}, ${today}`),
      tools: { ...TOOLS, ...Object.fromEntries(chatTools.map((t) => [t.id, t])) },
    });
    reports = r.reports; finished = r.finished; said = r.result;
    return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: r.metrics };
  }).catch((e: unknown) => ({ status: "failed" as const, summary: `I couldn't answer that: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, costUsd: 0, runId: null }));
  const notes = savedLines(reports);
  const reply = res.status === "skipped" ? `I can't answer right now: ${res.summary}` : (finished && said ? said : res.summary).slice(0, MAX_REPLY);
  const keptReply = kept && await keep({ role: "avery", text: reply, run_id: res.runId, notes });
  return { ok: res.status === "ok", reply, notes, runId: res.runId, costUsd: res.costUsd ?? 0, kept: !!keptReply };
}
