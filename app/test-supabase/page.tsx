import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function TestSupabasePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const supabase = await createClient();
  const { data, error } = await supabase.from("players").select("*").limit(5);

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold">Supabase test</h1>

      {error ? (
        <pre className="mt-4 text-red-500">{error.message}</pre>
      ) : (
        <pre className="mt-4">{JSON.stringify(data, null, 2)}</pre>
      )}
    </main>
  );
}
