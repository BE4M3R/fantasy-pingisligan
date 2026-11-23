"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CompetitionIcon } from "@/app/competitions/competition-icon";

type DashboardTab = "overview" | "squad" | "competitions" | "leagues" | "fixtures";

const tabs: { href: string; label: string; value: DashboardTab }[] = [
  { href: "/dashboard/overview", label: "Home", value: "overview" },
  { href: "/dashboard", label: "Squad", value: "squad" },
  { href: "/competitions", label: "Competitions", value: "competitions" },
  { href: "/dashboard/leagues", label: "Leagues", value: "leagues" },
  { href: "/dashboard/fixtures", label: "Fixtures", value: "fixtures" },
];

function TabIcon({ tab }: { tab: DashboardTab }) {
  const commonProps = {
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.8,
    viewBox: "0 0 24 24",
  };

  switch (tab) {
    case "overview":
      return (
        <svg {...commonProps}>
          <path d="m3 10 9-7 9 7" />
          <path d="M5 9v11h14V9M9 20v-7h6v7" />
        </svg>
      );
    case "squad":
      return (
        <svg {...commonProps}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M16 4.5a3 3 0 0 1 0 5.8M17 14a5.5 5.5 0 0 1 3.5 5.1V20" />
        </svg>
      );
    case "leagues":
      return (
        <svg {...commonProps}>
          <path d="M8 21v-7H3v7M21 21V10h-5v11M16 21V3h-5v18M2 21h20" />
        </svg>
      );
    case "fixtures":
      return (
        <svg {...commonProps}>
          <rect height="17" rx="2" width="18" x="3" y="4" />
          <path d="M8 2v4M16 2v4M3 9h18" />
          <path d="M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2" />
        </svg>
      );
    case "competitions":
      return <CompetitionIcon className={commonProps.className} />;
  }
}

function isActiveTab(pathname: string, tab: DashboardTab) {
  if (tab === "squad") return pathname === "/dashboard";
  if (tab === "competitions") return pathname === "/competitions";
  return pathname.startsWith(`/dashboard/${tab}`);
}

export function DashboardBottomNavigation() {
  const pathname = usePathname();
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let fullViewportHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      viewport.height * viewport.scale,
    );
    let viewportWidth = window.innerWidth;
    let keyboardOpen = false;
    let animationFrame = 0;

    function updateKeyboardVisibility() {
      if (!viewport) return;
      // Account for pinch zoom, and keep Safari's focus scrolling out of the calculation.
      const viewportHeight = viewport.height * viewport.scale;
      const layoutHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      if (window.innerWidth !== viewportWidth) {
        viewportWidth = window.innerWidth;
        fullViewportHeight = Math.max(layoutHeight, viewportHeight);
      }

      const focusedElement = document.activeElement;
      const isEditing =
        focusedElement instanceof HTMLInputElement ||
        focusedElement instanceof HTMLTextAreaElement ||
        (focusedElement instanceof HTMLElement && focusedElement.isContentEditable);

      // Ignore browser controls. Keep the bar covered during the keyboard's closing animation.
      keyboardOpen = fullViewportHeight - viewportHeight > 120 && (isEditing || keyboardOpen);
      if (!keyboardOpen) fullViewportHeight = Math.max(layoutHeight, viewportHeight);
      setIsKeyboardOpen(keyboardOpen);
    }

    function scheduleUpdate() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateKeyboardVisibility);
    }

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    document.addEventListener("focusin", scheduleUpdate);
    document.addEventListener("focusout", scheduleUpdate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("focusin", scheduleUpdate);
      document.removeEventListener("focusout", scheduleUpdate);
    };
  }, []);

  return (
    <nav
      aria-label="Dashboard"
      className="fixed inset-x-0 bottom-0 z-[9999] border-t border-[var(--pf-card-border)] bg-[var(--pf-navy)]/95 px-1 pb-[var(--pf-dashboard-bottom-inset)] shadow-[0_-8px_24px_rgba(0,23,43,0.24)] backdrop-blur-md sm:px-4"
      // Safari moves fixed footers above the keyboard; conceal the covered bar without moving it.
      style={{ visibility: isKeyboardOpen ? "hidden" : undefined }}
    >
      <div className="mx-auto grid max-w-6xl grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.25fr)_repeat(2,minmax(0,1fr))] gap-0.5 py-1 min-[360px]:grid-cols-5 sm:gap-1 sm:py-1.5">
        {tabs.map((tab) => {
          const isActive = isActiveTab(pathname, tab.value);

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-0.5 text-center text-[10px] font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--pf-brand-blue-hover)] sm:min-h-[3.75rem] sm:text-xs ${
                isActive
                  ? "bg-[var(--pf-brand-blue)] text-[var(--pf-navy-deep)]"
                  : "text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)]"
              }`}
              href={tab.href}
              key={tab.value}
            >
              <TabIcon tab={tab.value} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
