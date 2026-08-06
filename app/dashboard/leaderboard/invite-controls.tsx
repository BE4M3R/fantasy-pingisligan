"use client";

import { useState } from "react";

export function InviteControls({ inviteCode }: { inviteCode: string }) {
  const [copied, setCopied] = useState(false);

  async function shareInvitation() {
    const inviteUrl = `${window.location.origin}/dashboard/leaderboard?invite=${encodeURIComponent(inviteCode)}`;
    const shareData = {
      title: "Fantasy Pingisligan private leaderboard",
      text: `Join my private leaderboard with code ${inviteCode}.`,
      url: inviteUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      window.prompt("Copy this invitation link:", inviteUrl);
    }
  }

  return (
    <button
      className="rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] transition hover:bg-[var(--pf-brand-blue-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pf-brand-blue)]"
      onClick={shareInvitation}
      type="button"
    >
      {copied ? "Invite link copied" : "Share invitation"}
    </button>
  );
}
