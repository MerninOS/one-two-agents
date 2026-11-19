import "server-only";
// Custom-server tools for a run (docs/custom-servers.md, slice 2). A tool the owner turned on, on a
// server added by its address, becomes a read tool an agent can be granted on the builder's Tools
// step. It isn't on the tool list in code: it is built here, from the server's row as accepted,
// for one run at a time, and only after that server's tool check passes right before the run.
//
// What holds for every custom tool:
// - It only reads (the server says so and the owner turned it on); there are no custom reports or actions.
// - Its inputs are checked in code like any tool's, the owner's pins are laid over them, and they
//   weigh at most 2 KB.
// - Its reply is untrusted data, cut to 20,000 characters, with no numbers worked out in code and
//   no rows an action could name, so it can never choose a recipient, URL, product or category.
// - At most 20 custom calls a run (core/runner.ts counts them).
import { callCustomTool, callCustomToolData, listCustomServers, mcpStatus, readyCustomServers } from "@/integrations/mcp";
import { cantTurnOn, customParams, customToolId, serverOfToolId, type CustomServer } from "@/core/custom-mcp-rules";
import { numberFrom, numberSources, unpinned, type NumberSource } from "@/core/goal-number-rules";
import type { Reading } from "@/core/goal-rules";
import type { ToolDef } from "./types";

/** The read tools a server's turned-on tools become, exactly as the owner accepted them. */
export function customDefs(c: CustomServer): ToolDef[] {
  return Object.entries(c.toolsOn).flatMap(([name, on]): ToolDef[] => {
    const t = c.tools.find((x) => x.name === name);
    if (!t || cantTurnOn(t) || t.fingerprint !== on.fingerprint) return [];
    return [{
      id: customToolId(c.id, name), label: on.label,
      detail: `${on.line.replace(/[.\s]+$/, "")}. From ${c.name}, a server you added, so what it returns is outside data`,
      kind: "read", group: "custom", params: customParams(t.inputs, on.pins), trusted: false, needs: [], costUsd: 0,
      run: async (input) => ({ data: await callCustomTool(c.id, name, input) }),
    }];
  });
}

/**
 * The custom tools a run may use, from the ids its spec grants. Each server they're on must be
 * connected, not paused, and pass its tool check now; `notes` says, in words, what isn't offered
 * and why.
 */
export async function loadCustomTools(granted: readonly string[]): Promise<{ tools: Record<string, ToolDef>; notes: string[] }> {
  const servers = [...new Set(granted.map(serverOfToolId).filter((s): s is string => !!s))];
  if (!servers.length) return { tools: {}, notes: [] };
  const ready = await readyCustomServers(servers);
  const tools: Record<string, ToolDef> = {};
  const notes: string[] = [];
  for (const r of ready) {
    const mine = granted.filter((id) => serverOfToolId(id) === r.id);
    if (!r.ok || !r.server) { notes.push(`${mine.length} tool${mine.length === 1 ? "" : "s"} from a server you added, because ${r.why}`); continue; }
    const defs = new Map(customDefs(r.server).map((d) => [d.id, d]));
    for (const id of mine) {
      const d = defs.get(id);
      if (d) tools[id] = d; else notes.push(`a tool from ${r.server.name} that is turned off now`);
    }
  }
  return { tools, notes };
}

/** Every turned-on custom tool, by server, for the builder: no network, only the rows and whether each server is connected and not paused. */
export async function customMenu(): Promise<{ server: CustomServer; setUp: boolean; why: string | null; tools: ToolDef[] }[]> {
  const servers = await listCustomServers();
  return Promise.all(servers.map(async (c) => {
    const s = await mcpStatus(c.id).catch(() => null);
    const why = !s?.connected ? "Not connected" : s.paused ? `Paused: ${s.lastError ?? "its sign-in stopped working"}` : null;
    return { server: c, setUp: !why, why, tools: customDefs(c) };
  }));
}

// ---- Goal numbers (card 133, core/goal-number-rules.ts): a turned-on tool the owner marked as one.

/** Every goal number on the business's servers. No network: the rows only. */
export async function ownNumberSources(): Promise<NumberSource[]> {
  return numberSources(await listCustomServers());
}

/**
 * Reads one goal number: the server must be connected, not paused and pass its tool check now; the
 * tool is called with its pins only (no model, no other input); code reads the field. Anything else
 * reads as an error the goal page shows.
 */
export async function readOwnNumber(s: NumberSource): Promise<Reading> {
  const [r] = await readyCustomServers([s.serverId]);
  if (!r?.ok || !r.server) return { error: r?.why || "the server isn't ready" };
  const on = r.server.toolsOn[s.tool], t = r.server.tools.find((x) => x.name === s.tool);
  if (!on?.number || !t) return { error: `${s.tool} isn't a goal number on ${r.server.name} any more` };
  if (cantTurnOn(t) || t.fingerprint !== on.fingerprint) return { error: `${r.server.name} changed ${s.tool}; accept the change on Connections` };
  if (unpinned(t, on).length) return { error: `${s.tool} needs ${unpinned(t, on).join(", ")} pinned` };
  return numberFrom(await callCustomToolData(r.server.id, s.tool, {}), on.number.field);
}
