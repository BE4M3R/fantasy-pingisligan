"use client";

import { track } from "@vercel/analytics";
import type { BeforeSendEvent } from "@vercel/analytics/next";

const productionOrigin = "https://pingisliganfantasy.se";

export type AnalyticsEvent =
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
    && window.location.origin === productionOrigin;
}

// No properties argument: entity identifiers and user data cannot be passed in.
export function trackAnalyticsEvent(event: AnalyticsEvent) {
  try {
    if (isAnalyticsEnabled()) track(event);
  } catch {
    // Optional analytics must never interrupt the primary interaction.
  }
}

// Allow only known page paths. New routes must explicitly opt into collection.
const staticPaths = new Set([
  "/", "/en", "/about", "/rules", "/login", "/signup",
  "/forgot-password", "/reset-password", "/auth/confirmation-error",
  "/dashboard", "/dashboard/overview", "/dashboard/fixtures",
  "/dashboard/leaderboard", "/dashboard/leagues", "/dashboard/progress",
  "/dashboard/rules", "/competitions/season", "/test-supabase",
]);

export function beforeSendAnalytics(event: BeforeSendEvent): BeforeSendEvent | null {
  if (!isAnalyticsEnabled()) return null;
  try {
    const url = new URL(event.url);
    if (url.origin !== productionOrigin) return null;
    const path = url.pathname.replace(/\/$/, "") || "/";
    const groupedPath = /^\/dashboard\/leagues\/[^/]+$/.test(path)
      ? "/dashboard/leagues/[leagueId]"
      : /^\/competitions\/gameweek\/[^/]+$/.test(path)
        ? "/competitions/gameweek/[gameweekId]"
        : staticPaths.has(path) ? path : null;
    // Construct a fresh URL: never forward query strings, fragments or entity IDs.
    return groupedPath ? { ...event, url: `${productionOrigin}${groupedPath}` } : null;
  } catch {
    return null;
  }
}
