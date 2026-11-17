import "server-only";
// The Supabase client: service role, server only, scoped to the current org (core/tenancy.ts,
// docs/tenancy.md). This is the only file that makes a Supabase client (lint enforces it).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/core/env";
import { scopeClient } from "@/core/tenancy";

let client: SupabaseClient | null = null;
let scoped: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
  // the org is read on every from(), so one wrapper serves every org
  scoped ??= scopeClient(client);
  return scoped;
}
