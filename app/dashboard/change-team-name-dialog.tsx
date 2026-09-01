"use client";

import { useRef, useState } from "react";
import { updateTeamName } from "@/app/dashboard/actions";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";

export function ChangeTeamNameDialog({ currentName }: { currentName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useBodyScrollLock(isOpen);

  function openDialog() {
    dialogRef.current?.showModal();
    setIsOpen(true);
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        className="mt-3 flex min-h-10 w-full items-center justify-between gap-3 rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-3 text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
        onClick={openDialog}
        type="button"
      >
        <span>Change team name</span>
        <span aria-hidden="true" className="text-[var(--pf-text-muted)]">
          →
        </span>
      </button>

      <dialog
        aria-labelledby="change-team-name-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/80"
        onClick={(event) => {
          if (event.target === dialogRef.current) closeDialog();
        }}
        onClose={() => setIsOpen(false)}
        ref={dialogRef}
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black" id="change-team-name-title">
                Change team name
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-[var(--pf-text-muted)]">
                This is the name other managers see in league tables.
              </p>
            </div>
            <button
              aria-label="Close change team name"
              className="-mr-2 -mt-2 rounded-md p-2 text-2xl leading-none text-[var(--pf-text-muted)] transition hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)]"
              onClick={closeDialog}
              type="button"
            >
              ×
            </button>
          </div>

          <form
            action={updateTeamName}
            className="mt-5 space-y-4"
            onSubmit={closeDialog}
            suppressHydrationWarning
          >
            <div>
              <label
                className="block text-sm font-medium text-[var(--pf-text)]"
                htmlFor="team-name-dialog"
              >
                Team name
              </label>
              <input
                autoComplete="organization"
                autoFocus
                className="mt-2 w-full rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-deep)] px-3 py-2.5 text-[var(--pf-text)] outline-none transition placeholder:text-[var(--pf-text-muted)]/40 focus:border-[var(--pf-brand-blue)] focus:ring-2 focus:ring-[var(--pf-brand-blue)]/30"
                defaultValue={currentName === "My team" ? "" : currentName}
                id="team-name-dialog"
                maxLength={40}
                name="team_name"
                placeholder="For example, Spin Doctors"
                required
                suppressHydrationWarning
                type="text"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                className="rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-4 py-2.5 text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
                onClick={closeDialog}
                type="button"
              >
                Cancel
              </button>
              <button className="rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pf-navy)]">
                Save team name
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
