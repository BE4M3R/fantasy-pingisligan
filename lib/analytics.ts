"use client";

import { track } from "@vercel/analytics";
import type { BeforeSendEvent } from "@vercel/analytics/next";

const productionOrigin = "https://www.pingisliganfantasy.se";
const productionOrigins = new Set([
  "https://pingisliganfantasy.se",
  productionOrigin,
]);

export type AnalyticsEvent =
  | "App Opened in Browser"
  | "App Opened in Standalone"
  | "Competition Banner Clicked"
  | "Squad Save Clicked"
  | "Squad Save Succeeded"
  | "Result Mode Clicked"
  | "Squad Mode Clicked"
  | "Transfer Player Clicked"
  | "Full Statistics Clicked"
  | "Player Points Clicked"
  | "Private League Clicked"
  | "Gameweek League Clicked"
  | "Season League Clicked"
  | "League Team Clicked"
  | "Sponsor Link Clicked";

export function isAnalyticsEnabled() {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "true"
    && typeof window !== "undefined"
    && productionOrigins.has(window.location.origin);
}

// No properties argument: entity identifiers and user data cannot be passed in.
export function trackAnalyticsEvent(event: AnalyticsEvent) {
  try {
    if (isAnalyticsEnabled()) track(event);
  } catch {
    // Optional analytics must never interrupt the primary interaction.
  }
}

let launchHandled = false;

function trackAppLaunch() {
  if (launchHandled) return;
  launchHandled = true;
  const navigation = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigation?.type === "reload" || navigation?.type === "back_forward") return;

  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  // The first permitted page view confirms that Vercel's client is ready.
  // Dispatch after its filter returns to avoid reentering it on the same stack.
  queueMicrotask(() => trackAnalyticsEvent(standalone ? "App Opened in Standalone" : "App Opened in Browser"));
}

// Allow only known page paths. New routes must explicitly opt into collection.
const staticPaths = new Set([
  "/", "/en", "/about", "/rules", "/login", "/signup",
  "/forgot-password", "/reset-password", "/auth/confirmation-error",
  "/dashboard", "/dashboard/overview", "/dashboard/fixtures",
  "/dashboard/leaderboard", "/dashboard/leagues", "/dashboard/progress",
  "/dashboard/rules", "/competitions", "/competitions/season", "/test-supabase",
]);

export function beforeSendAnalytics(event: BeforeSendEvent): BeforeSendEvent | null {
  if (!isAnalyticsEnabled()) return null;
  try {
    const url = new URL(event.url);
    if (!productionOrigins.has(url.origin)) return null;
    const path = url.pathname.replace(/\/$/, "") || "/";
    const groupedPath = /^\/dashboard\/leagues\/[^/]+$/.test(path)
      ? "/dashboard/leagues/[leagueId]"
      : /^\/competitions\/gameweek\/[^/]+$/.test(path)
        ? "/competitions/gameweek/[gameweekId]"
        : staticPaths.has(path) ? path : null;
    if (!groupedPath) return null;
    if (event.type === "pageview") trackAppLaunch();
    // Construct a fresh URL: never forward query strings, fragments or entity IDs.
    return { ...event, url: `${productionOrigin}${groupedPath}` };
  } catch {
    return null;
  }
}
