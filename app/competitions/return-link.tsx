"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function CompetitionReturnLink({ signedIn, fromDashboard, className }: {
  signedIn: boolean; fromDashboard: boolean; className: string;
}) {
  const router = useRouter();
  return <Link href={signedIn ? "/dashboard/overview" : "/signup"} className={className}
    onNavigate={(event) => {
      // Back navigation lets Next restore the previous dashboard's scroll.
      // A direct visit or a new tab uses the normal dashboard destination.
      if (signedIn && fromDashboard && window.history.length > 1) {
        event.preventDefault();
        router.back();
      }
    }}>
    {signedIn ? "Back to Fantasy" : "Play Fantasy"}
  </Link>;
}
