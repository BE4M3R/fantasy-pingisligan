"use client";

import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { refreshCurrentPage } from "./refresh-current-page";

const pullThreshold = 72;
const backgroundDuration = 30_000;
type RefreshTask = (signal: AbortSignal) => Promise<void>;
const PageRefreshContext = createContext<{
  tasks: Set<RefreshTask>;
  isRefreshing: () => boolean;
} | null>(null);

export function usePageRefreshTask(task: RefreshTask) {
  const refresh = useContext(PageRefreshContext);
  const run = useEffectEvent(task);
  useLayoutEffect(() => {
    if (!refresh) return;
    const registered: RefreshTask = (signal) => run(signal);
    refresh.tasks.add(registered);
    return () => { refresh.tasks.delete(registered); };
  }, [refresh]);
}

export function useIsPageRefreshing() {
  return useContext(PageRefreshContext)?.isRefreshing;
}

function supportsRefresh(pathname: string) {
  return /^\/(dashboard|competitions)(\/|$)/.test(pathname) || pathname === "/rules";
}

function canStartPull(target: EventTarget | null) {
  if (!(target instanceof Element) || window.scrollY > 1 || (window.visualViewport?.scale ?? 1) > 1) return false;
  if (document.querySelector('dialog[open], [aria-modal="true"]') ||
      target.closest('nav, input, textarea, select, [contenteditable], [role="dialog"]')) return false;
  for (let element: Element | null = target; element && element !== document.scrollingElement; element = element.parentElement) {
    if (element.scrollTop > 1 && /auto|scroll|overlay/.test(getComputedStyle(element).overflowY)) return false;
  }
  return true;
}

export function PageRefresh({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const enabled = supportsRefresh(pathname);
  const active = useRef<AbortController | null>(null);
  const [context] = useState(() => ({ tasks: new Set<RefreshTask>(), isRefreshing: () => Boolean(active.current) }));
  const [distance, setDistance] = useState(0);
  const [feedback, setFeedback] = useState<{ path: string; state: "refreshing" | "failed" }>();
  const [, startTransition] = useTransition();
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDistance(0);
    setFeedback(undefined);
  }

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.dataset.pageRefresh = "";
    let hiddenAt: number | undefined = document.hidden ? Date.now() : undefined;
    let touch: { id: number; x: number; y: number; pulling: boolean; distance: number } | undefined;
    let listeningForPull = false;
    let feedbackTimeout: ReturnType<typeof setTimeout> | undefined;

    function refresh(manual: boolean) {
      if (active.current || window.location.pathname !== pathname) return;
      const operation = new AbortController();
      active.current = operation;
      if (manual) {
        if (feedbackTimeout) clearTimeout(feedbackTimeout);
        setFeedback({ path: pathname, state: "refreshing" });
      }

      startTransition(async () => {
        try {
          if (!navigator.onLine) throw new Error("Offline");
          const results = await Promise.allSettled([
            refreshCurrentPage(),
            ...Array.from(context.tasks, async (task) => task(operation.signal)),
          ]);
          if (results.some((result) => result.status === "rejected")) throw new Error("Refresh failed");
          if (!operation.signal.aborted && manual) setFeedback(undefined);
        } catch {
          if (!operation.signal.aborted && manual) {
            setFeedback({ path: pathname, state: "failed" });
            feedbackTimeout = setTimeout(() => setFeedback(undefined), 3_000);
          }
        } finally {
          if (active.current === operation) active.current = null;
        }
      });
    }

    function resetPull() {
      if (touch?.pulling) setDistance(0);
      touch = undefined;
    }

    function updatePullListener() {
      const atTop = window.scrollY <= 1;
      if (atTop === listeningForPull) return;
      listeningForPull = atTop;
      // Chromium must see the cancelable listener before the touch starts.
      if (atTop) document.addEventListener("touchmove", onTouchMove, { passive: false });
      else {
        document.removeEventListener("touchmove", onTouchMove);
        resetPull();
      }
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || active.current || !canStartPull(event.target)) return resetPull();
      const finger = event.touches[0];
      touch = { id: finger.identifier, x: finger.clientX, y: finger.clientY, pulling: false, distance: 0 };
    }

    function onTouchMove(event: TouchEvent) {
      if (!touch || event.touches.length !== 1 || window.scrollY > 1) return resetPull();
      const finger = event.touches[0];
      if (finger.identifier !== touch.id) return resetPull();
      const vertical = finger.clientY - touch.y;
      const horizontal = Math.abs(finger.clientX - touch.x);
      if (!touch.pulling) {
        if (Math.max(Math.abs(vertical), horizontal) < 8) return;
        if (vertical <= horizontal * 1.25) return resetPull();
        // The browser may already have suppressed the native action via CSS.
        if (!event.cancelable && getComputedStyle(root).overscrollBehaviorY !== "contain") return resetPull();
        touch.pulling = true;
      }
      if (event.cancelable) event.preventDefault();
      touch.distance = Math.max(0, vertical);
      setDistance(Math.min(96, touch.distance));
    }

    function onTouchEnd(event: TouchEvent) {
      const shouldRefresh = touch?.pulling && touch.distance >= pullThreshold &&
        event.touches.length === 0 && Array.from(event.changedTouches).some(({ identifier }) => identifier === touch?.id);
      resetPull();
      if (shouldRefresh) refresh(true);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt ??= Date.now();
        resetPull();
        return;
      }
      const awaySince = hiddenAt;
      hiddenAt = undefined;
      if (awaySince !== undefined && Date.now() - awaySince >= backgroundDuration) refresh(false);
    }

    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted && !document.hidden) onVisibilityChange();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("scroll", updatePullListener, { passive: true });
    updatePullListener();
    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", resetPull, { passive: true });
    return () => {
      delete root.dataset.pageRefresh;
      resetPull();
      active.current?.abort();
      active.current = null;
      if (feedbackTimeout) clearTimeout(feedbackTimeout);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("scroll", updatePullListener);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", resetPull);
    };
  }, [context, enabled, pathname]);

  const status = feedback?.path === pathname ? feedback.state : undefined;

  return <PageRefreshContext value={context}>
    {children}
    {enabled && (distance > 0 || status) ? <div
      aria-hidden={status ? undefined : true}
      className="pointer-events-none fixed left-1/2 top-[max(3.25rem,calc(env(safe-area-inset-top)_+_3rem))] z-[60] flex min-h-8 -translate-x-1/2 items-center rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] px-2.5 text-sm font-semibold text-[var(--pf-text)] shadow-md"
      data-page-refresh-indicator={status ?? (distance >= pullThreshold ? "ready" : "pulling")}
      role={status ? "status" : undefined}
      style={distance ? { marginTop: Math.round(distance / 12) } : undefined}
    >
      {status === "refreshing" ? <span className="sr-only">Refreshing page…</span> : null}
      {status === "failed" ? "Couldn’t refresh" : <svg aria-hidden="true"
        className={`size-4 ${status === "refreshing" ? "motion-safe:animate-spin" : distance >= pullThreshold ? "rotate-180" : ""}`}
        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      >
        {status ? <path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5" /> : <path d="M12 5v14m-5-5 5 5 5-5" />}
      </svg>}
    </div> : null}
  </PageRefreshContext>;
}
