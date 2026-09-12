import "server-only";
import { createClient } from "@supabase/supabase-js";

// Only for tables whose RLS explicitly permits anonymous reads. Never attach
// cookies or a user token: these responses are shared across visitors.
export function createPublicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables");

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        cache: "force-cache",
        next: { revalidate: 60, tags: ["public-game-data"] },
      }),
    },
  });
}
