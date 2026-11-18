import "server-only";
// A Control Room request's org (docs/tenancy.md, slice 8.1): the org the signed-in member's session
// cookie names. core/db.ts imports this file, so the source is registered before any query runs.
// Outside a request (the scheduler's after() work, scripts) or with nobody signed in it answers
// null, and the work runs as the home org, as it did before orgs had their own sign-in.
import { cookies } from "next/headers";
import { SESSION_COOKIE, sessionOf } from "@/core/session";
import { setRequestOrg } from "@/core/tenancy";

setRequestOrg(async () => {
  let token: string | undefined;
  try { token = (await cookies()).get(SESSION_COOKIE)?.value; } catch { return null; }
  return sessionOf(token)?.orgId ?? null;
});
