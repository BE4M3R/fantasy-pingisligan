import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import { updateTeamName } from "@/app/dashboard/actions";
import { DeleteAccountForm } from "@/app/dashboard/delete-account-form";
import { createClient } from "@/lib/supabase/server";

type DashboardTab = "overview" | "squad" | "leaderboard" | "progress" | "rules";

type TeamSettings = {
  name: string;
  onboarding_completed: boolean;
};

const tabs: { href: string; label: string; value: DashboardTab }[] = [
  { href: "/dashboard/overview", label: "Home", value: "overview" },
  { href: "/dashboard", label: "Squad", value: "squad" },
  { href: "/dashboard/leaderboard", label: "Leaderboard", value: "leaderboard" },
  { href: "/dashboard/progress", label: "Progress", value: "progress" },
  { href: "/dashboard/rules", label: "Rules", value: "rules" },
];

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
    >
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.14.37.36.7.65.96.3.25.67.4 1.06.44H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51.6Z" />
    </svg>
  );
}

function TeamNameForm({
  defaultValue,
  submitLabel,
}: {
  defaultValue?: string;
  submitLabel: string;
}) {
  const isOnboarding = submitLabel === "Create my team";
  const inputId = isOnboarding ? "team-name-onboarding" : "team-name-settings";

  return (
    <form
      action={updateTeamName}
      className="space-y-3"
      suppressHydrationWarning
    >
      <label
        className="block text-sm font-medium text-[var(--pf-text)]"
        htmlFor={inputId}
      >
        Team name
      </label>
      <input
        autoComplete="organization"
        autoFocus={isOnboarding}
        className="w-full rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-deep)] px-3 py-2.5 text-[var(--pf-text)] outline-none transition placeholder:text-[var(--pf-text-muted)]/40 focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[var(--pf-brand-blue)]/30"
        defaultValue={defaultValue}
        id={inputId}
        maxLength={40}
        name="team_name"
        placeholder="For example, Spin Doctors"
        required
        suppressHydrationWarning
        type="text"
      />
      <button className="w-full rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)]">
        {submitLabel}
      </button>
    </form>
  );
}

function TeamOnboarding() {
  return (
    <div
      aria-labelledby="team-onboarding-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-6 py-10 backdrop-blur-sm"
      role="dialog"
    >
      <div className="table-panel w-full max-w-md rounded-xl border p-6 shadow-2xl sm:p-8">
        <p className="text-sm font-bold uppercase tracking-widest text-[var(--pf-brand-blue)]">
          One last step
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight" id="team-onboarding-title">
          Name your fantasy team
        </h1>
        <p className="mt-3 text-sm leading-6 text-sky-100/70">
          This is the public name that other managers will see on the
          leaderboard. You can change it later in settings.
        </p>
        <div className="mt-7">
          <TeamNameForm submitLabel="Create my team" />
        </div>
      </div>
    </div>
  );
}

export async function DashboardHeader({ activeTab }: { activeTab: DashboardTab }) {
  const supabase = await createClient();
  const { data: claimsResult } = await supabase.auth.getClaims();
  const userId = claimsResult?.claims?.sub;
  const { data } = userId
    ? await supabase
        .from("fantasy_teams")
        .select("name, onboarding_completed")
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null };
  const team = data as TeamSettings | null;

  return (
    <>
      {!team?.onboarding_completed ? <TeamOnboarding /> : null}

      <header className="relative z-40 border-b border-[var(--pf-card-border)] bg-[var(--pf-navy)]">
        <div className="mx-auto max-w-6xl px-2 py-1 min-[360px]:px-4 sm:px-6 sm:pb-3 sm:pt-2">
          <div className="flex min-h-9 items-center justify-between gap-4 sm:min-h-10">
            <Link
              aria-label="Fantasy Pingisligan home"
              className="flex min-w-0 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
              href="/dashboard/overview"
            >
              <Image
                alt=""
                className="h-7 w-7 shrink-0 sm:h-9 sm:w-9"
                height={36}
                priority
                src="/branding/pingisligan-fantasy-mark-transparent-v2.png"
                unoptimized
                width={36}
              />
              <Image
                alt=""
                className="h-auto w-[114px] shrink-0 sm:w-[138px]"
                height={31}
                priority
                src="/branding/pingisligan-fantasy-wordmark-transparent-v2.png"
                unoptimized
                width={138}
              />
            </Link>

            <details className="group relative">
              <summary
                aria-label="Open settings"
                className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-brand-blue)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] sm:h-10 sm:w-10 [&::-webkit-details-marker]:hidden"
              >
                <SettingsIcon />
              </summary>
              <div className="absolute right-0 top-10 z-50 w-[min(22rem,calc(100vw-3rem))] rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 shadow-2xl sm:top-12">
                <div>
                  <h2 className="font-bold text-white">Settings</h2>
                  <p className="mt-1 truncate text-sm text-sky-100/55">
                    {team?.name ?? "Your fantasy team"}
                  </p>
                </div>

                <div className="mt-5">
                  <TeamNameForm
                    defaultValue={team?.name === "My team" ? "" : team?.name}
                    submitLabel="Save team name"
                  />
                </div>

                <form
                  action={signOut}
                  className="mt-5 border-t border-white/10 pt-5"
                  suppressHydrationWarning
                >
                  <button className="w-full rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]">
                    Log out
                  </button>
                </form>

                <DeleteAccountForm />
              </div>
            </details>
          </div>

          <nav
            aria-label="Dashboard"
            className="mt-0.5 grid w-full grid-cols-5 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] p-0.5 text-[10px] font-semibold leading-none tracking-[-0.04em] min-[400px]:text-xs sm:mt-2 sm:p-1 sm:text-sm sm:tracking-normal"
          >
            {tabs.map((tab) => (
              <Link
                className={`flex min-h-[34px] min-w-0 items-center justify-center rounded-sm px-0.5 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pf-brand-blue-hover)] sm:min-h-9 sm:px-3 ${
                  activeTab === tab.value
                    ? "bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)]"
                    : "text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]"
                }`}
                href={tab.href}
                key={tab.value}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
    </>
  );
}
