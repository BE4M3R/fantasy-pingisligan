"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function CompetitionReturnLink({ signedIn, returnTo, className }: {
  signedIn: boolean; returnTo?: "/competitions" | "/dashboard/overview"; className: string;
}) {
  const router = useRouter();
  const label = returnTo === "/competitions" ? "Back to Competitions" : "Back to Fantasy";
  return <Link href={signedIn ? returnTo ?? "/dashboard/overview" : "/signup"} className={className}
    onNavigate={(event) => {
      // Back navigation lets Next restore the previous page's scroll.
      // A direct visit or a new tab uses the normal dashboard destination.
      if (signedIn && returnTo && window.history.length > 1) {
        event.preventDefault();
        router.back();
      }
    }}>
    {signedIn ? label : "Play Fantasy"}
  </Link>;
}
