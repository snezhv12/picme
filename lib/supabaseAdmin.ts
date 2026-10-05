import "server-only";
import { createClient } from "@supabase/supabase-js";

// Supabase with the service_role key: can run host-only database functions.
// Server only; never import this from a client component.
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
