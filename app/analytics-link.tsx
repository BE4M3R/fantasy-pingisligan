"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { trackAnalyticsEvent, type AnalyticsEvent } from "@/lib/analytics";

export function AnalyticsLink({ analyticsEvent, onClick, ...props }: ComponentProps<typeof Link> & {
  analyticsEvent: AnalyticsEvent;
}) {
  return <Link {...props} onClick={(event) => {
    onClick?.(event);
    if (!event.defaultPrevented) trackAnalyticsEvent(analyticsEvent);
  }} />;
}
