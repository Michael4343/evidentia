import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedSupabaseClient: SupabaseClient | null = null;
let warnedAboutConfig = false;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (cachedSupabaseClient) {
    return cachedSupabaseClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (!warnedAboutConfig && typeof window !== "undefined") {
      console.error("Supabase environment variables are not configured. Persistence is disabled.");
      warnedAboutConfig = true;
    }
    return null;
  }

  cachedSupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
  return cachedSupabaseClient;
}
