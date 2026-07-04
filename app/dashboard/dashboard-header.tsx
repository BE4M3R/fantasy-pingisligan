import Link from "next/link";
import { signOut } from "@/app/auth/actions";

type DashboardTab = "squad" | "leaderboard";

const tabs: { href: string; label: string; value: DashboardTab }[] = [
  { href: "/dashboard", label: "Squad", value: "squad" },
  { href: "/dashboard/leaderboard", label: "Leaderboard", value: "leaderboard" },
];

export function DashboardHeader({ activeTab }: { activeTab: DashboardTab }) {
  return (
    <header className="border-b border-white/15 bg-sky-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link className="font-bold text-sky-100" href="/">
          Fantasy Pingisligan
        </Link>

        <nav
          aria-label="Dashboard"
          className="flex rounded-md border border-white/15 bg-white/5 p-1 text-sm font-semibold"
        >
          {tabs.map((tab) => (
            <Link
              className={`rounded-sm px-3 py-1.5 transition ${
                activeTab === tab.value
                  ? "bg-sky-100 text-sky-950"
                  : "text-sky-100 hover:bg-white/10 hover:text-white"
              }`}
              href={tab.href}
              key={tab.value}
            >
              {tab.label}
            </Link>
          ))}
        </nav>

        <form action={signOut}>
          <button className="rounded-md border border-white/20 bg-white/5 px-3 py-2 text-sm font-semibold text-sky-50 transition hover:border-white/60 hover:bg-white/10">
            Log out
          </button>
        </form>
      </div>
    </header>
  );
}
