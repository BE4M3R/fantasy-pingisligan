import Image from "next/image";
import Link from "next/link";
import {
  CONTACT_EMAIL,
  CONTACT_EMAIL_HREF,
  INSTAGRAM_URL,
} from "@/app/contact-links";

const footerLinkClassName =
  "group flex min-h-11 items-center justify-between gap-3 rounded-md border border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)] px-3 text-sm font-semibold text-[var(--pf-text)] transition hover:border-[var(--pf-brand-blue-border)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-brand-blue)]";

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

export function PublicFooter() {
  return (
    <footer className="border-t border-[var(--pf-card-border)] bg-[var(--pf-navy)]">
      <div className="mx-auto max-w-6xl px-6 py-6 sm:py-7">
        <div>
          <div className="flex items-center gap-3">
            <Image
              alt="Pingisligan Fantasy"
              className="h-9 w-9 shrink-0"
              height={36}
              src="/branding/pingisligan-fantasy-mark-transparent-v2.png"
              unoptimized
              width={36}
            />
            <a
              aria-label="Visit Svenska Bordtennisförbundet"
              className="shrink-0 rounded-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pf-text)]"
              href="https://sbtf.se/"
              rel="noreferrer"
              target="_blank"
            >
              <Image
                alt="Svenska Bordtennisförbundet"
                className="h-9 w-9 brightness-0 invert"
                height={596}
                src="/branding/sbtf-logo.webp"
                width={596}
              />
            </a>
          </div>
          <p className="mt-2 text-xs text-[var(--pf-text-muted)]">
            Pingisligan Fantasy in collaboration with SBTF
          </p>
        </div>

        <nav
          aria-label="Footer"
          className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          <Link
            className={`${footerLinkClassName} col-span-2 sm:col-span-1`}
            href="/about"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AboutIcon />
              <span>About the game</span>
            </span>
            <span
              aria-hidden="true"
              className="text-[var(--pf-text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--pf-brand-blue-hover)]"
            >
              →
            </span>
          </Link>
          <a
            aria-label="Follow Fantasy Pingisligan on Instagram"
            className={footerLinkClassName}
            href={INSTAGRAM_URL}
            rel="noreferrer"
            target="_blank"
          >
            <span className="flex min-w-0 items-center gap-2">
              <InstagramIcon />
              <span>Instagram</span>
            </span>
            <span
              aria-hidden="true"
              className="text-[var(--pf-text-muted)] group-hover:text-[var(--pf-brand-blue-hover)]"
            >
              ↗
            </span>
          </a>
          <a
            aria-label={`Email Fantasy Pingisligan at ${CONTACT_EMAIL}`}
            className={footerLinkClassName}
            href={CONTACT_EMAIL_HREF}
          >
            <span className="flex min-w-0 items-center gap-2">
              <MailIcon />
              <span>Contact</span>
            </span>
            <span
              aria-hidden="true"
              className="text-[var(--pf-text-muted)] group-hover:text-[var(--pf-brand-blue-hover)]"
            >
              →
            </span>
          </a>
        </nav>

        <p className="mt-5 border-t border-[var(--pf-card-border)] pt-4 text-xs text-[var(--pf-text-muted)]">
          © 2026 Pingisligan Fantasy
        </p>
      </div>
    </footer>
  );
}
