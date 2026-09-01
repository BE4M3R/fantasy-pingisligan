import Image from "next/image";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";
import {
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  INSTAGRAM_URL,
} from "@/app/contact-links";
import { updateTeamName } from "@/app/dashboard/actions";
import { ChangeTeamNameDialog } from "@/app/dashboard/change-team-name-dialog";
import { DeleteAccountForm } from "@/app/dashboard/delete-account-form";
import { SettingsMenu } from "@/app/dashboard/settings-menu";
import { createClient } from "@/lib/supabase/server";

type TeamSettings = {
  name: string;
  onboarding_completed: boolean;
};

const settingsMenuLinkClassName =
  "group flex min-h-10 items-center justify-between gap-3 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]";

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

function AboutIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[var(--pf-text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[var(--pf-text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="17" rx="5" width="17" x="3.5" y="3.5" />
      <circle cx="12" cy="12" r="3.7" />
      <circle cx="17.4" cy="6.7" fill="currentColor" r="1" stroke="none" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-[var(--pf-text-muted)]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="2" width="18" x="3" y="5" />
      <path d="m4 7 8 6 8-6" />
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
          league tables. You can change it later in settings.
        </p>
        <div className="mt-7">
          <TeamNameForm submitLabel="Create my team" />
        </div>
      </div>
    </div>
  );
}

export async function DashboardHeader() {
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
        <div className="relative mx-auto flex min-h-12 max-w-6xl items-center px-4 py-1 sm:min-h-14 sm:px-6">
          <Link
            aria-label="Fantasy Pingisligan home"
            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
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

          <SettingsMenu summary={<SettingsIcon />}>
              <div className="absolute right-0 top-10 z-50 max-h-[calc(100dvh-4rem)] w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-5 shadow-2xl sm:top-12">
                <section
                  aria-labelledby="settings-title"
                >
                  <h2 className="font-bold text-white" id="settings-title">
                    Settings
                  </h2>
                  <p className="mt-1 truncate text-sm text-sky-100/55">
                    {team?.name ?? "Your fantasy team"}
                  </p>

                  <ChangeTeamNameDialog
                    currentName={team?.name ?? "My team"}
                  />

                  <Link
                    className={`${settingsMenuLinkClassName} mt-2`}
                    href="/about"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <AboutIcon />
                      <span>About the game</span>
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-[var(--pf-text-muted)]"
                    >
                      →
                    </span>
                  </Link>
                </section>

                <section
                  aria-labelledby="settings-contact-title"
                  className="mt-5 border-t border-white/10 pt-5"
                >
                  <h2
                    className="font-bold text-[var(--pf-text)]"
                    id="settings-contact-title"
                  >
                    Contact us
                  </h2>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      aria-label={`Email Fantasy Pingisligan at ${CONTACT_EMAIL}`}
                      className={settingsMenuLinkClassName}
                      href={CONTACT_EMAIL_HREF}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <MailIcon />
                        <span>Email</span>
                      </span>
                      <span aria-hidden="true" className="text-[var(--pf-text-muted)]">
                        →
                      </span>
                    </a>
                    <a
                      aria-label="Follow Fantasy Pingisligan on Instagram"
                      className={settingsMenuLinkClassName}
                      href={INSTAGRAM_URL}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <InstagramIcon />
                        <span>Instagram</span>
                      </span>
                      <span aria-hidden="true" className="text-[var(--pf-text-muted)]">
                        ↗
                      </span>
                    </a>
                  </div>
                </section>

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
          </SettingsMenu>
        </div>
      </header>

    </>
  );
}
