import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { cookies } from "next/headers";

export const createClient = cache(async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server components cannot set cookies. Middleware and actions handle refreshes.
        }
      },
    },
  });
});

export const getClaims = cache(async () => {
  const supabase = await createClient();
  return supabase.auth.getClaims();
});

export const getMyTeam = cache(async (userId: string) => {
  const supabase = await createClient();
  return supabase.from("fantasy_teams")
    .select("id, name, budget, onboarding_completed")
    .eq("user_id", userId)
    .maybeSingle();
});
