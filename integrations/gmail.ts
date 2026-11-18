import "server-only";
// Gmail drafts for agent outreach (docs/mcp-everywhere.md, slice 6). The "Gmail drafts" sign-in is
// granted gmail.compose alone and is used only by core/gateway (callWriteTool), after an approver approves:
// our own Gmail server has a draft tool and no send tool, so the owner sends every email from Gmail.
import { localReady } from "./mcp";

/** Whether the gateway's Gmail drafts sign-in is connected and not paused. */
export const hasGmail = () => localReady("gmail");
