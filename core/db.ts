import "server-only";
// The Supabase client: service role, server only.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/core/env";

let client: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  client ??= createClient(env.supabaseUrl, env.supabaseServiceKey, { auth: { persistSession: false } });
  return client;
}
