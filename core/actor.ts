// Who did it (docs/tenancy.md, slice 2): the signed-in member's email, recorded on memory changes
// and playbook approvals made from the Control Room. Set by withActor around an action's work.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** Runs `fn` on behalf of `who` (an email): every record of who did it inside says so. */
export const withActor = <T>(who: string, fn: () => T): T => store.run(who, fn);

/** Who the current work is for: the member set by withActor, else the Control Room itself. */
export const actor = (): string => store.getStore() ?? "control room";
