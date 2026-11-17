import "server-only";
// The Supabase client, server only, scoped to the current org (core/tenancy.ts, docs/tenancy.md).
// This is the only file that makes a Supabase client (lint enforces it).
//
// Slice 2b: with SUPABASE_SIGNING_KEY and SUPABASE_PUBLISHABLE_KEY set, tables are read and written
// with a short-lived token for the current org, so the database itself refuses another org's rows
// (20261204090000_org_policies.sql). Without them, tables use the service role, as before; the
// code's scoping applies either way. Files (storage) stay on the service role until slice 4.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/core/env";
import { REFRESH_MS, orgToken, parseSigningKey, type SigningKey } from "@/core/org-token";
import { scopeClient } from "@/core/tenancy";

let client: SupabaseClient | null = null;
let scoped: SupabaseClient | null = null;
let signing: SigningKey | null | undefined;
const orgClients = new Map<string, SupabaseClient>();
const tokens = new Map<string, { token: string; exp: number }>();

/** Whether the database lock is on: the signing key and the publishable key are both set and the key reads. */
export function dbLock(): { on: boolean; problem?: string } {
  if (signing === undefined) {
    signing = null;
    if (env.supabaseSigningKey || env.supabasePublishableKey) {
      if (!env.supabaseSigningKey || !env.supabasePublishableKey) return { on: false, problem: `${env.supabaseSigningKey ? "SUPABASE_PUBLISHABLE_KEY" : "SUPABASE_SIGNING_KEY"} isn’t set, so the lock is off.` };
      try { signing = parseSigningKey(env.supabaseSigningKey); } catch (e) { console.error("[db] lock off:", e instanceof Error ? e.message : e); return { on: false, problem: e instanceof Error ? e.message : String(e) }; }
    }
  }
  return { on: !!signing };
}

function tokenFor(orgId: string): string {
  const t = tokens.get(orgId);
  if (t && t.exp - Date.now() > REFRESH_MS) return t.token;
  const fresh = orgToken(signing!, orgId);
  tokens.set(orgId, fresh);
  return fresh.token;
}

/** The client an org's tables go through: its own token, so the database holds it to that org. */
function tablesFor(orgId: string): SupabaseClient {
  let c = orgClients.get(orgId);
  if (!c) {
    c = createClient(env.supabaseUrl!, env.supabasePublishableKey!, { auth: { persistSession: false }, accessToken: async () => tokenFor(orgId) });
    orgClients.set(orgId, c);
  }
  return c;
}

export function db(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
  // the org is read on every from(), so one wrapper serves every org
  scoped ??= scopeClient(client, undefined, dbLock().on ? tablesFor : undefined);
  return scoped;
}

/**
 * Supabase Auth, for sign-in only (docs/tenancy.md, slice 2): emailing a link, checking its code,
 * and making the auth user of an invited member. A fresh client each call, kept apart from db(), so
 * a sign-in can never swap db()'s service key for a person's token. Only `.auth` is handed out:
 * no table can be reached through it.
 */
export function authApi(): SupabaseClient["auth"] {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth;
}
