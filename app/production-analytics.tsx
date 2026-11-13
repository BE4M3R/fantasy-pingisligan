"use client";

import { useSyncExternalStore } from "react";
import { Analytics } from "@vercel/analytics/next";
import { beforeSendAnalytics, isAnalyticsEnabled } from "@/lib/analytics";

const subscribe = () => () => {};
const serverSnapshot = () => false;

export function ProductionAnalytics() {
  // The server gates the deployment; the browser also gates the exact origin.
  // A server snapshot avoids a hydration mismatch without changing static rendering.
  const enabled = useSyncExternalStore(subscribe, isAnalyticsEnabled, serverSnapshot);
  return enabled ? <Analytics mode="production" beforeSend={beforeSendAnalytics} /> : null;
}
