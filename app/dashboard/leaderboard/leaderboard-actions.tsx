"use client";

import { useState } from "react";
import {
  createPrivateLeaderboard,
  joinPrivateLeaderboard,
} from "@/app/dashboard/leaderboard/actions";

type ActionPanel = "create" | "join" | null;

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function JoinIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M14 8V5.75A1.75 1.75 0 0 0 12.25 4h-6.5A1.75 1.75 0 0 0 4 5.75v12.5A1.75 1.75 0 0 0 5.75 20h6.5A1.75 1.75 0 0 0 14 18.25V16M10 12h10m0 0-3-3m3 3-3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function LeaderboardActions({ inviteCode }: { inviteCode?: string }) {
  const [activePanel, setActivePanel] = useState<ActionPanel>(
    inviteCode ? "join" : null,
  );

  function togglePanel(panel: Exclude<ActionPanel, null>) {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  const actionClass =
    "flex min-h-14 items-center justify-center gap-2 rounded-lg border px-3 py-3 text-center text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-page-blue)]";

  return (
    <section aria-label="Private leaderboard actions" className="mb-5">
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <button
          aria-controls="create-leaderboard-panel"
          aria-expanded={activePanel === "create"}
          className={`${actionClass} ${
            activePanel === "create"
              ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)]"
              : "border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] text-[var(--pf-text)] hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)]"
          }`}
          onClick={() => togglePanel("create")}
          type="button"
        >
          <PlusIcon />
          <span>Private leaderboard</span>
        </button>

        <button
          aria-controls="join-leaderboard-panel"
          aria-expanded={activePanel === "join"}
          className={`${actionClass} ${
            activePanel === "join"
              ? "border-[var(--pf-brand-blue)] bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)]"
              : "border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy)] text-[var(--pf-text)] hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)]"
          }`}
          onClick={() => togglePanel("join")}
          type="button"
        >
          <JoinIcon />
          <span>Join leaderboard</span>
        </button>
      </div>

      {activePanel === "create" ? (
        <div
          className="table-panel mt-3 rounded-lg border p-4 sm:p-5"
          id="create-leaderboard-panel"
        >
          <h2 className="font-bold text-[var(--pf-text)]">
            Create a private leaderboard
          </h2>
          <form
            action={createPrivateLeaderboard}
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="min-w-0 flex-1 text-xs text-[var(--pf-text-muted)]">
              Leaderboard name
              <input
                className="mt-1.5 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2.5 text-sm text-[var(--pf-text)] outline-none placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)]"
                maxLength={50}
                name="name"
                placeholder="Friends league"
                required
              />
            </label>
            <button className="rounded-md bg-[var(--pf-brand-blue)] px-5 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)]">
              Create
            </button>
          </form>
        </div>
      ) : null}

      {activePanel === "join" ? (
        <div
          className="table-panel mt-3 rounded-lg border p-4 sm:p-5"
          id="join-leaderboard-panel"
        >
          <h2 className="font-bold text-[var(--pf-text)]">
            Join a private leaderboard
          </h2>
          <form
            action={joinPrivateLeaderboard}
            className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="min-w-0 flex-1 text-xs text-[var(--pf-text-muted)]">
              Invitation code
              <input
                autoCapitalize="characters"
                className="mt-1.5 w-full rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2.5 font-mono text-sm uppercase tracking-[0.16em] text-[var(--pf-text)] outline-none placeholder:text-[var(--pf-text-muted)] focus:border-[var(--pf-brand-blue)]"
                defaultValue={inviteCode}
                maxLength={8}
                name="invite_code"
                placeholder="AB12CD34"
                required
              />
            </label>
            <button className="rounded-md bg-[var(--pf-brand-blue)] px-5 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)]">
              Join
            </button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
