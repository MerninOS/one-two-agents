// Custom MCP servers (docs/custom-servers.md, slice 1). Pure: no database, no network, so
// `npm run check:mcp` can test it.
//
// A custom server is one the owner adds by its address, for a tool the built-in connectors don't
// have. Nobody who maintains this app reviewed its code, so it gets tighter limits than a built-in server:
// every tool starts off, only tools that say they only read and take plain inputs can be turned on,
// a turned-on tool that changes in any way pauses the server, and the address must be a public
// https host. Its profile is a row the owner edits (mcp_custom_servers); these limits are code.

import { createHash } from "node:crypto";
import type { GoalNumber } from "./goal-number-rules";
import type { Param } from "@/core/tools/types";

/** A custom server's id: also its row in mcp_connections, so the vault, pause and log work as they do for built-in servers. */
export const CUSTOM_ID = /^c_[a-z0-9]{8}$/;
export const isCustomId = (s: string) => CUSTOM_ID.test(s);
/** How many custom servers a business may add. */
export const MAX_CUSTOM_SERVERS = 10;
/** At most this many tools are read from a server's list. */
export const MAX_LISTED_TOOLS = 200;

/** Shown before a server is added and on every custom server's page. */
export const CUSTOM_WARNING = "This server is run by someone else, not by this app. It sees every question an agent sends it and decides what it answers. Only add servers from companies you already trust with this data.";

export type CustomAuth = "oauth" | "key";

/** The parts of a mcp_custom_servers row the rules need. */
export interface CustomServer {
  id: string;
  name: string;
  url: string;
  auth: CustomAuth;
  scopes: string[];
  scopesOffered: string[];
  tools: CustomTool[];
  toolsOn: Record<string, ToolOn>;
}

// ---- The address.

const BAD_SUFFIX = /\.(local|localhost|internal|intranet|lan|home|corp|private|test|example|invalid|arpa)$/;

/**
 * The address, checked and tidied, or why it can't be used: https on the normal port, a public
 * host name (never an IP address, localhost or an internal name), no user or password in it. The
 * host's addresses are checked again at every call (`isPublicIp`), since a name can point anywhere.
 */
export function checkAddress(raw: string): { url: string } | { problem: string } {
  const s = String(raw ?? "").trim();
  if (!s) return { problem: "Paste the server’s address." };
  if (s.length > 300) return { problem: "That address is too long." };
  let u: URL;
  try { u = new URL(s); } catch { return { problem: "That isn’t a web address. It should start with https://" }; }
  if (u.protocol !== "https:") return { problem: "The address must start with https://" };
  if (u.username || u.password) return { problem: "Take the user name or password out of the address. A key goes in the key box." };
  if (u.port && u.port !== "443") return { problem: "Only servers on the normal https port can be added." };
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || /^[0-9.]+$/.test(host) || host.includes(":")) return { problem: "Use the server’s name, not an IP address." };
  if (host === "localhost" || !host.includes(".") || BAD_SUFFIX.test(host)) return { problem: "That address isn’t a public server." };
  if (!/^[a-z0-9.-]+$/.test(host) || !/\.[a-z]{2,63}$/.test(host) || host.split(".").some((p) => !p || p.length > 63 || p.startsWith("-") || p.endsWith("-"))) return { problem: "That host name doesn’t look right." };
  u.hash = "";
  return { url: u.toString() };
}

const v4 = (ip: string): number[] | null => {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.map(Number);
};

/** Whether an address a host name resolved to is on the public internet (not private, loopback, link-local or reserved). */
export function isPublicIp(ip: string): boolean {
  const a = v4(ip);
  if (a) {
    const [x, y] = a;
    if (x === 0 || x === 10 || x === 127 || x >= 224) return false;
    if (x === 100 && y >= 64 && y <= 127) return false; // carrier-grade NAT
    if (x === 169 && y === 254) return false; // link-local, cloud metadata
    if (x === 172 && y >= 16 && y <= 31) return false;
    if (x === 192 && (y === 168 || (y === 0 && a[2] === 0) || (y === 0 && a[2] === 2))) return false;
    if (x === 198 && (y === 18 || y === 19 || (y === 51 && a[2] === 100))) return false;
    if (x === 203 && y === 0 && a[2] === 113) return false;
    return true;
  }
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!s.includes(":")) return false;
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIp(mapped[1]);
  if (s === "::" || s === "::1") return false;
  if (/^f[cd]/.test(s)) return false; // unique local
  if (/^fe[89ab]/.test(s)) return false; // link-local
  if (/^ff/.test(s)) return false; // multicast
  if (/^(64:ff9b|2001:db8|2001:0?:|2002:)/.test(s)) return false; // translation, documentation, Teredo, 6to4
  return true;
}

// ---- The server's tools.

/** One input a tool takes, as the rules understand it. Only plain kinds can be filled by an agent or pinned. */
export interface ToolInput { name: string; kind: "text" | "number" | "integer" | "boolean" | "choice" | "other"; required: boolean; options?: string[]; about: string }

/** A tool as the server lists it, kept as the owner last accepted it. Its words are the server's: untrusted. */
export interface CustomTool { name: string; title: string; about: string; readOnly: boolean; inputs: ToolInput[]; fingerprint: string }

/** A turned-on tool: what agents see it as, pinned inputs, and the fingerprint it was turned on with. */
export interface ToolOn {
  label: string; line: string; pins: Record<string, string | number | boolean>; fingerprint: string;
  /** Set when the owner uses the tool as a goal number (core/goal-number-rules.ts). */
  number?: GoalNumber;
}

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const clean = (x: unknown, max: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Json)[k])])) : x;

/** The inputs of a tool's input schema, read plainly. Anything that isn't a flat value is "other". */
export function readInputs(schema: unknown): ToolInput[] {
  const s = obj(schema);
  const props = obj(s.properties);
  const req = Array.isArray(s.required) ? (s.required as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return Object.keys(props).slice(0, 40).map((name) => {
    const p = obj(props[name]);
    const t = Array.isArray(p.type) ? (p.type as unknown[]).filter((x) => x !== "null")[0] : p.type;
    const options = Array.isArray(p.enum) && p.enum.every((o) => typeof o === "string") ? (p.enum as string[]).slice(0, 50).map((o) => clean(o, 80)) : undefined;
    const kind: ToolInput["kind"] = options ? "choice" : t === "string" ? "text" : t === "number" ? "number" : t === "integer" ? "integer" : t === "boolean" ? "boolean" : "other";
    return { name: clean(name, 64), kind, required: req.includes(name), ...(options ? { options } : {}), about: clean(p.description, 200) };
  }).filter((i) => /^[A-Za-z0-9_.-]{1,64}$/.test(i.name));
}

/**
 * A short fingerprint of everything an agent would rely on: the tool's name, title, description,
 * inputs and read-only claim. Any change to any of them changes it, so a description the server
 * rewrites later (a way to slip instructions to an agent) pauses the server too.
 */
export function customFingerprint(raw: unknown): string {
  const t = obj(raw);
  const a = obj(t.annotations);
  const basis = { name: t.name ?? null, title: t.title ?? a.title ?? null, description: t.description ?? null, inputSchema: canon(t.inputSchema ?? null), readOnly: a.readOnlyHint ?? null, destructive: a.destructiveHint ?? null };
  return createHash("sha256").update(JSON.stringify(canon(basis))).digest("base64url").slice(0, 16);
}

/** One tool from a tools/list reply. It counts as a read only when the server says so and doesn't also call it destructive. */
export function readTool(raw: unknown): CustomTool | null {
  const t = obj(raw);
  const name = typeof t.name === "string" ? t.name : "";
  if (!/^[A-Za-z0-9_.:/-]{1,120}$/.test(name)) return null;
  const a = obj(t.annotations);
  return {
    name,
    title: clean(t.title ?? a.title, 80),
    about: clean(t.description, 500),
    readOnly: a.readOnlyHint === true && a.destructiveHint !== true,
    inputs: readInputs(t.inputSchema),
    fingerprint: customFingerprint(raw),
  };
}

/** Every tool in a server's list, by name, at most MAX_LISTED_TOOLS. A name listed twice keeps the first. */
export function readToolList(raw: readonly unknown[]): CustomTool[] {
  const out: CustomTool[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = readTool(r);
    if (!t || seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
    if (out.length >= MAX_LISTED_TOOLS) break;
  }
  return out;
}

/**
 * Why a tool can't be turned on, or null when it can. Only tools that say they only read, and
 * whose required inputs are plain values an agent can fill or the owner can pin.
 */
export function cantTurnOn(t: CustomTool): string | null {
  if (!t.readOnly) return "The server doesn’t say this tool only reads, so it’s treated as one that changes things. Those can’t be turned on.";
  const odd = t.inputs.filter((i) => i.required && i.kind === "other");
  if (odd.length) return `It needs inputs agents can’t fill safely (${odd.map((i) => i.name).join(", ")}: lists or objects).`;
  return null;
}

export interface CustomCheck { missing: string[]; changed: string[]; noLongerRead: string[] }

/** Compares the turned-on tools with the server's list now. Any difference pauses the server. New tools don't: they arrive off. */
export function checkCustomTools(on: Record<string, ToolOn>, live: readonly CustomTool[]): CustomCheck {
  const by = new Map(live.map((t) => [t.name, t]));
  const missing: string[] = [], changed: string[] = [], noLongerRead: string[] = [];
  for (const [name, o] of Object.entries(on)) {
    const t = by.get(name);
    if (!t) { missing.push(name); continue; }
    if (t.fingerprint !== o.fingerprint) changed.push(name);
    if (cantTurnOn(t)) noLongerRead.push(name);
  }
  return { missing, changed, noLongerRead };
}

/** In words, for the paused note and the log. Empty when nothing changed. */
export function customCheckNote(c: CustomCheck): string {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`no longer offers ${c.missing.join(", ")}`);
  if (c.changed.length) parts.push(`changed ${c.changed.join(", ")}`);
  return parts.length ? `the server ${parts.join(" and ")}` : "";
}

/**
 * Accepting the server's tools as they are now: changed tools keep the owner's label and pins but
 * take the new fingerprint; a tool that's gone, or no longer only reads, is turned off.
 */
export function acceptTools(on: Record<string, ToolOn>, live: readonly CustomTool[]): { on: Record<string, ToolOn>; turnedOff: string[] } {
  const by = new Map(live.map((t) => [t.name, t]));
  const next: Record<string, ToolOn> = {};
  const turnedOff: string[] = [];
  for (const [name, o] of Object.entries(on)) {
    const t = by.get(name);
    if (!t || cantTurnOn(t)) { turnedOff.push(name); continue; }
    const pins = checkPins(t.inputs, o.pins);
    next[name] = { ...o, pins: "pins" in pins ? pins.pins : {}, fingerprint: t.fingerprint };
  }
  return { on: next, turnedOff };
}

// ---- What the owner edits: a tool's label, its line, pinned inputs.

const LINK = /https?:\/\/|www\.|<|>/i;

/** A short plain name for a tool, as agents and the owner see it. */
export function checkLabel(s: string): { label: string } | { problem: string } {
  const label = clean(s, 61);
  if (!label) return { problem: "Give the tool a name." };
  if (label.length > 60) return { problem: "Keep the name under 60 characters." };
  if (LINK.test(label)) return { problem: "Leave links and angle brackets out of the name." };
  return { label };
}

/** The one line agents read about the tool (instead of the server's own description). */
export function checkLine(s: string): { line: string } | { problem: string } {
  const line = clean(s, 301);
  if (!line) return { problem: "Write one line on what the tool reads." };
  if (line.length > 300) return { problem: "Keep the line under 300 characters." };
  if (LINK.test(line)) return { problem: "Leave links and angle brackets out of the line." };
  return { line };
}

/** Pinned inputs, checked against the tool's inputs: plain values only, text at most 300 characters and no links. Blank means not pinned. */
export function checkPins(inputs: readonly ToolInput[], raw: Record<string, unknown>): { pins: Record<string, string | number | boolean> } | { problem: string } {
  const pins: Record<string, string | number | boolean> = {};
  for (const [name, v] of Object.entries(raw ?? {})) {
    if (v === "" || v == null) continue;
    const i = inputs.find((x) => x.name === name);
    if (!i) continue;
    const s = String(v).trim();
    if (!s) continue;
    switch (i.kind) {
      case "text":
        if (s.length > 300) return { problem: `${name}: keep it under 300 characters.` };
        if (LINK.test(s) || /[\u0000-\u001f]/.test(s)) return { problem: `${name}: no links, angle brackets or line breaks.` };
        pins[name] = s; break;
      case "choice":
        if (!i.options?.includes(s)) return { problem: `${name}: pick one of ${i.options?.join(", ")}.` };
        pins[name] = s; break;
      case "number": case "integer": {
        const n = Number(s);
        if (!Number.isFinite(n) || (i.kind === "integer" && !Number.isInteger(n))) return { problem: `${name}: that isn’t ${i.kind === "integer" ? "a whole number" : "a number"}.` };
        pins[name] = n; break;
      }
      case "boolean":
        if (s !== "true" && s !== "false") return { problem: `${name}: true or false.` };
        pins[name] = s === "true"; break;
      default:
        return { problem: `${name} can’t be pinned: it isn’t a plain value.` };
    }
  }
  return { pins };
}

/** The scopes the owner ticked, kept only if the server offers them (when it says what it offers). */
export function checkScopes(chosen: readonly string[], offered: readonly string[]): { scopes: string[] } | { problem: string } {
  const scopes = [...new Set(chosen.map((s) => String(s).trim()).filter(Boolean))].slice(0, 30);
  if (scopes.some((s) => s.length > 120 || /\s/.test(s))) return { problem: "That scope doesn’t look right." };
  if (offered.length && scopes.some((s) => !offered.includes(s))) return { problem: "Pick only scopes the server offers." };
  return { scopes };
}

/** A pasted key: one line, no spaces, a sensible length. Its value is never shown again. */
export const looksLikeKey = (k: string) => k.length >= 8 && k.length <= 800 && !/[\s\u0000-\u001f\u007f]/.test(k);

/** A name for a server the owner adds. */
export function checkServerName(s: string): { name: string } | { problem: string } {
  const name = clean(s, 61);
  if (!name) return { problem: "Name the server, for example the service it’s for." };
  if (name.length > 60) return { problem: "Keep the name under 60 characters." };
  if (LINK.test(name)) return { problem: "Leave links out of the name." };
  return { name };
}

// ---- Slice 2: turned-on tools granted to agents. A granted tool is named by its server and its
// name, and becomes a read tool on the tool list only for a run, from the row as accepted.

/** Most calls to custom tools in one run, across every custom server. */
export const MAX_CUSTOM_CALLS = 20;
/** Most of one custom tool's reply an agent sees, in characters. */
export const MAX_CUSTOM_REPLY = 20_000;
/** Most a custom tool's inputs may weigh, pins included, as JSON bytes. */
export const MAX_CUSTOM_ARGS = 2048;
/** Most custom tools one agent may be granted. */
export const MAX_CUSTOM_GRANTS = 20;

const TOOL_ID = /^c_[a-z0-9]{8}__[A-Za-z0-9_-]{1,80}$/;
/** A granted custom tool's id: its server's id, two underscores, and its name made safe for a tool name. */
export const isCustomToolId = (id: string) => TOOL_ID.test(id);
export function customToolId(server: string, name: string): string {
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60);
  return `${server}__${slug === name ? slug : `${slug}_${createHash("sha256").update(name).digest("hex").slice(0, 6)}`}`;
}
/** The server a granted custom tool is on, or null when the id isn't one. */
export const serverOfToolId = (id: string): string | null => (isCustomToolId(id) ? id.slice(0, 10) : null);

/**
 * The inputs an agent may fill: every input that isn't pinned and is a plain value, each checked
 * in code like any tool's (text at most 300 characters and no links).
 */
export function customParams(inputs: readonly ToolInput[], pins: Record<string, unknown>): Param[] {
  const out: Param[] = [];
  for (const i of inputs) {
    if (i.name in pins || i.kind === "other") continue;
    const description = i.about ? i.about.slice(0, 200) : `The ${i.name} input.`;
    const optional = !i.required;
    if (i.kind === "text") out.push({ name: i.name, type: "text", maxLength: 300, optional, description });
    else if (i.kind === "number" || i.kind === "integer") out.push({ name: i.name, type: "number", integer: i.kind === "integer", optional, description });
    else if (i.kind === "boolean") out.push({ name: i.name, type: "bool", optional, description });
    else if (i.kind === "choice" && i.options?.length) out.push({ name: i.name, type: "enum", options: i.options, optional, description });
  }
  return out;
}

/** What is sent to the server: the agent's checked inputs with every pin laid over them, within the size limit. */
export function customArgs(inputs: readonly ToolInput[], pins: Record<string, string | number | boolean>, checked: Record<string, string | number>): { args: Record<string, string | number | boolean> } | { problem: string } {
  const args: Record<string, string | number | boolean> = {};
  for (const i of inputs) {
    if (i.name in pins) { args[i.name] = pins[i.name]; continue; }
    const v = checked[i.name];
    if (v === undefined) continue;
    args[i.name] = i.kind === "boolean" ? v === "true" : v;
  }
  if (Buffer.byteLength(JSON.stringify(args)) > MAX_CUSTOM_ARGS) return { problem: `the inputs are over ${MAX_CUSTOM_ARGS / 1024} KB` };
  return { args };
}

/** A custom tool's reply as an agent sees it: text, cut to the limit. */
export function customReply(data: unknown): string {
  const s = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return s.length > MAX_CUSTOM_REPLY ? `${s.slice(0, MAX_CUSTOM_REPLY)}… [cut, ${s.length - MAX_CUSTOM_REPLY} more characters]` : s;
}
