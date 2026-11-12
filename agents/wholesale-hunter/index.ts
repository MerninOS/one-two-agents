import "server-only";
// Wholesale Hunter: finds a few new wholesale prospects with web search, scores
// the fit, and writes a short first-touch email for each. Drafts land in Gmail
// (when connected) and on a Notion page; nothing is ever sent from here.
// Lead pages are untrusted: the model only reads them, and every lead it reports
// is checked here (dedupe by domain, email shape) before it is stored.
import { PL_BAGS, PL_MIN, PL_PACK, roastName, wholesaleOf } from "@/domain/coffee";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { loadMemory, loadWords, type MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import { chicagoDate, dayTitle } from "@/core/time";
import { Anthropic, MODELS, claude, costUsd, inputTokens } from "@/integrations/anthropic";
import { createDraft, hasGmail } from "@/integrations/gmail";
import { divider, h2, h3, li, notionPage, p, quote, type Block } from "@/integrations/notion";
import { getInventoryLots } from "@/integrations/shopify/lots";
import { fetchStockCoffees } from "@/integrations/shopify/stock";
import { AREAS, PER_RUN, SOP } from "./prompt";

const MODEL = MODELS.opus;
const MAX_TURNS = 6;

const RECORD = {
  name: "record_leads",
  description: "Report the qualified wholesale leads and their first-touch drafts. Call once, at the end.",
  strict: true,
  input_schema: {
    type: "object" as const,
    properties: {
      leads: {
        type: "array",
        items: {
          type: "object",
          properties: {
            business: { type: "string" },
            city: { type: "string" },
            type: { type: "string", enum: ["cafe", "restaurant", "office", "grocery", "other"] },
            website: { type: "string" },
            contact_name: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            contact_route: { type: ["string", "null"] },
            fit_score: { type: "integer" },
            fit_reason: { type: "string" },
            sources: { type: "array", items: { type: "string" } },
            subject: { type: "string" },
            body: { type: "string" },
          },
          required: ["business", "city", "type", "website", "contact_name", "email", "contact_route", "fit_score", "fit_reason", "sources", "subject", "body"],
          additionalProperties: false,
        },
      },
      remember: { type: "array", items: { type: "string" }, description: "Working memory for your next run: at most five short lines. No email addresses, links or phone numbers." },
    },
    required: ["leads", "remember"],
    additionalProperties: false,
  },
};
interface Lead {
  business: string; city: string; type: string; website: string; contact_name: string | null; email: string | null;
  contact_route: string | null; fit_score: number; fit_reason: string; sources: string[]; subject: string; body: string;
}

// Profiles on these hosts belong to different businesses, so the profile path is part of the key.
const SHARED_HOSTS = new Set(["instagram.com", "facebook.com", "linktr.ee", "yelp.com", "google.com", "maps.google.com", "tiktok.com", "x.com", "twitter.com", "square.site", "toasttab.com"]);
/** Dedupe key for a lead's website: the host without www., plus the profile path on shared hosts. */
export const domainOf = (url: string) => {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!SHARED_HOSTS.has(host)) return host;
    const path = u.pathname.split("/").filter(Boolean).slice(0, 2).join("/").toLowerCase();
    return path ? `${host}/${path}` : null;
  } catch { return null; }
};
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;

async function offer() {
  const [lots, stock] = await Promise.all([getInventoryLots(), fetchStockCoffees()]);
  return {
    site: `${env.siteUrl}/wholesale`,
    privateLabel: {
      minimumLb: PL_MIN,
      roastedToOrder: true,
      customBlend: "The shop can design its own house blend from our green lots, or take one of our coffees, under its own name.",
      bags: PL_BAGS.map((b) => b.label),
      packaging: PL_PACK.map((x) => `${x.title}: ${x.rate}`),
    },
    ourCoffees: stock.filter((s) => s.price > 0).map((s) => ({ name: s.name, about: s.sub, roast: roastName(s.roast), wholesalePerLb: s.price })),
    greenLots: lots.filter((l) => l.listed && l.avail > 0).map((l) => ({ name: l.name, origin: l.origin, process: l.process, wholesalePerLb: wholesaleOf(l) })),
  };
}

async function hunt(facts: unknown, known: string[], memory: MemoryLoad | null) {
  const client = claude();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Today is ${chicagoDate(0)}. Find ${PER_RUN} new wholesale leads in ${AREAS.join(", ")}.\n\n` +
      `Offer facts:\n${JSON.stringify(facts, null, 1)}\n\nAlready in the pipeline (skip these):\n${known.length ? known.join("\n") : "(none yet)"}`,
  }];
  const usage = { in: 0, out: 0, searches: 0 };
  let nudged = false;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: memory?.block ? [{ type: "text", text: SOP }, { type: "text", text: memory.block }] : SOP,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 10, user_location: { type: "approximate", city: "Austin", region: "Texas", country: "US", timezone: "America/Chicago" } },
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 20 },
        RECORD,
      ],
      messages,
    });
    usage.in += inputTokens(res.usage);
    usage.out += res.usage.output_tokens;
    usage.searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    if (res.stop_reason === "refusal") throw new Error("Hunter model declined the request");
    const call = res.content.find((b) => b.type === "tool_use" && b.name === "record_leads");
    if (call && call.type === "tool_use") { const input = call.input as { leads: Lead[]; remember?: string[] }; return { leads: input.leads, remember: input.remember ?? [], usage }; }
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue; // server tools hit their loop limit; resend to resume
    if (nudged) break;
    nudged = true;
    messages.push({ role: "user", content: "Call record_leads now with the leads you have." });
  }
  return { leads: [] as Lead[], remember: undefined as string[] | undefined, usage };
}

function leadBlocks(rows: { lead: Lead; draftId: string | null; draftError: string | null }[]): Block[] {
  if (!rows.length) return [p("No new leads this run.")];
  return rows.flatMap(({ lead: l, draftId, draftError }) => [
    h3(`${l.business} · ${l.city} · fit ${l.fit_score}/5`),
    li(`${l.type}, ${l.website}${l.contact_name ? `, contact: ${l.contact_name}` : ""}`),
    li(`Why: ${l.fit_reason}`),
    li(l.email
      ? (draftId ? `Draft is in Gmail, to ${l.email}` : `Email ${l.email}${draftError ? ` (Gmail draft failed: ${draftError})` : ", copy the draft below"}`)
      : `No public email. Reach them via ${l.contact_route ?? "their website"}`),
    quote(`Subject: ${l.subject}\n\n${l.body}`),
    divider(),
  ]);
}

export async function runHunter(runId?: string, opts: { dryRun?: boolean; memory?: MemoryLoad | null } = {}): Promise<RunResult> {
  const [facts, { data: existing }] = await Promise.all([
    offer(),
    db().from("wholesale_leads").select("business, domain"),
  ]);
  // a dry run checks Shopify and Supabase reads without spending on the model (~$1 a run)
  if (opts.dryRun) {
    let mem = "";
    try { mem = `; ${loadWords(await loadMemory("wholesale_hunter"))}`; } catch (e) { mem = `; memory not loaded (${e instanceof Error ? e.message.slice(0, 80) : e})`; }
    return { status: "ok", summary: `[dry run, no search] offer has ${facts.ourCoffees.length} coffees and ${facts.greenLots.length} green lots; ${existing?.length ?? 0} leads already in the pipeline${mem}` };
  }
  const knownDomains = new Set((existing ?? []).map((r) => r.domain).filter(Boolean));
  const { leads, remember, usage } = await hunt(facts, (existing ?? []).map((r) => `${r.business}${r.domain ? ` (${r.domain})` : ""}`), opts.memory ?? null);

  const fresh: Lead[] = [];
  for (const l of leads) {
    const d = domainOf(l.website);
    if (!d || knownDomains.has(d)) continue;
    knownDomains.add(d);
    fresh.push({ ...l, email: l.email && EMAIL.test(l.email.trim()) ? l.email.trim() : null, fit_score: Math.min(5, Math.max(1, Math.round(l.fit_score))) });
  }

  const gmail = hasGmail();
  const rows = [];
  for (const l of fresh.slice(0, PER_RUN)) {
    let draftId: string | null = null, draftError: string | null = null;
    if (gmail && l.email) {
      try { draftId = await createDraft(l.email, l.subject, l.body); } catch (e) { draftError = e instanceof Error ? e.message.slice(0, 120) : String(e); }
    }
    const { error } = await db().from("wholesale_leads").insert({
      business: l.business, city: l.city, type: l.type, website: l.website, domain: domainOf(l.website),
      contact_name: l.contact_name, email: l.email, contact_route: l.contact_route, sources: l.sources,
      fit_score: l.fit_score, fit_reason: l.fit_reason, stage: draftId ? "drafted" : "new",
      draft_subject: l.subject, draft_body: l.body, gmail_draft_id: draftId, run_id: runId ?? null,
    });
    if (error) throw new Error(`Could not save lead ${l.business}: ${error.message}`);
    rows.push({ lead: l, draftId, draftError });
  }

  const today = chicagoDate(0);
  const url = await notionPage(`Wholesale leads · ${dayTitle(today)}`, [
    h2(`${rows.length} new lead${rows.length === 1 ? "" : "s"}`),
    p(gmail ? "Drafts with an email address are waiting in Gmail. Edit, send or delete them there." : "Gmail isn't connected yet, so copy each draft from here."),
    ...leadBlocks(rows),
  ], env.notionLeadsParent);
  const drafted = rows.filter((r) => r.draftId).length;
  return {
    status: "ok",
    summary: `${rows.length} new leads${leads.length > rows.length ? ` (${leads.length} found, ${leads.length - rows.length} already known or unusable)` : ""}${gmail ? `, ${drafted} Gmail drafts` : ""}, ${usage.searches} searches: ${url}${opts.memory ? `. ${loadWords(opts.memory).replace(/^m/, "M")}.` : ""}`,
    remember,
    tokensIn: usage.in, tokensOut: usage.out,
    costUsd: costUsd(MODEL, usage.in, usage.out, usage.searches),
  };
}
