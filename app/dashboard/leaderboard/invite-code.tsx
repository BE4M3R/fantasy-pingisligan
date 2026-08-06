"use client";

import { useState } from "react";

async function writeToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through for browsers that expose the API but block its use.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

export function InviteCode({ code }: { code: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyCode() {
    const didCopy = await writeToClipboard(code);
    setCopyStatus(didCopy ? "copied" : "failed");
    window.setTimeout(() => setCopyStatus("idle"), 2000);
  }

  return (
    <button
      aria-label={`Copy invite code ${code}`}
      className="shrink-0 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 py-2 text-center transition hover:border-[var(--pf-brand-blue)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]"
      onClick={copyCode}
      title="Copy invite code"
      type="button"
    >
      <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--pf-text-muted)]">
        {copyStatus === "copied"
          ? "Copied"
          : copyStatus === "failed"
            ? "Copy failed"
            : "Invite code"}
      </span>
      <span className="mt-0.5 block font-mono text-sm font-bold tracking-[0.16em] text-[var(--pf-text)]">
        {code}
      </span>
    </button>
  );
}
