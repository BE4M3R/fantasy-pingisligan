import Link from "next/link";
import { getClaims } from "@/lib/supabase/server";
import { RulesContent } from "@/app/rules/rules-content";
import { publicPageMetadata } from "@/lib/seo";

export const metadata = publicPageMetadata(
  "/rules",
  "Spelregler och poäng – Pingisligan Fantasy",
  "Så spelar du Pingisligan Fantasy: läs om lagbygge, budget, kaptensval, poäng från riktiga matcher, spelarbyten och chips.",
);

export default async function RulesPage() {
  const { data } = await getClaims();
  const isSignedIn = Boolean(data?.claims?.sub);

  return (
    <main className="table-tennis-surface min-h-screen text-white">
      <header className="border-b border-white/15 bg-sky-950/70 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link
            className="font-bold text-sky-100"
            href={isSignedIn ? "/dashboard/overview" : "/"}
          >
            Fantasy Pingisligan
          </Link>
          <div className="flex items-center gap-2">
            {isSignedIn ? (
              <Link
                className="rounded-md bg-sky-100 px-4 py-2 text-sm font-bold text-sky-950 transition hover:bg-white"
                href="/dashboard/overview"
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  className="rounded-md px-3 py-2 text-sm font-semibold text-sky-100/75 transition hover:text-white"
                  href="/login"
                >
                  Log in
                </Link>
                <Link
                  className="rounded-md bg-sky-100 px-4 py-2 text-sm font-bold text-sky-950 transition hover:bg-white"
                  href="/signup"
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </nav>
      </header>

      <RulesContent />
    </main>
  );
}
