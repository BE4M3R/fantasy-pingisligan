"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/browser";
import { announcementCategoryLabels, announcementFields, announcementPreview, popupCandidates, type Announcement, type AnnouncementCandidate, type AnnouncementSummary } from "@/lib/announcements";
import { useBodyScrollLock } from "@/app/dashboard/use-body-scroll-lock";
import { recordAnnouncementInteraction, snoozeAnnouncements } from "./actions";
import { AnnouncementCategoryIcon } from "./category-icon";

const AnnouncementContent = dynamic(() => import("./content").then((module) => module.AnnouncementContent), {
  loading: () => <p className="py-8 text-sm text-[var(--pf-text-muted)]" role="status">Loading announcement…</p>,
});

const InboxContext = createContext<{ unread: number; open: (anchor: HTMLButtonElement) => void } | null>(null);
const buttonClass = "min-h-11 rounded-md bg-[var(--pf-brand-blue)] px-4 py-2.5 text-sm font-bold text-[var(--pf-navy-deep)] hover:bg-[var(--pf-brand-blue-hover)] disabled:opacity-50";
const secondaryClass = "min-h-11 rounded-md border border-[var(--pf-brand-blue-border)] px-4 py-2.5 text-sm font-semibold text-[var(--pf-text)] hover:bg-[var(--pf-navy-elevated)] disabled:opacity-50";
type InboxItem = Pick<Announcement, "id" | "title" | "body" | "category" | "publish_at"> & { announcement_user_state: { read_at: string }[] };

export function AnnouncementBell() {
  const inbox = useContext(InboxContext);
  if (!inbox) return null;
  return <button aria-label={`Open announcements${inbox.unread ? ` (${inbox.unread} unread)` : ""}`} className="relative flex h-10 w-10 items-center justify-center rounded-md border border-[var(--pf-brand-blue-border)] bg-[var(--pf-navy-elevated)] text-[var(--pf-brand-blue)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)]" onClick={(event) => inbox.open(event.currentTarget)} type="button">
    <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
    {inbox.unread > 0 ? <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--pf-brand-blue)] px-1 text-[10px] font-black leading-5 text-[var(--pf-navy-deep)]">{inbox.unread > 99 ? "99+" : inbox.unread}</span> : null}
  </button>;
}

export function Announcements({ children, ready }: {
  children: React.ReactNode; ready: boolean;
}) {
  const [supabase] = useState(createClient);
  const router = useRouter();
  const normalIds = useRef<Set<string> | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const popup = useRef<HTMLDialogElement>(null);
  const inbox = useRef<HTMLDialogElement>(null);
  const inboxAnchor = useRef<HTMLButtonElement | null>(null);
  const [summary, setSummary] = useState<AnnouncementSummary | null>(null);
  const [queue, setQueue] = useState<AnnouncementCandidate[]>([]);
  const [progress, setProgress] = useState(1);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxModal, setInboxModal] = useState(true);
  const [popupOpen, setPopupOpen] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [more, setMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [content, setContent] = useState<Announcement | null>(null);
  const [imageUrl, setImageUrl] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [retry, setRetry] = useState(0);
  useBodyScrollLock((inboxOpen && inboxModal) || popupOpen);

  const positionInbox = useCallback(() => {
    const dialog = inbox.current;
    const anchor = inboxAnchor.current;
    if (!dialog || !anchor?.isConnected) return;
    const mobile = !window.matchMedia("(min-width: 640px)").matches;
    setInboxModal(mobile);
    const bounds = anchor.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 32);
    dialog.style.setProperty("--inbox-left", `${Math.max(16, Math.min(bounds.left, window.innerWidth - width - 16))}px`);
    dialog.style.setProperty("--inbox-top", `${Math.max(16, Math.min(bounds.bottom + 12, window.innerHeight - 160))}px`);
    // Positioning events must never reopen a panel the user just closed.
    if (dialog.open && dialog.matches(":modal") !== mobile) {
      dialog.close();
      if (mobile) dialog.showModal();
      else dialog.show();
    }
  }, []);

  useEffect(() => {
    if (!inboxOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!inbox.current?.matches(":modal") && !inbox.current?.contains(target) && !inboxAnchor.current?.contains(target)) {
        inbox.current?.close();
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !inbox.current?.matches(":modal")) inbox.current?.close();
    };
    window.addEventListener("resize", positionInbox);
    document.addEventListener("scroll", positionInbox, true);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", positionInbox);
      document.removeEventListener("scroll", positionInbox, true);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [inboxOpen, positionInbox]);

  const refresh = useCallback(async function refreshSummary(force = false): Promise<void> {
    // A post-save refresh must follow any read that started before the save.
    if (refreshing.current) {
      await refreshing.current;
      if (force) return refreshSummary(true);
      return;
    }
    setChecking(true);
    const request = (async () => {
    try {
      const { data, error: failure } = await supabase.rpc("get_my_announcement_summary");
      if (failure) throw failure;
      const next = data as AnnouncementSummary;
      setSummary(next);
      if (!popup.current?.open) setProgress(1);
      const snoozed = Boolean(next.snoozed_until && Date.parse(next.snoozed_until) > Date.parse(next.checked_at));
      if (!snoozed && normalIds.current === null) {
        normalIds.current = new Set(next.pending.filter((item) => item.priority === "normal").map((item) => item.id));
      }
      const eligible = popupCandidates(next).filter((item) =>
        item.priority === "high" || normalIds.current?.has(item.id));
      setQueue((previous) => {
        const current = popup.current?.open && eligible.find((item) => item.id === previous[0]?.id);
        return current ? [current, ...eligible.filter((item) => item.id !== current.id)] : eligible;
      });
    } catch {
      setError("Announcements could not be loaded. Please try again.");
    } finally {
      setChecking(false);
    }
    })();
    refreshing.current = request;
    try { await request; } finally { if (refreshing.current === request) refreshing.current = null; }
  }, [supabase]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const onReturn = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      // A return can start a fresh Normal batch. Keep any sequence being read stable.
      if (!popup.current?.open && !inbox.current?.open) normalIds.current = null;
      void refresh();
    };
    const onDialogClose = (event: Event) => {
      // Advancing the sequence already refreshed it; only other dialogs need a new check.
      if (event.target !== popup.current && !(event.target === inbox.current && inbox.current?.open)) onReturn();
    };
    queueMicrotask(onReturn);
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    // Existing native dialogs emit close; no polling or dialog registry is needed.
    document.addEventListener("close", onDialogClose, true);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      document.removeEventListener("close", onDialogClose, true);
    };
  }, [ready, refresh]);

  const loadInbox = useCallback(async (offset = 0) => {
    setListLoading(true);
    setError(null);
    const { data, error: failure } = await supabase.from("announcements")
      .select("id, title, body, category, publish_at, announcement_user_state(read_at)")
      .order("publish_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 19);
    if (failure) setError("Inbox could not be loaded. Please try again.");
    else {
      setItems((previous) => offset ? [...previous, ...(data as InboxItem[])] : data as InboxItem[]);
      setMore(data.length === 20);
    }
    setListLoading(false);
  }, [supabase]);

  const activeId = inboxOpen ? detailId : queue[0]?.id;
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setDetailError(false);
      setImageUrl(undefined);
      const { data, error: failure } = await supabase.from("announcements").select(announcementFields).eq("id", activeId).maybeSingle();
      if (cancelled) return;
      if (failure) { setDetailError(true); setLoading(false); return; }
      if (!data) {
        setContent(null);
        if (inboxOpen) { setDetailId(null); void loadInbox(); }
        void refresh();
        setLoading(false);
        return;
      }
      setContent(data as Announcement);
      setLoading(false);
      if (inboxOpen) {
        const result = await recordAnnouncementInteraction(data.id).catch(() => ({ error: "Could not mark this announcement as read. Please try again." }));
        if (!cancelled) {
          if (result.error) setError(result.error);
          else {
            setItems((previous) => previous.map((item) => item.id === data.id ? { ...item, announcement_user_state: [{ read_at: new Date().toISOString() }] } : item));
            void refresh(true);
          }
        }
      }
      if (data.image_path) {
        const { data: image } = await supabase.storage.from("announcement-artwork").createSignedUrl(data.image_path, 300);
        if (!cancelled) setImageUrl(image?.signedUrl);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeId, inboxOpen, supabase, refresh, loadInbox, retry]);

  useEffect(() => {
    const dialog = popup.current;
    if (!dialog) return;
    if (!queue.length || inboxOpen || !ready) {
      if (dialog.open) dialog.close();
      return;
    }
    if (checking || document.visibilityState !== "visible") return;
    const blocker = document.querySelector('dialog[open]:not(#announcement-popup), [aria-modal="true"]:not(dialog)');
    if (blocker) {
      // Squad actions use a portal rather than a native dialog with a close event.
      const observer = new MutationObserver(() => { if (!blocker.isConnected) void refresh(); });
      observer.observe(blocker.parentNode ?? document.body, { childList: true });
      return () => observer.disconnect();
    }
    if (!dialog.open) { dialog.showModal(); }
  }, [queue, inboxOpen, ready, checking, refresh]);

  async function dismiss(destination?: string) {
    if (saving || !queue[0] || loading || detailError) return;
    setSaving(true);
    setError(null);
    const result = await recordAnnouncementInteraction(queue[0].id, true).catch(() => ({ error: "Could not save. Please try again." }));
    if (result.error) setError(result.error);
    else {
      setProgress((value) => value + 1);
      await refresh(true);
      if (destination) {
        if (destination.startsWith("/")) router.push(destination);
        else window.location.assign(destination);
      }
    }
    setSaving(false);
  }

  async function skip() {
    if (saving || queue.some((item) => item.priority === "high")) return;
    setSaving(true);
    setError(null);
    const result = await snoozeAnnouncements().catch(() => ({ error: "Could not save the pause. Please try again." }));
    if (result.error) setError(result.error);
    else {
      normalIds.current = null;
      setQueue([]);
      setProgress(1);
      await refresh(true);
    }
    setSaving(false);
  }

  function openInbox(anchor: HTMLButtonElement) {
    inboxAnchor.current = anchor;
    setDetailId(null);
    setError(null);
    setInboxOpen(true);
    void loadInbox();
    positionInbox();
    const dialog = inbox.current;
    if (dialog && !dialog.open) {
      if (window.matchMedia("(min-width: 640px)").matches) dialog.show();
      else dialog.showModal();
    }
    void refresh();
  }

  const visibleContent = content?.id === activeId ? content : null;
  const detail = <>
    {loading || (!visibleContent && !detailError) ? <p className="py-8 text-sm text-[var(--pf-text-muted)]" role="status">Loading announcement…</p> : null}
    {detailError ? <div className="space-y-3 py-6"><p role="alert">Announcement could not be loaded.</p><button className={secondaryClass} onClick={() => setRetry((value) => value + 1)} type="button">Retry</button></div> : null}
    {!loading && visibleContent ? <AnnouncementContent announcement={visibleContent} imageUrl={imageUrl} onFollowLink={inboxOpen ? undefined : (url) => void dismiss(url)} /> : null}
  </>;

  return <InboxContext.Provider value={{ unread: summary?.unread_count ?? 0, open: openInbox }}>
    {children}
    <dialog aria-label="Announcement" aria-describedby="announcement-progress" className="m-auto max-h-[85dvh] w-[90vw] max-w-md overflow-hidden rounded-2xl border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/55" id="announcement-popup" onCancel={(event) => { event.preventDefault(); void dismiss(); }} onClose={() => setPopupOpen(false)} onToggle={(event) => setPopupOpen((event.target as HTMLDialogElement).open)} ref={popup}>
      <div className="flex max-h-[85dvh] flex-col">
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
          <p aria-live="polite" className="mb-4 text-[11px] font-semibold text-[var(--pf-text-muted)]" id="announcement-progress">{progress} of {progress + queue.length - 1}</p>
          {!inboxOpen && queue.length > 0 ? detail : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--pf-card-border)] px-5 py-4 sm:px-6">
          {error ? <p className="mb-1 text-sm text-[var(--pf-coral-text)]" role="alert">{error}</p> : null}
          <button className={visibleContent?.cta_url ? secondaryClass : buttonClass} disabled={saving || loading || detailError || !visibleContent} onClick={() => void dismiss()} type="button">{saving ? "Saving…" : queue.length > 1 ? "Dismiss and continue" : "Dismiss"}</button>
          {queue.length > 0 && !queue.some((item) => item.priority === "high") ? <button className="min-h-11 rounded-md px-3 py-2 text-xs font-semibold text-[var(--pf-text-muted)] hover:bg-[var(--pf-navy-elevated)] hover:text-[var(--pf-text)] disabled:opacity-50" disabled={saving} onClick={() => void skip()} type="button">Skip remaining for 24 hours</button> : null}
        </div>
      </div>
    </dialog>
    <dialog
      aria-labelledby="announcement-inbox-title"
      aria-describedby="announcement-inbox-description"
      className="fixed inset-0 z-[10001] m-0 h-dvh max-h-dvh w-full max-w-none overflow-hidden border border-[var(--pf-card-border)] bg-[var(--pf-navy)] p-0 text-[var(--pf-text)] shadow-2xl backdrop:bg-[var(--pf-navy-deep)]/85 sm:inset-auto sm:left-[var(--inbox-left)] sm:top-[var(--inbox-top)] sm:h-auto sm:max-h-[min(36rem,calc(100dvh-var(--inbox-top)-1rem))] sm:w-[25rem] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl"
      onClose={() => {
        if (inbox.current?.open) return; // Resizing can reopen the same panel in its other presentation.
        const focused = document.activeElement;
        if (focused === document.body || (focused && inbox.current?.contains(focused))) inboxAnchor.current?.focus();
        setInboxOpen(false);
        setDetailId(null);
        setError(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          inbox.current?.close();
        }
      }}
      ref={inbox}
    >
      <div className="flex h-full max-h-[inherit] flex-col sm:h-auto">
        <div className="shrink-0 border-b border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]/50 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="min-w-0 truncate text-lg font-bold tracking-tight" id="announcement-inbox-title">Announcements</h2>
              {summary && summary.unread_count > 0 ? (
                <span className="shrink-0 rounded-full border border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--pf-brand-blue-hover)]">{summary.unread_count > 99 ? "99+" : summary.unread_count} new</span>
              ) : null}
            </div>
            <button
              aria-label="Close announcements"
              className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--pf-text-muted)] hover:bg-[var(--pf-brand-blue-soft)] hover:text-[var(--pf-text)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)]"
              onClick={() => inbox.current?.close()}
              type="button"
            >
              <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--pf-text-muted)]" id="announcement-inbox-description">News, updates and special gameweeks.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {detailId ? (
            <>
              <button
                className="mb-5 inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-[var(--pf-brand-blue-hover)] hover:bg-[var(--pf-brand-blue-soft)] focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)]"
                onClick={() => { setDetailId(null); setError(null); }}
                type="button"
              >
                <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m12 5-7 7 7 7M5 12h14" /></svg>
                All announcements
              </button>
              {detail}
            </>
          ) : (
            <>
              {listLoading && !items.length ? <p className="py-8 text-center text-sm text-[var(--pf-text-muted)]" role="status">Loading inbox…</p> : null}
              {!listLoading && !items.length && !error ? (
                <div className="px-5 py-12 text-center">
                  <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--pf-brand-blue-soft)] text-[var(--pf-brand-blue-hover)]"><AnnouncementCategoryIcon category="news" /></span>
                  <h3 className="text-base font-bold">You’re all caught up</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--pf-text-muted)]">Your next update will appear here. Check back for news and special gameweeks.</p>
                </div>
              ) : null}
              <ul aria-label="Announcement history" className="space-y-3">
                {items.map((item) => {
                  const unread = !item.announcement_user_state.length;
                  return (
                    <li key={item.id}>
                      <button
                        className={`group flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--pf-brand-blue)] ${unread
                          ? "border-[var(--pf-brand-blue-border)] bg-[var(--pf-brand-blue-soft)]/70 hover:bg-[var(--pf-brand-blue-soft)]"
                          : "border-[var(--pf-card-border)] bg-[var(--pf-navy-elevated)]/60 hover:border-[var(--pf-brand-blue-border)]"}`}
                        onClick={() => { setError(null); setDetailId(item.id); }}
                        type="button"
                      >
                        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${unread ? "bg-[var(--pf-brand-blue)]/15 text-[var(--pf-brand-blue-hover)]" : "bg-[var(--pf-navy)] text-[var(--pf-text-muted)]"}`}><AnnouncementCategoryIcon category={item.category} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${unread ? "text-[var(--pf-brand-blue-hover)]" : "text-[var(--pf-text-muted)]"}`}>{announcementCategoryLabels[item.category]}</span>
                            {unread ? <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-[var(--pf-brand-blue)]" /> : null}
                          </span>
                          <span className={`mt-1 block break-words text-sm leading-5 ${unread ? "font-bold text-[var(--pf-text)]" : "font-semibold text-[var(--pf-text)]/85"}`}>{item.title}</span>
                          <span className="mt-1.5 line-clamp-2 break-words text-xs leading-5 text-[var(--pf-text-muted)]">{announcementPreview(item.body)}</span>
                          <span className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--pf-text-muted)]">
                            <span>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Stockholm" }).format(new Date(item.publish_at))}</span>
                            <svg aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--pf-text-muted)] group-hover:text-[var(--pf-brand-blue-hover)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {more ? <button className={`${secondaryClass} mt-4 w-full`} disabled={listLoading} onClick={() => void loadInbox(items.length)} type="button">{listLoading ? "Loading…" : "Load older announcements"}</button> : null}
            </>
          )}
          {error ? <div className="mt-4 space-y-3"><p className="text-sm text-[var(--pf-coral-text)]" role="alert">{error}</p><button className={secondaryClass} onClick={() => { if (detailId) setRetry((value) => value + 1); else void loadInbox(); void refresh(); }} type="button">Retry</button></div> : null}
        </div>
      </div>
    </dialog>
  </InboxContext.Provider>;
}
