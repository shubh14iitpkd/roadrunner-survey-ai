import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let cached: SupabaseClient<Database> | null = null;

function resolveSupabaseUrl(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (url) return url;

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
  if (projectId) return `https://${projectId}.supabase.co`;

  return null;
}

function resolveSupabaseKey(): string | null {
  // Different projects use different names; support both.
  const publishable = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const anon = (import.meta.env as any).VITE_SUPABASE_ANON_KEY as string | undefined;
  return publishable || anon || null;
}

/**
 * Lazily creates the Lovable Cloud client.
 * Avoids hard crash on module import when env vars are missing.
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (cached) return cached;

  const url = resolveSupabaseUrl();
  const key = resolveSupabaseKey();

  if (!url) throw new Error("Backend URL is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_PROJECT_ID).");
  if (!key) throw new Error("Backend key is not configured (missing VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY).");

  cached = createClient<Database>(url, key, {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  return cached;
}
