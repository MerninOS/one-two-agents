import "server-only";
// The one way code calls a read or calculate tool (docs/mcp-everywhere.md, slice 1): through the
// in-app MCP server over the tool list. Remote servers (Klaviyo) are reached from inside their
// tools by integrations/mcp.ts; slice 3 lets the runner route their tools straight there.
import { TOOLS } from "./catalog";
import { callThrough, createHost, listThrough, type Handle } from "./mcp-host";
import type { ToolCtx, ToolDef, ToolResult } from "./types";

export const builtinHost: Handle = createHost(TOOLS);

/** A host over another tool list (tests and previews that hand the runner their own tools). */
export const hostFor = (tools: Readonly<Record<string, ToolDef>> | undefined): Handle => (!tools || tools === TOOLS ? builtinHost : createHost(tools));

export const callTool = (name: string, input: Record<string, string | number>, ctx: ToolCtx, host: Handle = builtinHost): Promise<ToolResult> => callThrough(host, name, input, ctx);
export const listTools = (ctx?: ToolCtx, host: Handle = builtinHost) => listThrough(host, ctx);
