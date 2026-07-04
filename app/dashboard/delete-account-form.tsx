"use client";

import { deleteAccount } from "@/app/dashboard/actions";

export function DeleteAccountForm() {
  return (
    <form
      action={deleteAccount}
      className="mt-5 border-t border-white/10 pt-5"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Delete your account and fantasy team? This cannot be undone.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <button className="w-full rounded-md border border-red-300/40 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-100 transition hover:border-red-200 hover:bg-red-500/20">
        Delete account
      </button>
    </form>
  );
}
